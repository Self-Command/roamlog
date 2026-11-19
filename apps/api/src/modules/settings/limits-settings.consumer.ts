/**
 * Runtime consumer for the two `limits.*` settings.
 *
 * Until LIMITS_SETTINGS_WIRED these rows were stored but never read: the place
 * search allowance came from `PLACES_RATE_LIMIT_MAX` and the presign allowance
 * from `MEDIA_PRESIGN_RATE_LIMIT_MAX`, both resolved once from the environment.
 *
 * Priority, per key:
 *
 * 1. `envLocked` (registry definition or row flag) with the env var present →
 *    environment.
 * 2. A stored database row → database.
 * 3. The environment variable → environment.
 * 4. Code constant → default (30 search / 20 upload, the legacy runtime values).
 *
 * The reader is `SettingsService.listAdminSettings()` rather than
 * `getGroup("limits")`: `getGroup` merges registry defaults into its result, so
 * an absent row is indistinguishable from a stored value equal to the default,
 * and the environment fallback would never win on a fresh database. This is the
 * same row-existence check the storage consumer uses (`updatedAt === null`).
 *
 * No cache is added here. The limiter must react to an operator change on the
 * next request, so every call does one indexed settings read; a local cache
 * would make "save in admin, wait for the TTL" observable. A database outage or
 * an invalid stored value never throws and never blocks startup.
 */

import { Inject, Injectable } from "@nestjs/common";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { SETTINGS_BY_KEY } from "./settings.registry.js";
import { SettingsService } from "./settings.service.js";

export const LIMITS_SETTINGS = Symbol("ROAMLOG_LIMITS_SETTINGS");

export const LIMITS_SETTING_KEYS = [
  "limits.searchPerMinute",
  "limits.uploadPerMinute",
] as const;

export type LimitsSettingKey = (typeof LIMITS_SETTING_KEYS)[number];

/** Registry contract for every `limits.*` key (`z.number().int().min(1).max(600)`). */
export const MIN_PER_MINUTE = 1;
export const MAX_PER_MINUTE = 600;

/** Legacy place-search allowance; also the registry default. */
export const DEFAULT_SEARCH_PER_MINUTE = 30;
/** Legacy presign allowance (`MEDIA_PRESIGN_RATE_LIMIT_MAX` default 20). */
export const DEFAULT_UPLOAD_PER_MINUTE = 20;

/** Environment fallbacks that existed before the keys were wired. */
export const LIMITS_ENV_VARS: Readonly<Record<LimitsSettingKey, string>> = Object.freeze({
  "limits.searchPerMinute": "PLACES_RATE_LIMIT_MAX",
  "limits.uploadPerMinute": "MEDIA_PRESIGN_RATE_LIMIT_MAX",
});

/** The environment keeps its own broader bounds so existing configs stay valid. */
const ENV_BOUNDS: Readonly<Record<LimitsSettingKey, { readonly min: number; readonly max: number }>> =
  Object.freeze({
    "limits.searchPerMinute": { min: 1, max: 100_000 },
    "limits.uploadPerMinute": { min: 1, max: 100_000 },
  });

/** Never log the same fallback more than once per window. */
const WARN_THROTTLE_MS = 10_000;

/** Effective per-minute allowances for one request. */
export interface LimitsRuntime {
  /** Per-account place-search allowance (`limits.searchPerMinute`), 1..600. */
  readonly searchPerMinute: number;
  /** Per-account presign allowance (`limits.uploadPerMinute`), 1..600. */
  readonly uploadPerMinute: number;
}

/** Narrow port so the limiter can be built without Nest in tests. */
export interface LimitsSettingsSource {
  resolve(): Promise<LimitsRuntime>;
}

/** Test helper: a source that always answers the same snapshot. */
export function staticLimitsSettingsSource(runtime: LimitsRuntime): LimitsSettingsSource {
  return { resolve: async () => runtime };
}

export interface LimitsSettingEnvLock {
  readonly envLocked: boolean;
  readonly envVar?: string;
}

/** Registry metadata the merge needs; injectable so tests can lock a key. */
export type LimitsEnvLockLookup = (key: string) => LimitsSettingEnvLock | undefined;

/** The subset of `AdminSettingItem` this consumer needs (keeps tests terse). */
export interface StoredLimitSetting {
  readonly key: string;
  readonly value: unknown;
  /** `null` means "no database row", as returned by `listAdminSettings()`. */
  readonly updatedAt: string | null;
}

export interface LimitsSettingsInputs {
  readonly env?: NodeJS.ProcessEnv;
  readonly stored?: readonly StoredLimitSetting[] | null;
  readonly envLockOf?: LimitsEnvLockLookup;
}

