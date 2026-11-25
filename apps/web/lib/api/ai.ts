import {
  AiChatModelsResponseSchema,
  AiChatResponseSchema,
  AiRunExecuteResponseSchema,
  AiStreamEventSchema,
  AiStreamStatusResponseSchema,
  type AiAttachment,
  type AiChatModelsResponse,
  type AiChatResponse,
  type AiHumanToolResult,
  type AiPlanHint,
  type AiPlanWarning,
  type AiReasoningEffort,
  type AiRunExecuteResponse,
  type AiStreamEvent,
  type AiStreamStatusResponse,
  type AiToolCall,
} from "@roamlog/contracts";

import { ApiError, errorFromResponse, isApiError } from "./errors";

/**
 * Client for the two-phase AI planner.
 *
 * `createAiPlan` only *plans*: the server may run read-only tools, but it
 * never writes product data. `executeAiRun` performs exactly the calls the
 * user confirmed. Keeping both behind this module is what lets the page (and
 * its tests) assert that a plan alone produces no write request.
 */

export type AiFailureKind =
  | "not_configured"
  | "quota"
  | "loop_limit"
  | "incomplete_plan"
  | "upstream"
  | "schema_invalid"
  | "run_not_found"
  | "run_consumed"
  | "call_not_planned"
  | "forbidden"
  | "unauthorized"
  | "invalid_request"
  | "invalid_response"
  | "network"
  | "unknown";

const CODE_KINDS: Readonly<Record<string, AiFailureKind>> = {
  AI_NOT_CONFIGURED: "not_configured",
  AI_QUOTA: "quota",
  AI_LOOP_LIMIT: "loop_limit",
  AI_PLAN_INCOMPLETE: "incomplete_plan",
  AI_UPSTREAM: "upstream",
  AI_SCHEMA_INVALID: "schema_invalid",
  AI_RUN_NOT_FOUND: "run_not_found",
  AI_RUN_CONSUMED: "run_consumed",
  AI_RUN_CALL_NOT_PLANNED: "call_not_planned",
  WORKSPACE_ROLE_FORBIDDEN: "forbidden",
  FORBIDDEN: "forbidden",
  UNAUTHENTICATED: "unauthorized",
  VALIDATION_ERROR: "invalid_request",
  INVALID_INPUT: "invalid_request",
};

/** Failures a user can reasonably retry with the exact same request. */
const RETRYABLE: ReadonlySet<AiFailureKind> = new Set<AiFailureKind>([
  "network",
  "upstream",
  "incomplete_plan",
  "unknown",
]);

/**
 * The AI-specific ApiError subclass.
 *
 * It keeps the HTTP status and problem code of the usual `ApiError` so shared
 * helpers (`isForbidden`, `isUnauthorized`) still work, and adds the coarse
 * failure kind the UI maps to Chinese copy.
 */
export class AiRequestError extends ApiError {
  readonly kind: AiFailureKind;
  readonly retryable: boolean;

  constructor(
    status: number,
    message: string,
    code: string,
    kind: AiFailureKind,
    problem?: ApiError["problem"],
  ) {
    super(status, message, code, problem);
    this.name = "AiRequestError";
    this.kind = kind;
    this.retryable = RETRYABLE.has(kind);
  }
}

export function aiFailureKind(status: number, code: string): AiFailureKind {
  const known = CODE_KINDS[code];
  if (known) return known;
  if (code === "INVALID_RESPONSE") return "invalid_response";
  if (status === 0) return "network";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "quota";
  if (status === 502) return "upstream";
  if (status === 503) return "not_configured";
  if (status >= 500) return "unknown";
  return "unknown";
}

/** Normalises anything thrown by the network layer into one AI failure type. */
export function toAiRequestError(error: unknown): AiRequestError {
  if (error instanceof AiRequestError) return error;

  if (isApiError(error)) {
    const kind = aiFailureKind(error.status, error.code);
    return new AiRequestError(error.status, error.message, error.code, kind, error.problem);
  }

  if (error instanceof TypeError || error instanceof DOMException) {
    return new AiRequestError(
      0,
      "The AI request could not reach the server.",
      "NETWORK_ERROR",
      "network",
    );
  }

  return new AiRequestError(
    0,
    error instanceof Error ? error.message : "The AI request failed.",
    "AI_REQUEST_FAILED",
    "unknown",
  );
}

/**
 * One request identifier per confirmed plan. The exact same key is reused if
 * the user retries a failed execution, so the server's idempotency table can
 * return the stored result instead of creating duplicate rows.
 */
export function createAiIdempotencyKey(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === "function") {
    return source.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface SchemaLike<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
}

