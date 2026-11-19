/**
 * Minimal JSON-over-HTTP helper shared by the three protocol adapters.
 *
 * - One `AbortController` enforces the whole-call budget (connect + body).
 * - Only necessary headers are sent; the key never leaves this function.
 * - Nothing here logs: callers log lengths/status/timing only, never prompts.
 */

export type AiUpstreamFailure = "timeout" | "http" | "network" | "invalid_response";

export class AiUpstreamError extends Error {
  constructor(
    readonly kind: AiUpstreamFailure,
    readonly httpStatus?: number,
    readonly detail?: string,
  ) {
    super(`AI upstream ${kind}${httpStatus ? ` (${httpStatus})` : ""}`);
    this.name = "AiUpstreamError";
  }
}

export interface PostJsonOptions {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly timeoutMs: number;
}

function recordPayload(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function postJson(options: PostJsonOptions): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs));

  try {
    let response: Response;
    try {
      response = await fetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify(options.body),
        redirect: "follow",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch {
      throw controller.signal.aborted
        ? new AiUpstreamError("timeout")
        : new AiUpstreamError("network");
    }

    if (!response.ok) {
      // The body is drained so the socket can be reused, but it is never logged
      // or echoed: upstream 4xx bodies may echo the prompt.
      await response.text().catch(() => "");
      throw new AiUpstreamError("http", response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiUpstreamError("invalid_response", response.status);
    }

    const record = recordPayload(payload);
    if (!record) {
      throw new AiUpstreamError("invalid_response", response.status);
    }
    return record;
  } finally {
    clearTimeout(timer);
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return recordPayload(value);
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function textValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Tool arguments arrive as a JSON string; malformed input becomes `{}` and the
 * tool validator rejects it, so the model gets a correctable error instead of a
 * 500. */
export function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return recordPayload(JSON.parse(raw) as unknown) ?? {};
    } catch {
      return {};
    }
  }
  return recordPayload(raw) ?? {};
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}