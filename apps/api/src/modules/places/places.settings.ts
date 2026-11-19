/**
 * Settings for the Places module.
 *
 * Until SETTINGS_WIRING_1 these values were resolved from `process.env` once at
 * module construction, so every `places.*` row in the admin console was stored
 * but never read. The module now resolves them at request time:
 *
 * - `PlacesSettingsResolver` reads `SettingsService.getGroup("places")` and
 *   merges it over the environment and the code defaults.
 * - Priority: `envLocked` keys use the environment; every other key is
 *   `database value > environment > code default`.
 * - A database outage (or an empty/missing row) falls back to the environment
 *   and logs one throttled warning; it must never block startup or a search.
 * - No extra cache is added here: `SettingsService` already has a 5 s process
 *   cache and a 300 s Redis cache.
 *
 * `baseUrl`, timeouts, fallback and rate-limit tuning still come from the
 * environment only: the settings console has no keys for them.
 */

import { Inject, Injectable } from "@nestjs/common";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { SETTINGS_BY_KEY } from "../settings/settings.registry.js";
import { SettingsService } from "../settings/settings.service.js";

export const PLACES_SETTINGS = Symbol("ROAMLOG_PLACES_SETTINGS");

export type PlacesProvider = "geoapify" | "photon";
export type PlacesLanguage = "zh" | "en";

export const DEFAULT_PLACES_PROVIDER: PlacesProvider = "geoapify";
export const DEFAULT_PHOTON_URL = "https://photon.komoot.io/api";
export const DEFAULT_PHOTON_TIMEOUT_MS = 2_500;
export const DEFAULT_GEOAPIFY_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
/** The design sets a 1.2 s budget for the primary source (Photon's TTFB is ~1.6 s). */
export const DEFAULT_GEOAPIFY_TIMEOUT_MS = 1_200;
/** Geoapify's free plan allows 3,000 requests per day. */
export const DEFAULT_GEOAPIFY_DAILY_LIMIT = 3_000;
export const DEFAULT_PLACES_FALLBACK_TO_PHOTON = true;
export const DEFAULT_PLACES_CACHE_TTL_SECONDS = 15 * 60;
export const DEFAULT_PLACES_EMPTY_CACHE_TTL_SECONDS = 30;
export const DEFAULT_PLACES_RATE_LIMIT_MAX = 30;
export const DEFAULT_PLACES_RATE_LIMIT_WINDOW_SECONDS = 60;
export const DEFAULT_PLACES_RATE_LIMIT_TIMEOUT_MS = 750;
export const DEFAULT_PLACES_REDIS_TIMEOUT_MS = 500;
/** Contract default for `GET /v1/places/search` and the `places.limit` default. */
export const DEFAULT_PLACES_LIMIT = 6;
export const DEFAULT_PLACES_LANG: PlacesLanguage = "zh";

/** Never log more than one fallback warning per window. */
const SETTINGS_WARN_THROTTLE_MS = 10_000;

export interface PlacesSettings {
  /** Primary search source. `photon` keeps the legacy path as a rollback switch. */
  readonly provider: PlacesProvider;
  /** Full Photon search endpoint, for example `https://photon.komoot.io/api`. */
  readonly baseUrl: string;
  /** Hard Photon upstream budget enforced with an AbortController. */
  readonly timeoutMs: number;
  /** Full Geoapify autocomplete endpoint. */
  readonly geoapifyBaseUrl: string;
  /** Server-side only. `null` means "not configured": Geoapify is skipped. */
  readonly geoapifyApiKey: string | null;
  /** Hard Geoapify budget enforced with an AbortController. */
  readonly geoapifyTimeoutMs: number;
  /** Redis daily request cap; over the cap Geoapify is not called at all. */
  readonly geoapifyDailyLimit: number;
  /** Whether a failed/over-quota Geoapify search may be served by Photon. */
  readonly fallbackToPhoton: boolean;
  /** TTL for non-empty, non-degraded results. */
  readonly cacheTtlSeconds: number;
  /** TTL for empty and degraded results, to avoid hammering the upstream. */
  readonly emptyCacheTtlSeconds: number;
  /** Per-user+IP fixed window allowance. */
  readonly rateLimitMax: number;
  readonly rateLimitWindowSeconds: number;
  readonly rateLimitTimeoutMs: number;
  /** Redis operations are best-effort; never let them block a search for long. */
  readonly redisTimeoutMs: number;
  /** Default result limit when a request omits `?limit` (admin `places.limit`). */
  readonly defaultLimit: number;
  /** Default language when a request omits `?lang` (admin `places.lang`). */
  readonly defaultLang: PlacesLanguage;
}

function integerSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function stringSetting(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name]?.trim();
  return raw ? raw : fallback;
}