async function postJson<T>(path: string, body: unknown, schema: SchemaLike<T>): Promise<T> {
  let response: Response;
  let text: string;

  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    text = await response.text();
  } catch (cause) {
    throw toAiRequestError(cause);
  }

  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new AiRequestError(
          response.status,
          `The AI response for ${path} was not JSON.`,
          "INVALID_RESPONSE",
          "invalid_response",
        );
      }
    }
  }

  if (!response.ok) {
    throw toAiRequestError(errorFromResponse(response.status, payload, path));
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AiRequestError(
      response.status,
      parsed.error.issues[0]?.message ?? `The AI response for ${path} did not match the contract.`,
      "INVALID_RESPONSE",
      "invalid_response",
    );
  }

  return parsed.data;
}

/**
 * `GET .../ai/models` — the selectable model list.
 *
 * Port of vercel/chatbot's model-selector data source
 * (`components/chat/multimodal-input.tsx` L794–L803 → `app/(chat)/api/models/route.ts`).
 * Only models this deployment accepts are returned, so the selector can never
 * offer an id the API would reject with `AI_MODEL_NOT_ALLOWED`.
 */
export async function fetchAiModels(workspaceId: string): Promise<AiChatModelsResponse> {
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/models`;
  let response: Response;
  let payload: unknown = null;

  try {
    response = await fetch(path, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
  } catch (cause) {
    throw toAiRequestError(cause);
  }

  if (!response.ok) {
    throw toAiRequestError(errorFromResponse(response.status, payload, path));
  }

  const parsed = AiChatModelsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AiRequestError(
      response.status,
      parsed.error.issues[0]?.message ?? `The model list at ${path} did not match the contract.`,
      "INVALID_RESPONSE",
      "invalid_response",
    );
  }

  return parsed.data;
}

export interface AiPlanInput {
  message: string;
  hints?: AiPlanHint;
}

/**
 * The plan the UI receives, parsed from the wire envelope.
 *
 * `warnings` is declared here explicitly even though the contract already
 * carries it: this is the field that explains why a planned action is missing,
 * and naming it on the result type keeps a future hand-written mapper from
 * returning only `plannedCalls` and silently dropping the reason. The function
 * below returns the parsed envelope itself — it never re-shapes it.
 */
export interface AiPlanResult extends AiChatResponse {
  warnings?: AiPlanWarning[];
}

/** Plans a trip. Read-only tools only — this must never write product data. */
export async function createAiPlan(workspaceId: string, input: AiPlanInput): Promise<AiPlanResult> {
  const body: AiPlanInput = { message: input.message };
  if (input.hints) body.hints = input.hints;

  return postJson<AiPlanResult>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/chat`,
    body,
    AiChatResponseSchema,
  );
}

/** Extends the blocking plan input with the optional conversation identifiers. */
export interface AiStreamPlanInput {
  message?: string;
  hints?: AiPlanHint;
  conversationId?: string;
  clientMessageId?: string;
  assistantMessageId?: string;
  /** Per-turn model override; the API rejects ids outside its allow-list. */
  model?: string;
  /** Per-turn reasoning depth, forwarded verbatim by the API. */
  reasoningEffort?: AiReasoningEffort;
  /** Media already uploaded through the media presign→PUT→complete pipeline. */
  attachments?: AiAttachment[];
  /** Answer to a paused `ask_user` / `confirm_brief`; mutually exclusive with `message`. */
  humanToolResult?: AiHumanToolResult;
}

export type AiStreamPlanOptions = AbortSignal | { signal?: AbortSignal };

/* -------------------------------------------------------------------------- */
/* Appended tool lifecycle events (contract §C.3)                              */
/* -------------------------------------------------------------------------- */

/**
 * `tool.start` / `tool.progress` / `tool.end` are appended to the v1 SSE stream
 * by the API agent. The published `@roamlog/contracts` package may lag one
 * deploy behind, so the transport validates the three shapes locally and
 * yields them alongside the contract-validated `AiStreamEvent` union. Once the
 * contract package ships the same schemas this type becomes structurally
 * redundant, not incompatible.
 */
export interface AiToolStartEvent {
  type: "tool.start";
  toolCallId: string;
  name: string;
  stepId?: string;
  parentToolCallId?: string;
  args: Record<string, unknown>;
  startedAt: string;
}

export interface AiToolProgressEvent {
  type: "tool.progress";
  toolCallId: string;
  percent?: number;
  label?: string;
  at?: string;
}

