/**
 * AI gateway settings.
 *
 * Two layers:
 *
 * 1. `resolveAiSettings` reads the `AI_*` environment variables once; it is the
 *    fallback and the source of the upstream credentials (base URL, key, model).
 * 2. `AiSettingsResolver` reads `SettingsService.getGroup("ai")` on every
 *    request and overlays the four admin keys on top:
 *    `ai.defaultProvider`, `ai.timeoutMs`, `ai.maxOutputTokens`, `ai.dailyQuota`.
 *
 * Priority: an `envLocked` key always uses the environment; every other key is
 * `database value > environment > code default`. A database outage, a missing
 * row or a stored value the runtime cannot honour falls back to the environment
 * with a throttled warning — it never blocks startup and never turns a request
 * into a 500. No extra cache is added: `SettingsService` already has a 5 s
 * process cache and a 300 s Redis cache.
 *
 * `ai.defaultProvider` is intentionally constrained to the adapter protocol
 * enum. The admin field is free text, but the only "providers" this server can
 * drive are the three wire protocols; a stored value the runtime does not know
 * is ignored (and logged) instead of being passed down as an unknown protocol.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { SETTINGS_BY_KEY } from "../settings/settings.registry.js";
import { SettingsService } from "../settings/settings.service.js";

/** Injection token for the per-request settings source. */
export const AI_SETTINGS_SOURCE = Symbol("ROAMLOG_AI_SETTINGS_SOURCE");

/** Injectable clock, so tests (and the system prompt) do not depend on `Date.now()`. */
export const AI_CLOCK = Symbol("ROAMLOG_AI_CLOCK");
export type AiClock = () => Date;

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

/** Never log more than one fallback / ignored-value warning per window. */
const SETTINGS_WARN_THROTTLE_MS = 10_000;

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

/** Environment fallback for each admin-editable `ai.*` key. */
const AI_ENV_VARS: Readonly<Record<string, string>> = Object.freeze({
  "ai.defaultProvider": "AI_PROTOCOL",
  "ai.timeoutMs": "AI_TIMEOUT_MS",
  "ai.maxOutputTokens": "AI_MAX_OUTPUT_TOKENS",
  "ai.dailyQuota": "AI_DAILY_QUOTA",
});

/**
 * Bounds come from the settings registry schema (the contract the admin console
 * enforces), not from the stricter environment validator: the database accepts
 * 1 s timeouts and 65 536 output tokens, and the runtime must honour what the
 * console allows to save.
 */
const AI_TIMEOUT_BOUNDS = [1_000, 120_000] as const;
const AI_MAX_OUTPUT_TOKENS_BOUNDS = [256, 65_536] as const;
const AI_DAILY_QUOTA_BOUNDS = [0, 1_000_000] as const;

export interface SettingEnvLock {
  readonly envLocked: boolean;
  readonly envVar?: string;
}

/** Registry metadata the merge needs; injectable so tests can lock a key. */
export type SettingEnvLockLookup = (key: string) => SettingEnvLock | undefined;

export interface AiSettingsInputs {
  readonly env?: NodeJS.ProcessEnv;
  readonly stored?: Readonly<Record<string, unknown>> | null;
  readonly envLockOf?: SettingEnvLockLookup;
}

export interface AiSettingsResolution {
  readonly settings: AiSettings;
  /** Stored keys whose value could not be applied; never contains the value. */
  readonly ignored: readonly { readonly key: string; readonly reason: string }[];
}

function parseStoredProtocol(value: unknown): AiProtocol | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return AI_PROTOCOLS.includes(normalized as AiProtocol) ? (normalized as AiProtocol) : undefined;
}

