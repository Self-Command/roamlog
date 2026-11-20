import {
  AiRewriteResponseSchema,
  AiStreamEventSchema,
  type AiRewriteInstruction,
  type AiRewriteLocale,
  type AiRewriteResponse,
  type AiStreamEvent,
} from "@roamlog/contracts";

import { errorFromResponse } from "../api/errors";
import { AiRequestError, aiFailureKind, toAiRequestError } from "../api/ai";
import { hashSelection, type SubtleLike } from "./selection";

/**
 * Client for `POST /v1/workspaces/{workspaceId}/ai/rewrite`.
 *
 * Deliberately not reusing the planner client: this endpoint answers 200 with a
 * body the caller must treat as *preview data*, never as text to write. The only
 * thing it shares with the planner is the error taxonomy, so a quota failure
 * looks the same to the user wherever it happens.
 */

export interface RewriteSelectionInput {
  /** The exact selected string. The server re-hashes it and rejects a mismatch. */
  text: string;
  instruction: AiRewriteInstruction;
  /** SHA-256 of `text`; see `hashSelection`. */
  selectionHash: string;
  /** Context only. It never scopes the write. */
  tripId?: string;
  locale?: AiRewriteLocale;
}

interface SchemaLike<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string }> } };
}

/** Rewrites one selection. Returns preview data; it persists nothing. */
export async function rewriteSelection(
  workspaceId: string,
  input: RewriteSelectionInput,
  schema: SchemaLike<AiRewriteResponse> = AiRewriteResponseSchema,
): Promise<AiRewriteResponse> {
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/rewrite`;
  const body: Record<string, unknown> = {
    text: input.text,
    instruction: input.instruction,
    selectionHash: input.selectionHash,
  };
  if (input.tripId) body.tripId = input.tripId;
  if (input.locale) body.locale = input.locale;

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
 * True when the text the preview was built from is still the text under the
 * user's cursor. Called immediately before replacing, so a paragraph that
 * changed while the model was running cannot be overwritten with a stale rewrite.
 */
export async function selectionStillMatches(
  expectedHash: string,
  currentText: string,
  subtle?: SubtleLike,
): Promise<boolean> {
  return (await hashSelection(currentText, subtle)) === expectedHash;
}

/* -------------------------------------------------------------------------- */
/* Streaming transport (adaptation layer)                                      */
/* -------------------------------------------------------------------------- */

/**
 * 适配层（本仓库原创，非 Novel 移植）：把 Novel 的 `useCompletion`（Vercel AI SDK v3，
 * `toDataStreamResponse()` 的私有文本流）换成本仓库冻结的 SSE v1 协议
 * （`packages/contracts/src/api/ai.ts` 的 `AiStreamEventSchema`：`meta` → `text.delta`*
 * → `usage` → `done`，失败 `error` + `done{finishReason:"error"}`，中止 `done{aborted}`）。
 *
 * 为什么不能照搬上游：规格 D12 —— `apps/web`/`apps/api` 都没有 AI SDK，且引入它等于
 * 换一套私有流协议。这里逐行照 `apps/web/lib/api/ai.ts:562` 的 `streamAiPlan` 写法
 * （手写 fetch + ReadableStream + 帧解析），**不新增依赖、不新增事件名**。
 */

export interface RewriteStreamInput extends RewriteSelectionInput {
  /**
   * Novel `getPrevText`: the Markdown before the selection. `continue` writes
   * from this instead of from a selection.
   */
  contextBefore?: string;
  /** Novel's `zap` free-form instruction, from the panel's input box. */
  command?: string;
}

export interface RewriteStreamOptions {
  signal?: AbortSignal;
}

interface ParsedSseFrame {
  data: string;
  event?: string;
}

/** Minimal SSE frame parser: only `event:`/`data:` are part of this contract. */
function parseRewriteFrame(raw: string): ParsedSseFrame | null {
  const data: string[] = [];
  let event: string | undefined;

  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (line.length === 0) continue;
    if (line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  }

  if (data.length === 0) return null;
  return { data: data.join("\n"), ...(event === undefined ? {} : { event }) };
}

function takeRewriteFrame(buffer: string): { frame: string; rest: string } | null {
  const boundary = /\r?\n\r?\n/.exec(buffer);
  if (!boundary) return null;
  return {
    frame: buffer.slice(0, boundary.index),
    rest: buffer.slice(boundary.index + boundary[0].length),
  };
}

/**
 * Streams one rewrite from `POST /ai/rewrite/stream`.
 *
 * Every `data:` payload is validated against the frozen `AiStreamEventSchema`,
 * so a malformed frame throws instead of silently truncating the answer. A
 * deliberate abort ends the generator normally — the server turns it into
 * `done{finishReason:"aborted"}` and nothing is written.
 */
export async function* streamRewrite(
  workspaceId: string,
  input: RewriteStreamInput,
  options: RewriteStreamOptions = {},
): AsyncGenerator<AiStreamEvent, void, void> {
  const signal = options.signal;
  if (signal?.aborted) return;

  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/rewrite/stream`;
  const body: Record<string, unknown> = {
    text: input.text,
    instruction: input.instruction,
    selectionHash: input.selectionHash,
  };
  if (input.tripId) body.tripId = input.tripId;
  if (input.locale) body.locale = input.locale;
  if (input.contextBefore !== undefined) body.contextBefore = input.contextBefore;
  if (input.command !== undefined) body.command = input.command;

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
    // ordinary ProblemDetails JSON; never start SSE parsing for them.
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

  if (!response.body) {
    throw new AiRequestError(200, "The rewrite stream had no body.", "INVALID_RESPONSE", "invalid_response");
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

  const parse = (raw: string): AiStreamEvent | null => {
    const frame = parseRewriteFrame(raw);
    if (!frame) return null;

    frameIndex += 1;
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data);
    } catch {
      throw new AiRequestError(
        200,
        `The rewrite stream frame ${frameIndex} was not valid JSON.`,
        "INVALID_RESPONSE",
        "invalid_response",
      );
    }

    const parsed = AiStreamEventSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AiRequestError(
        200,
        `The rewrite stream frame ${frameIndex} did not match the contract: ${
          parsed.error.issues[0]?.message ?? "unknown schema error"
        }`,
        "INVALID_RESPONSE",
        "invalid_response",
      );
    }
    if (frame.event && frame.event !== parsed.data.type) {
      throw new AiRequestError(
        200,
        `The rewrite stream frame ${frameIndex} declared event "${frame.event}" but carried "${parsed.data.type}".`,
        "INVALID_RESPONSE",
        "invalid_response",
      );
    }
    if (doneSeen) {
      throw new AiRequestError(
        200,
        `The rewrite stream frame ${frameIndex} arrived after done.`,
        "INVALID_RESPONSE",
        "invalid_response",
      );
    }
    if (parsed.data.type === "done") doneSeen = true;
    return parsed.data;
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
        // `{stream:true}` keeps split multi-byte UTF-8 (Chinese) intact.
        buffer += decoder.decode(chunk.value, { stream: true });
      }

      while (true) {
        const taken = takeRewriteFrame(buffer);
        if (!taken) break;
        buffer = taken.rest;
        const event = parse(taken.frame);
        if (event) yield event;
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const event = parse(buffer);
      if (event) yield event;
    }

    if (signal?.aborted) return;
    if (!doneSeen) {
      throw new AiRequestError(
        200,
        "The rewrite stream ended before the done event.",
        "INVALID_RESPONSE",
        "invalid_response",
      );
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * User-facing copy for a failed rewrite. The selection-mismatch wording is fixed
 * by the product contract — it must tell the user the source text moved and ask
 * them to retry, because nothing was written.
 */
export function rewriteFailureMessage(error: unknown): string {
  if (error instanceof AiRequestError) {
    switch (error.code) {
      case "AI_SELECTION_HASH_MISMATCH":
        return "原文已变化，请重试";
      case "AI_REWRITE_TEXT_TOO_LONG":
        return "选中文本过长，请分段改写";
      case "AI_NOT_CONFIGURED":
        return "当前站点未配置 AI，暂时无法改写";
      case "AI_REWRITE_EMPTY":
        return "AI 没有给出可用结果，请重试";
      default:
        break;
    }

    switch (error.kind) {
      case "quota":
        return "今天的 AI 额度已用完，请稍后再试";
      case "forbidden":
        return "你没有编辑这段日志的权限";
      case "unauthorized":
        return "登录状态已过期，请重新登录";
      case "network":
        return "网络不可用，请检查连接后重试";
      case "upstream":
        return "AI 服务暂时不可用，请重试";
      case "invalid_request":
        return "这次改写请求不合法，请重新选择文本";
      default:
        return "改写失败，请重试";
    }
  }

  return "改写失败，请重试";
}

/** Exposed for parity assertions in tests. */
export const rewriteFailureKind = aiFailureKind;