export interface AiToolEndEvent {
  type: "tool.end";
  toolCallId: string;
  status: "ok" | "error" | "cancelled";
  result?: unknown;
  error?: { code: string; message: string };
  finishedAt: string;
  durationMs: number;
}

export type AiToolStreamEvent = AiToolStartEvent | AiToolProgressEvent | AiToolEndEvent;

export type AiStreamEventPayload = AiStreamEvent | AiToolStreamEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates one of the appended tool events. Returns `null` for anything that
 * is not exactly one of these shapes, so `eventFromFrame` can keep throwing
 * `INVALID_RESPONSE` for genuinely malformed frames.
 */
export function parseToolStreamEvent(payload: unknown): AiToolStreamEvent | null {
  if (!isRecord(payload)) return null;

  switch (payload.type) {
    case "tool.start": {
      if (
        typeof payload.toolCallId !== "string" ||
        typeof payload.name !== "string" ||
        !isRecord(payload.args) ||
        typeof payload.startedAt !== "string"
      ) {
        return null;
      }
      return {
        type: "tool.start",
        toolCallId: payload.toolCallId,
        name: payload.name,
        args: payload.args,
        startedAt: payload.startedAt,
        ...(typeof payload.stepId === "string" ? { stepId: payload.stepId } : {}),
        ...(typeof payload.parentToolCallId === "string"
          ? { parentToolCallId: payload.parentToolCallId }
          : {}),
      };
    }
    case "tool.progress": {
      if (typeof payload.toolCallId !== "string") return null;
      return {
        type: "tool.progress",
        toolCallId: payload.toolCallId,
        ...(typeof payload.percent === "number" && Number.isFinite(payload.percent)
          ? { percent: payload.percent }
          : {}),
        ...(typeof payload.label === "string" ? { label: payload.label } : {}),
        ...(typeof payload.at === "string" ? { at: payload.at } : {}),
      };
    }
    case "tool.end": {
      if (
        typeof payload.toolCallId !== "string" ||
        (payload.status !== "ok" && payload.status !== "error" && payload.status !== "cancelled") ||
        typeof payload.finishedAt !== "string" ||
        typeof payload.durationMs !== "number" ||
        !Number.isFinite(payload.durationMs)
      ) {
        return null;
      }
      return {
        type: "tool.end",
        toolCallId: payload.toolCallId,
        status: payload.status,
        finishedAt: payload.finishedAt,
        durationMs: payload.durationMs,
        ...(payload.result !== undefined ? { result: payload.result } : {}),
        ...(isRecord(payload.error) &&
        typeof payload.error.code === "string" &&
        typeof payload.error.message === "string"
          ? { error: { code: payload.error.code, message: payload.error.message } }
          : {}),
      };
    }
    default:
      return null;
  }
}

function resolveAbortSignal(options: AiStreamPlanOptions | undefined): AbortSignal | undefined {
  if (!options) return undefined;
  if (typeof options === "object" && "signal" in options) {
    return (options as { signal?: AbortSignal }).signal;
  }
  return options as AbortSignal;
}

function streamProtocolError(detail: string): AiRequestError {
  return new AiRequestError(200, detail, "INVALID_RESPONSE", "invalid_response");
}

interface ParsedSseFrame {
  data: string;
  event?: string;
  id?: string;
}

/**
 * Parses one SSE frame body (the text between two blank lines).
 *
 * `data:` lines are joined with `\n` per the SSE spec, so pretty-printed JSON
 * still arrives intact. Comment lines (`: hb ...`) are the keep-alive frames
 * the API emits every few seconds; they carry no data and are ignored.
 */
function parseSseFrame(raw: string): ParsedSseFrame | null {
  const data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (line.length === 0) continue;
    if (line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "data":
        data.push(value);
        break;
      case "event":
        event = value;
        break;
      case "id":
        id = value;
        break;
      default:
        // `retry:` and unknown fields are not part of this contract.
        break;
    }
  }

  if (data.length === 0) return null;
  return {
    data: data.join("\n"),
    ...(event === undefined ? {} : { event }),
    ...(id === undefined ? {} : { id }),
  };
}

function takeFrame(buffer: string): { frame: string; rest: string } | null {
  const boundary = /\r?\n\r?\n/.exec(buffer);
  if (!boundary) return null;
  return {
    frame: buffer.slice(0, boundary.index),
    rest: buffer.slice(boundary.index + boundary[0].length),
  };
}

