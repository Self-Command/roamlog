/**
 * AI gateway settings, resolved from `AI_*` environment variables.
 *
 * Resolved from `process.env` (like the Places module) rather than a DB-backed
 * settings registry: providers are still a deployment concern in this slice.
 * Missing values never crash the module — `configured` is false and the AI
 * endpoints answer `503 AI_NOT_CONFIGURED`.
 */

export const AI_SETTINGS = Symbol("ROAMLOG_AI_SETTINGS");

export type AiProtocol = "openai-chat" | "openai-responses" | "anthropic-messages";

export const AI_PROTOCOLS: readonly AiProtocol[] = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
];

export const DEFAULT_AI_PROTOCOL: AiProtocol = "openai-chat";
export const DEFAULT_AI_TIMEOUT_MS = 60_000;
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 6_000;
export const DEFAULT_AI_DAILY_QUOTA = 20;

export interface AiSettings {
  readonly protocol: AiProtocol;
  /** Full API root, for example `http://127.0.0.1:3425/v1`. */
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  /** Per-user daily plan-run cap. `0` disables the cap. */
  readonly dailyQuota: number;
  readonly configured: boolean;
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const raw = text(value);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function resolveAiSettings(env: NodeJS.ProcessEnv = process.env): AiSettings {
  const protocolRaw = text(env.AI_PROTOCOL)?.toLowerCase();
  const protocol = AI_PROTOCOLS.includes(protocolRaw as AiProtocol)
    ? (protocolRaw as AiProtocol)
    : DEFAULT_AI_PROTOCOL;

  const baseUrl = text(env.AI_BASE_URL)?.replace(/\/+$/u, "") ?? null;
  const apiKey = text(env.AI_API_KEY) ?? null;
  const model = text(env.AI_MODEL) ?? "";
  // The key may legitimately be empty for a local gateway; what makes the module
  // unusable is an unknown upstream or endpoint.
  const configured = Boolean(baseUrl && model);

  return {
    protocol,
    baseUrl,
    apiKey,
    model,
    timeoutMs: integer(env.AI_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS, 5_000, 120_000),
    maxOutputTokens: integer(env.AI_MAX_OUTPUT_TOKENS, DEFAULT_AI_MAX_OUTPUT_TOKENS, 256, 32_000),
    dailyQuota: integer(env.AI_DAILY_QUOTA, DEFAULT_AI_DAILY_QUOTA, 0, 100_000),
    configured,
  };
}