/**
 * Zero-dependency `text/event-stream` reader for upstream model gateways.
 *
 * The parser follows the SSE event-stream grammar (WHATWG / MDN) and stays
 * protocol-agnostic: `[DONE]` is surfaced as a normal frame and interpreted by
 * each adapter, so the same reader also serves Responses / Anthropic streams
 * that never send it.
 *
 * Implementation follows `.audit/ai-port-spec.md` §1.4.4/§1.4.5: only Node
 * built-ins (`fetch`, `ReadableStream`, `TextDecoder`), no `eventsource-parser`
 * and no `ai` SDK.
 *
 * Nothing here logs: upstream bodies may echo the prompt and must never reach
 * logs or error messages.
 */

import { AiUpstreamError } from "./http.js";

export interface SseFrame {
  readonly id?: string;
  readonly event?: string;
  readonly data: string;
}

export interface PostSseInit {
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_SSE_TIMEOUT_MS = 60_000;

/**
 * Upper bound for one upstream SSE block. Provider deltas are normally far
 * smaller; this prevents an unterminated or malicious frame from growing the
 * parser buffer without bound before the protocol-level delta cap applies.
 */
export const MAX_UPSTREAM_SSE_FRAME_CHARS = 1_048_576;

/** Two consecutive line endings delimit a frame. `\r?` covers CRLF and LF. */
const FRAME_SEPARATOR = /\r?\n\r?\n/;

/** Per-line split used by the field parser; keeps a trailing `\r` off values. */
const LINE_SEPARATOR = /\r?\n/;

/**
 * Reads an SSE body and yields one frame per blank-line-terminated block.
 *
 * Handles CRLF/LF, multi-line `data:` (joined with `\n`), comment lines
 * (`: hb`), `[DONE]`, multiple frames per chunk, frames split across chunks,
 * UTF-8 characters split across chunk boundaries (via `TextDecoder` with
 * `{ stream: true }`) and a final frame with no trailing blank line.
 *
 * When `signal` aborts, the reader is cancelled and the generator ends
 * normally — callers observe a clean end, not an uncaught `AbortError`.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let aborted = signal?.aborted === true;

  const onAbort = (): void => {
    aborted = true;
    // Cancelling wakes up a pending `reader.read()` so the generator can end
    // without surfacing an AbortError to its consumer.
    void reader.cancel().catch(() => undefined);
  };

  if (signal) {
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    if (aborted) {
      return;
    }

    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (aborted || signal?.aborted) {
          return;
        }
        // A reader abort that was not requested by the caller is the upstream
        // total budget firing (postSse passes AbortSignal.timeout).
        throw isAbortError(error) ? new AiUpstreamError("timeout") : new AiUpstreamError("network");
      }

      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, { stream: true });

      for (;;) {
        const match = FRAME_SEPARATOR.exec(buffer);
        if (!match) {
          break;
        }
        const raw = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (raw.length > MAX_UPSTREAM_SSE_FRAME_CHARS) {
          throw new AiUpstreamError("invalid_response");
        }
        const frame = parseFrame(raw);
        if (frame) {
          yield frame;
        }
      }

      if (aborted) {
        return;
      }
      if (buffer.length > MAX_UPSTREAM_SSE_FRAME_CHARS) {
        throw new AiUpstreamError("invalid_response");
      }
    }

    // An abort can land while a frame is half-received; never flush that
    // partial frame to protocol adapters as if it were complete.
    if (aborted) {
      return;
    }

    // Flush the decoder (a multi-byte char may still be pending) and emit a
    // trailing frame that was not followed by a blank line.
    buffer += decoder.decode();
    const last = parseFrame(buffer);
    if (last) {
      yield last;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be cancelled by an abort; release is harmless
      // but can throw on some runtimes.
    }
  }
}

/**
 * POSTs a JSON body and returns the live SSE response stream.
 *
 * Non-2xx responses throw `AiUpstreamError("http", status)` after draining the
 * body; the body is never logged, returned or embedded in the error message —
 * upstream 4xx bodies may echo the prompt.
 */
export async function postSse(url: string, init: PostSseInit = {}): Promise<Response> {
  const timeoutMs =
    init.timeoutMs === undefined ? DEFAULT_SSE_TIMEOUT_MS : Math.max(1, init.timeoutMs);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...init.headers,
      },
      body: JSON.stringify(init.body ?? {}),
      redirect: "follow",
      credentials: "omit",
      signal,
    });
  } catch {
    if (timeout.aborted) {
      throw new AiUpstreamError("timeout");
    }
    throw new AiUpstreamError("network");
  }

  if (!response.ok || !response.body) {
    // Drain so the socket can be reused; content stays out of logs/errors.
    await response.text().catch(() => "");
    throw new AiUpstreamError("http", response.status);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream")) {
    await response.body.cancel().catch(() => undefined);
    throw new AiUpstreamError("invalid_response", response.status);
  }

  return response;
}

function parseFrame(raw: string): SseFrame | undefined {
  if (raw.length === 0) {
    return undefined;
  }

  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];

  for (const line of raw.split(LINE_SEPARATOR)) {
    // Blank lines are frame separators; `:` lines are comments / heartbeats.
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // Per the SSE spec, exactly one leading space after the colon is removed.
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") {
      event = value;
    } else if (field === "id") {
      id = value;
    } else if (field === "data") {
      data.push(value);
    }
  }

  // A frame without `data:` is a comment/heartbeat and must not reach adapters.
  if (data.length === 0) {
    return undefined;
  }

  return {
    ...(event === undefined ? {} : { event }),
    ...(id === undefined ? {} : { id }),
    data: data.join("\n"),
  };
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}