/** Validates one frame against the frozen contract; never drops a bad frame. */
function eventFromFrame(frame: ParsedSseFrame, frameIndex: number): AiStreamEventPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    throw streamProtocolError(`The AI stream frame ${frameIndex} was not valid JSON.`);
  }

  const parsed = AiStreamEventSchema.safeParse(payload);
  if (parsed.success) {
    if (frame.event && frame.event !== parsed.data.type) {
      throw streamProtocolError(
        `The AI stream frame ${frameIndex} declared event "${frame.event}" but carried "${parsed.data.type}".`,
      );
    }
    return parsed.data;
  }

  // Appended tool events are validated here until the contracts package ships
  // their schemas. A truly unknown/malformed event still throws INVALID_RESPONSE.
  const toolEvent = parseToolStreamEvent(payload);
  if (toolEvent) {
    if (frame.event && frame.event !== toolEvent.type) {
      throw streamProtocolError(
        `The AI stream frame ${frameIndex} declared event "${frame.event}" but carried "${toolEvent.type}".`,
      );
    }
    return toolEvent;
  }

  throw streamProtocolError(
    `The AI stream frame ${frameIndex} did not match the contract: ${
      parsed.error.issues[0]?.message ?? "unknown schema error"
    }`,
  );
}

function markDone(event: AiStreamEventPayload, frameIndex: number, doneSeen: boolean): boolean {
  if (doneSeen) {
    throw streamProtocolError(`The AI stream frame ${frameIndex} arrived after done.`);
  }
  return event.type === "done";
}

/**
 * Streams one planning turn from `POST /ai/chat/stream`.
 *
 * The reader is deliberately hand-written: the endpoint is POST and the
 * project has no EventSource/SSE dependency. Every `data:` payload is validated
 * with `AiStreamEventSchema`; a malformed frame throws instead of being
 * silently dropped, because a dropped `plan` would strand the user on a
 * spinner that never resolves.
 *
 * Aborting the returned generator (or the caller's `AbortSignal`) stops the
 * HTTP body read and ends the generator normally — a deliberate cancellation
 * is not an error.
 */
export interface AiStreamRecord {
  readonly event: AiStreamEventPayload;
  /** Original SSE frame id. Resume replays from the start and skips <= this. */
  readonly eventId: number;
}

