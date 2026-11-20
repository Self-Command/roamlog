import {
  AiChatResponseSchema,
  AiRunExecuteResponseSchema,
  AiStreamEventSchema,
  type AiChatResponse,
  type AiPlanHint,
  type AiPlanWarning,
  type AiRunExecuteResponse,
  type AiStreamEvent,
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
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string }> } };
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
export async function createAiPlan(
  workspaceId: string,
  input: AiPlanInput,
): Promise<AiPlanResult> {
  const body: AiPlanInput = { message: input.message };
  if (input.hints) body.hints = input.hints;

  return postJson<AiPlanResult>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/chat`,
    body,
    AiChatResponseSchema,
  );
}

/** Extends the blocking plan input with the optional conversation identifiers. */
export interface AiStreamPlanInput extends AiPlanInput {
  conversationId?: string;
  clientMessageId?: string;
  assistantMessageId?: string;
}

export type AiStreamPlanOptions = AbortSignal | { signal?: AbortSignal };

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
function eventFromFrame(frame: ParsedSseFrame, frameIndex: number): AiStreamEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    throw streamProtocolError(`The AI stream frame ${frameIndex} was not valid JSON.`);
  }

  const parsed = AiStreamEventSchema.safeParse(payload);
  if (!parsed.success) {
    throw streamProtocolError(
      `The AI stream frame ${frameIndex} did not match the contract: ${
        parsed.error.issues[0]?.message ?? "unknown schema error"
      }`,
    );
  }
  if (frame.event && frame.event !== parsed.data.type) {
    throw streamProtocolError(
      `The AI stream frame ${frameIndex} declared event "${frame.event}" but carried "${parsed.data.type}".`,
    );
  }
  return parsed.data;
}

function markDone(event: AiStreamEvent, frameIndex: number, doneSeen: boolean): boolean {
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
export async function* streamAiPlan(
  workspaceId: string,
  input: AiStreamPlanInput,
  options?: AiStreamPlanOptions,
): AsyncGenerator<AiStreamEvent, void, void> {
  const signal = resolveAbortSignal(options);
  if (signal?.aborted) return;

  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/chat/stream`;
  const body: AiStreamPlanInput = { message: input.message };
  if (input.hints) body.hints = input.hints;
  if (input.conversationId) body.conversationId = input.conversationId;
  if (input.clientMessageId) body.clientMessageId = input.clientMessageId;
  if (input.assistantMessageId) body.assistantMessageId = input.assistantMessageId;

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

        frameIndex += 1;
        const event = eventFromFrame(frame, frameIndex);
        doneSeen = markDone(event, frameIndex, doneSeen);
        yield event;
      }
    }

    buffer += decoder.decode();

    // A server may flush the final frame without a trailing blank line; the
    // trailing bytes are still a complete frame and must not be dropped.
    if (buffer.trim().length > 0) {
      const frame = parseSseFrame(buffer);
      if (frame) {
        frameIndex += 1;
        const event = eventFromFrame(frame, frameIndex);
        doneSeen = markDone(event, frameIndex, doneSeen);
        yield event;
      }
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