function providerSetting(env: NodeJS.ProcessEnv): PlacesProvider {
  const raw = env.PLACES_PROVIDER?.trim().toLowerCase();
  return raw === "geoapify" || raw === "photon" ? raw : DEFAULT_PLACES_PROVIDER;
}

function languageSetting(env: NodeJS.ProcessEnv): PlacesLanguage {
  const raw = env.PLACES_LANG?.trim().toLowerCase();
  return raw === "zh" || raw === "en" ? raw : DEFAULT_PLACES_LANG;
}

function booleanSetting(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

export function resolvePlacesSettings(env: NodeJS.ProcessEnv = process.env): PlacesSettings {
  return {
    provider: providerSetting(env),
    baseUrl: stringSetting(env, "PHOTON_URL", DEFAULT_PHOTON_URL),
    timeoutMs: integerSetting(env, "PHOTON_TIMEOUT_MS", DEFAULT_PHOTON_TIMEOUT_MS, 1, 30_000),
    geoapifyBaseUrl: stringSetting(env, "GEOAPIFY_URL", DEFAULT_GEOAPIFY_URL),
    geoapifyApiKey: stringSetting(env, "GEOAPIFY_API_KEY", "") || null,
    geoapifyTimeoutMs: integerSetting(
      env,
      "GEOAPIFY_TIMEOUT_MS",
      DEFAULT_GEOAPIFY_TIMEOUT_MS,
      1,
      30_000,
    ),
    geoapifyDailyLimit: integerSetting(
      env,
      "GEOAPIFY_DAILY_LIMIT",
      DEFAULT_GEOAPIFY_DAILY_LIMIT,
      0,
      1_000_000,
    ),
    fallbackToPhoton: booleanSetting(
      env,
      "PLACES_FALLBACK_TO_PHOTON",
      DEFAULT_PLACES_FALLBACK_TO_PHOTON,
    ),
    cacheTtlSeconds: integerSetting(
      env,
      "PLACES_CACHE_TTL_SECONDS",
      DEFAULT_PLACES_CACHE_TTL_SECONDS,
      1,
      86_400,
    ),
    emptyCacheTtlSeconds: integerSetting(
      env,
      "PLACES_EMPTY_CACHE_TTL_SECONDS",
      DEFAULT_PLACES_EMPTY_CACHE_TTL_SECONDS,
      1,
      3_600,
    ),
    rateLimitMax: integerSetting(
      env,
      "PLACES_RATE_LIMIT_MAX",
      DEFAULT_PLACES_RATE_LIMIT_MAX,
      1,
      100_000,
    ),
    rateLimitWindowSeconds: integerSetting(
      env,
      "PLACES_RATE_LIMIT_WINDOW_SECONDS",
      DEFAULT_PLACES_RATE_LIMIT_WINDOW_SECONDS,
      1,
      86_400,
    ),
    rateLimitTimeoutMs: integerSetting(
      env,
      "PLACES_RATE_LIMIT_TIMEOUT_MS",
      DEFAULT_PLACES_RATE_LIMIT_TIMEOUT_MS,
      1,
      5_000,
    ),
    redisTimeoutMs: integerSetting(
      env,
      "PLACES_REDIS_TIMEOUT_MS",
      DEFAULT_PLACES_REDIS_TIMEOUT_MS,
      1,
      5_000,
    ),
    defaultLimit: integerSetting(env, "PLACES_LIMIT", DEFAULT_PLACES_LIMIT, 1, 10),
    defaultLang: languageSetting(env),
  };
}

/** Environment fallback for each admin-editable `places.*` key. */
const PLACES_ENV_VARS: Readonly<Record<string, string>> = Object.freeze({
  "places.provider": "PLACES_PROVIDER",
  "places.apiKey": "GEOAPIFY_API_KEY",
  "places.lang": "PLACES_LANG",
  "places.limit": "PLACES_LIMIT",
  "places.cacheTtlSeconds": "PLACES_CACHE_TTL_SECONDS",
  "places.dailyQuota": "GEOAPIFY_DAILY_LIMIT",
});

export interface SettingEnvLock {
  readonly envLocked: boolean;
  readonly envVar?: string;
}

/** Registry metadata the merge needs; injectable so tests can lock a key. */
export type SettingEnvLockLookup = (key: string) => SettingEnvLock | undefined;

export interface PlacesSettingsInputs {
  readonly env?: NodeJS.ProcessEnv;
  readonly stored?: Readonly<Record<string, unknown>> | null;
  readonly envLockOf?: SettingEnvLockLookup;
}

export interface PlacesSettingsResolution {
  readonly settings: PlacesSettings;
  /** Stored keys whose value could not be applied; never contains the value. */
  readonly ignored: readonly { readonly key: string; readonly reason: string }[];
}

function parseStoredProvider(value: unknown): PlacesProvider | undefined {
  return value === "geoapify" || value === "photon" ? value : undefined;
}

function parseStoredApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseStoredLanguage(value: unknown): PlacesLanguage | undefined {
  return value === "zh" || value === "en" ? value : undefined;
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
  const envVar = envLockOf?.(key)?.envVar ?? PLACES_ENV_VARS[key];

  // An env-locked key must never be overridden by the database. Production
  // `places.*` keys are not locked today, but the rule is enforced here so a
  // future lock cannot silently lose to a stored row.
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

function providerFromEnv(raw: string): PlacesProvider | undefined {
  const value = raw.trim().toLowerCase();
  return value === "geoapify" || value === "photon" ? value : undefined;
}

function languageFromEnv(raw: string): PlacesLanguage | undefined {
  const value = raw.trim().toLowerCase();
  return value === "zh" || value === "en" ? value : undefined;
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
 * `SettingsService` already applies `envLocked` overrides on read, but this
 * function enforces the documented priority again so callers that hand it raw
 * rows (and tests) cannot accidentally let the database beat a locked key.
 */
export function resolvePlacesSettingsFromStored(
  inputs: PlacesSettingsInputs = {},
): PlacesSettingsResolution {
  const env = inputs.env ?? process.env;
  const stored = inputs.stored ?? null;
  const envLockOf = inputs.envLockOf;
  const base = resolvePlacesSettings(env);
  const ignored: { key: string; reason: string }[] = [];

  const provider = effectiveValue(
    "places.provider",
    stored,
    env,
    envLockOf,
    parseStoredProvider,
    providerFromEnv,
  );
  const apiKey = effectiveValue(
    "places.apiKey",
    stored,
    env,
    envLockOf,
    parseStoredApiKey,
    (raw) => parseStoredApiKey(raw),
  );
  const lang = effectiveValue(
    "places.lang",
    stored,
    env,
    envLockOf,
    parseStoredLanguage,
    languageFromEnv,
  );
  const limit = effectiveValue(
    "places.limit",
    stored,
    env,
    envLockOf,
    (value) => parseStoredInteger(value, 1, 10),
    integerFromEnv(1, 10),
  );
  const cacheTtl = effectiveValue(
    "places.cacheTtlSeconds",
    stored,
    env,
    envLockOf,
    (value) => parseStoredInteger(value, 60, 86_400),
    integerFromEnv(1, 86_400),
  );
  const dailyQuota = effectiveValue(
    "places.dailyQuota",
    stored,
    env,
    envLockOf,
    (value) => parseStoredInteger(value, 0, 1_000_000),
    integerFromEnv(0, 1_000_000),
  );

  for (const [key, entry] of [
    ["places.provider", provider],
    ["places.apiKey", apiKey],
    ["places.lang", lang],
    ["places.limit", limit],
    ["places.cacheTtlSeconds", cacheTtl],
    ["places.dailyQuota", dailyQuota],
  ] as const) {
    if (entry.ignored) {
      ignored.push({ key, reason: "unsupported_value" });
    }
  }

  return {
    settings: {
      ...base,
      provider: provider.value ?? base.provider,
      geoapifyApiKey: apiKey.value ?? base.geoapifyApiKey,
      defaultLang: lang.value ?? base.defaultLang,
      defaultLimit: limit.value ?? base.defaultLimit,
      cacheTtlSeconds: cacheTtl.value ?? base.cacheTtlSeconds,
      geoapifyDailyLimit: dailyQuota.value ?? base.geoapifyDailyLimit,
    },
    ignored,
  };
}

/** Resolves the effective settings for one request; see the file header. */
export interface PlacesSettingsSource {
  resolve(): Promise<PlacesSettings>;
}

/** Test helper: a source that always answers the same snapshot. */
export function staticPlacesSettingsSource(settings: PlacesSettings): PlacesSettingsSource {
  return { resolve: async () => settings };
}

@Injectable()
export class PlacesSettingsResolver implements PlacesSettingsSource {
  private lastWarnAt = 0;

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async resolve(): Promise<PlacesSettings> {
    let stored: Record<string, unknown> | null = null;
    try {
      stored = await this.settings.getGroup("places");
    } catch (error) {
      // No database row yet, a DB outage, or a stored value that no longer
      // validates: search keeps working from the environment. Startup is never
      // blocked because this only runs on the first request.
      this.warnFallback(error);
    }

    const resolution = resolvePlacesSettingsFromStored({
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
      this.logger.warn(
        { event: "places.setting_value_ignored", key: entry.key, reason: entry.reason },
        "places.setting_value_ignored",
      );
    }

    return resolution.settings;
  }

  private warnFallback(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < SETTINGS_WARN_THROTTLE_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      {
        event: "places.settings_unavailable",
        ...(error instanceof Error ? { reason: error.name } : {}),
      },
      "places.settings_fallback_env",
    );
  }
}