function parseStoredInteger(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

type ValueParser<T> = (value: unknown) => T | undefined;

interface EffectiveValue<T> {
  readonly value: T | undefined;
  /** The key had a stored value that its parser rejected. */
  readonly ignored: boolean;
}

function effectiveValue<T>(
  key: string,
  stored: Readonly<Record<string, unknown>> | null,
  env: NodeJS.ProcessEnv,
  envLockOf: SettingEnvLockLookup | undefined,
  parseStored: ValueParser<T>,
  parseEnv: (raw: string) => T | undefined,
): EffectiveValue<T> {
  const storedValue = stored ? stored[key] : undefined;
  const envVar = envLockOf?.(key)?.envVar ?? AI_ENV_VARS[key];

  // An env-locked key must never be overridden by the database, even if a caller
  // hands the merge raw rows instead of going through `SettingsService`.
  if (envLockOf?.(key)?.envLocked === true && envVar) {
    const raw = env[envVar];
    if (raw !== undefined && raw !== "") {
      return { value: parseEnv(raw), ignored: false };
    }
  }

  if (storedValue !== undefined && storedValue !== null) {
    const parsed = parseStored(storedValue);
    if (parsed !== undefined) {
      return { value: parsed, ignored: false };
    }
    return { value: undefined, ignored: true };
  }

  const raw = envVar ? env[envVar] : undefined;
  if (raw !== undefined && raw !== "") {
    return { value: parseEnv(raw), ignored: false };
  }
  return { value: undefined, ignored: false };
}

function protocolFromEnv(raw: string): AiProtocol | undefined {
  return parseStoredProtocol(raw);
}

function integerFromEnv(min: number, max: number): (raw: string) => number | undefined {
  return (raw) => {
    const parsed = Number(raw.trim());
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
  };
}

/**
 * Pure merge of stored settings over the environment and code defaults.
 *
 * `baseUrl`/`apiKey`/`model` stay environment-only: the console has no keys for
 * them, and switching provider must never silently point at another upstream.
 */
export function resolveAiSettingsFromStored(
  inputs: AiSettingsInputs = {},
): AiSettingsResolution {
  const env = inputs.env ?? process.env;
  const stored = inputs.stored ?? null;
  const envLockOf = inputs.envLockOf;
  const base = resolveAiSettings(env);
  const ignored: { key: string; reason: string }[] = [];

  const protocol = effectiveValue(
    "ai.defaultProvider",
    stored,
    env,
    envLockOf,
    parseStoredProtocol,
    protocolFromEnv,
  );
  const timeoutMs = effectiveValue(
    "ai.timeoutMs",
    stored,
    env,
    envLockOf,
    (value) => parseStoredInteger(value, ...AI_TIMEOUT_BOUNDS),
    integerFromEnv(...AI_TIMEOUT_BOUNDS),
  );
  const maxOutputTokens = effectiveValue(
    "ai.maxOutputTokens",
    stored,
    env,
    envLockOf,
    (value) => parseStoredInteger(value, ...AI_MAX_OUTPUT_TOKENS_BOUNDS),
    integerFromEnv(...AI_MAX_OUTPUT_TOKENS_BOUNDS),
  );
  const dailyQuota = effectiveValue(
    "ai.dailyQuota",
    stored,
    env,
    envLockOf,
    (value) => parseStoredInteger(value, ...AI_DAILY_QUOTA_BOUNDS),
    integerFromEnv(...AI_DAILY_QUOTA_BOUNDS),
  );

  for (const [key, entry] of [
    ["ai.defaultProvider", protocol],
    ["ai.timeoutMs", timeoutMs],
    ["ai.maxOutputTokens", maxOutputTokens],
    ["ai.dailyQuota", dailyQuota],
  ] as const) {
    if (entry.ignored) {
      ignored.push({ key, reason: "unsupported_value" });
    }
  }

  return {
    settings: {
      ...base,
      protocol: protocol.value ?? base.protocol,
      timeoutMs: timeoutMs.value ?? base.timeoutMs,
      maxOutputTokens: maxOutputTokens.value ?? base.maxOutputTokens,
      dailyQuota: dailyQuota.value ?? base.dailyQuota,
    },
    ignored,
  };
}

/** Resolves the effective settings for one request; see the file header. */
export interface AiSettingsSource {
  resolve(): Promise<AiSettings>;
}

/** Test helper: a source that always answers the same snapshot. */
export function staticAiSettingsSource(settings: AiSettings): AiSettingsSource {
  return { resolve: async () => settings };
}

@Injectable()
export class AiSettingsResolver implements AiSettingsSource {
  private lastWarnAt = 0;
  private lastIgnoredAt = 0;

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Optional() @Inject(AI_CLOCK) private readonly clock: AiClock = () => new Date(),
  ) {}

  async resolve(): Promise<AiSettings> {
    let stored: Record<string, unknown> | null = null;
    try {
      stored = await this.settings.getGroup("ai");
    } catch (error) {
      // No database row yet, a DB outage, or a stored value that no longer
      // validates: planning keeps working from the environment. Startup is never
      // blocked because this only runs on the first request.
      this.warnFallback(error);
    }

    const resolution = resolveAiSettingsFromStored({
      stored,
      env: process.env,
      envLockOf: (key) => {
        const definition = SETTINGS_BY_KEY.get(key);
        return definition
          ? {
              envLocked: definition.envLocked,
              ...(definition.envVar ? { envVar: definition.envVar } : {}),
            }
          : undefined;
      },
    });

    for (const entry of resolution.ignored) {
      this.warnIgnored(entry.key, entry.reason);
    }

    return resolution.settings;
  }

  private warnFallback(error: unknown): void {
    const now = this.clock().getTime();
    if (now - this.lastWarnAt < SETTINGS_WARN_THROTTLE_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      {
        event: "ai.settings_unavailable",
        ...(error instanceof Error ? { reason: error.name } : {}),
      },
      "ai.settings_fallback_env",
    );
  }

  private warnIgnored(key: string, reason: string): void {
    const now = this.clock().getTime();
    if (now - this.lastIgnoredAt < SETTINGS_WARN_THROTTLE_MS) {
      return;
    }
    this.lastIgnoredAt = now;
    this.logger.warn(
      { event: "ai.setting_value_ignored", key, reason },
      "ai.setting_value_ignored",
    );
  }
}