export interface LimitsSettingsResolution {
  readonly runtime: LimitsRuntime;
  /** Stored keys whose value could not be applied; never contains the value. */
  readonly ignored: readonly { readonly key: LimitsSettingKey; readonly reason: string }[];
}

function defaultFor(key: LimitsSettingKey): number {
  return key === "limits.searchPerMinute"
    ? DEFAULT_SEARCH_PER_MINUTE
    : DEFAULT_UPLOAD_PER_MINUTE;
}

function parseStoredInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PER_MINUTE &&
    value <= MAX_PER_MINUTE
    ? value
    : undefined;
}

function parseEnvInteger(raw: string | undefined, key: LimitsSettingKey): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const parsed = Number(raw.trim());
  const bounds = ENV_BOUNDS[key];
  return Number.isInteger(parsed) && parsed >= bounds.min && parsed <= bounds.max
    ? parsed
    : undefined;
}

function storedByKey(
  stored: readonly StoredLimitSetting[] | null | undefined,
): ReadonlyMap<string, StoredLimitSetting> {
  return new Map((stored ?? []).map((entry) => [entry.key, entry]));
}

function effectiveValue(
  key: LimitsSettingKey,
  rows: ReadonlyMap<string, StoredLimitSetting>,
  env: NodeJS.ProcessEnv,
  envLockOf: LimitsEnvLockLookup | undefined,
): { readonly value: number; readonly ignored: boolean } {
  const envVar = envLockOf?.(key)?.envVar ?? LIMITS_ENV_VARS[key];

  // An env-locked key must never be overridden by the database. `limits.*` is
  // not locked today, but the rule is enforced so a future lock cannot silently
  // lose to a stored row.
  if (envLockOf?.(key)?.envLocked === true) {
    const locked = parseEnvInteger(env[envVar], key);
    if (locked !== undefined) {
      return { value: locked, ignored: false };
    }
  }

  const row = rows.get(key);
  if (row && row.updatedAt !== null) {
    const parsed = parseStoredInteger(row.value);
    if (parsed !== undefined) {
      return { value: parsed, ignored: false };
    }
    return { value: parseEnvInteger(env[envVar], key) ?? defaultFor(key), ignored: true };
  }

  return {
    value: parseEnvInteger(env[envVar], key) ?? defaultFor(key),
    ignored: false,
  };
}

/**
 * Pure merge of stored settings over the environment and the legacy defaults.
 *
 * `SettingsService` already applies `envLocked` overrides for its own reads,
 * but this function enforces the documented priority again so callers that hand
 * it raw rows (and tests) cannot accidentally let the database beat a locked
 * key.
 */
export function resolveLimitsSettingsFromStored(
  inputs: LimitsSettingsInputs = {},
): LimitsSettingsResolution {
  const env = inputs.env ?? process.env;
  const rows = storedByKey(inputs.stored);
  const ignored: { key: LimitsSettingKey; reason: string }[] = [];

  const resolved = {} as Record<LimitsSettingKey, number>;
  for (const key of LIMITS_SETTING_KEYS) {
    const entry = effectiveValue(key, rows, env, inputs.envLockOf);
    resolved[key] = entry.value;
    if (entry.ignored) {
      ignored.push({ key, reason: "unsupported_value" });
    }
  }

  return {
    runtime: {
      searchPerMinute: resolved["limits.searchPerMinute"],
      uploadPerMinute: resolved["limits.uploadPerMinute"],
    },
    ignored,
  };
}

type LimitsSettingsReader = Pick<SettingsService, "listAdminSettings">;

/** Resolves the effective allowances for one request; see the file header. */
@Injectable()
export class LimitsSettingsResolver implements LimitsSettingsSource {
  private lastWarnAt = 0;

  constructor(
    @Inject(SettingsService) private readonly settings: LimitsSettingsReader,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async resolve(): Promise<LimitsRuntime> {
    let stored: readonly StoredLimitSetting[] | null = null;
    try {
      const response = await this.settings.listAdminSettings();
      stored = (response.groups.find((group) => group.group === "limits")?.items ?? []).map(
        (item) => ({ key: item.key, value: item.value, updatedAt: item.updatedAt }),
      );
    } catch (error) {
      // Database outage: the limiter keeps working from the environment. It
      // must never block a request or startup; the warning is throttled.
      this.warn(
        "limits.settings_unavailable",
        error instanceof Error ? error : { reason: "unknown" },
      );
    }

    const resolution = resolveLimitsSettingsFromStored({
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
      this.warn("limits.setting_value_ignored", { key: entry.key, reason: entry.reason });
    }

    return resolution.runtime;
  }

  private warn(event: string, detail: Record<string, unknown> | Error = {}): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_THROTTLE_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      { event, ...(detail instanceof Error ? { reason: detail.name } : detail) },
      event,
    );
  }
}