function frameEventId(frame: ParsedSseFrame, fallback: number): number {
  const parsed = frame.id ? Number.parseInt(frame.id, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Shared reader for POST-created and GET-resumed SSE responses.
 *
 * The resumable producer replays its whole buffer, so `afterEventId` is the
 * client's de-duplication cursor. The skipped frames still count toward
 * protocol ordering, in particular a `done` frame must remain terminal even
 * when its id is below the cursor.
 */
async function* readAiEventStream(
  response: Response,
  path: string,
  signal: AbortSignal | undefined,
  afterEventId = 0,
): AsyncGenerator<AiStreamRecord, void, void> {
  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("text/event-stream")) {
    throw streamProtocolError(
      `The AI stream response for ${path} was not text/event-stream (got ${contentType}).`,
    );
  }
  if (!response.body) {
    throw streamProtocolError(`The AI stream response for ${path} had no body.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let frameIndex = 0;
  let doneSeen = false;

  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const emit = function* (frame: ParsedSseFrame): Generator<AiStreamRecord, void, void> {
    frameIndex += 1;
    const event = eventFromFrame(frame, frameIndex);
    doneSeen = markDone(event, frameIndex, doneSeen);
    const eventId = frameEventId(frame, frameIndex);
    if (eventId > afterEventId) yield { event, eventId };
  };

  try {
    while (true) {
      if (signal?.aborted) return;

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (cause) {
        if (signal?.aborted) return;
        throw toAiRequestError(cause);
      }

      if (chunk.done) break;
      if (chunk.value) {
        // `{stream:true}` keeps split multi-byte UTF-8 (Chinese text) intact
        // across chunk boundaries.
        buffer += decoder.decode(chunk.value, { stream: true });
      }

      while (true) {
        const taken = takeFrame(buffer);
        if (!taken) break;
        buffer = taken.rest;
        const frame = parseSseFrame(taken.frame);
        if (!frame) continue;
        yield* emit(frame);
      }
    }

    buffer += decoder.decode();

    // A server may flush the final frame without a trailing blank line; the
    // trailing bytes are still a complete frame and must not be dropped.
    if (buffer.trim().length > 0) {
      const frame = parseSseFrame(buffer);
      if (frame) yield* emit(frame);
    }

    if (signal?.aborted) return;
    if (!doneSeen) {
      throw streamProtocolError("The AI stream ended before the done event.");
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
  }
}

/** Streams one planning turn from `POST /ai/chat/stream` with frame ids. */
export async function* streamAiPlanRecords(
  workspaceId: string,
  input: AiStreamPlanInput,
  options?: AiStreamPlanOptions,
): AsyncGenerator<AiStreamRecord, void, void> {
  const signal = resolveAbortSignal(options);
  if (signal?.aborted) return;

  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/chat/stream`;
  const body: AiStreamPlanInput = {};
  if (input.message) body.message = input.message;
  if (input.hints) body.hints = input.hints;
  if (input.conversationId) body.conversationId = input.conversationId;
  if (input.clientMessageId) body.clientMessageId = input.clientMessageId;
  if (input.assistantMessageId) body.assistantMessageId = input.assistantMessageId;
  if (input.model) body.model = input.model;
  if (input.reasoningEffort) body.reasoningEffort = input.reasoningEffort;
  if (input.attachments && input.attachments.length > 0) {
    body.attachments = input.attachments;
  }
  if (input.humanToolResult) body.humanToolResult = input.humanToolResult;

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (signal?.aborted) return;
    throw toAiRequestError(cause);
  }

  if (!response.ok) {
    // Pre-flight failures (validation, quota, auth, unconfigured gateway) are
    // ordinary ProblemDetails JSON. Never start SSE parsing for them.
    const text = await response.text().catch(() => "");
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    throw toAiRequestError(errorFromResponse(response.status, payload, path));
  }

  yield* readAiEventStream(response, path, signal);
}

/** Backwards-compatible event-only view used by callers that do not resume. */
export async function* streamAiPlan(
  workspaceId: string,
  input: AiStreamPlanInput,
  options?: AiStreamPlanOptions,
): AsyncGenerator<AiStreamEventPayload, void, void> {
  for await (const record of streamAiPlanRecords(workspaceId, input, options)) {
    yield record.event;
  }
}

/**
 * Reattaches to the server producer created by `streamAiPlanRecords`.
 *
 * Port of vercel/chatbot `hooks/use-auto-resume.ts` and the resumable GET
 * semantics in `app/(chat)/api/chat/[id]/stream/route.ts` (the pinned upstream
 * route is a stub at this commit, so the request shape follows the
 * `resumable-stream` README linked from that route's imports).
 */
export async function* resumeAiPlanStream(
  workspaceId: string,
  conversationId: string,
  assistantMessageId: string | undefined,
  options?: AiStreamPlanOptions,
): AsyncGenerator<AiStreamRecord, void, void> {
  const signal = resolveAbortSignal(options);
  if (signal?.aborted) return;

  const query = new URLSearchParams();
  if (assistantMessageId) query.set("assistantMessageId", assistantMessageId);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/conversations/${encodeURIComponent(conversationId)}/stream${suffix}`;

  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      headers: { accept: "text/event-stream" },
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (signal?.aborted) return;
    throw toAiRequestError(cause);
  }

  if (response.status === 204) return;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    throw toAiRequestError(errorFromResponse(response.status, payload, path));
  }

  yield* readAiEventStream(response, path, signal);
}

export async function fetchAiStreamStatus(
  workspaceId: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<AiStreamStatusResponse> {
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/conversations/${encodeURIComponent(conversationId)}/stream/status`;
  const response = await fetch(path, {
    credentials: "include",
    signal,
  }).catch((cause: unknown) => {
    throw toAiRequestError(cause);
  });
  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw toAiRequestError(errorFromResponse(response.status, payload, path));
  }
  const parsed = AiStreamStatusResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AiRequestError(
      response.status,
      "AI stream status did not match the contract.",
      "INVALID_RESPONSE",
      "invalid_response",
    );
  }
  return parsed.data;
}

export async function cancelAiStream(
  workspaceId: string,
  conversationId: string,
  streamId: string,
): Promise<boolean> {
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/conversations/${encodeURIComponent(conversationId)}/stream/cancel`;
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ streamId }),
  });
  if (!response.ok) return false;
  const payload = (await response.json().catch(() => null)) as { cancelled?: unknown } | null;
  return payload?.cancelled === true;
}

export interface AiExecuteInput {
  calls: AiToolCall[];
  idempotencyKey: string;
}

/**
 * Executes the confirmed subset of a plan. `idempotencyKey` must come from
 * `createAiIdempotencyKey()` and stay the same for retries of the same plan.
 */
export async function executeAiRun(
  workspaceId: string,
  runId: string,
  input: AiExecuteInput,
): Promise<AiRunExecuteResponse> {
  return postJson(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/runs/${encodeURIComponent(runId)}/execute`,
    { calls: input.calls, idempotencyKey: input.idempotencyKey },
    AiRunExecuteResponseSchema,
  );
}
