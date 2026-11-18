/**
 * Settings for the Places module.
 *
 * These values are intentionally resolved from `process.env` with safe defaults
 * instead of `AppConfigService`: the shared environment schema lives outside this
 * module's file boundary. Follow-up: move `PHOTON_URL`, `PHOTON_TIMEOUT_MS`,
 * `PLACES_CACHE_TTL_SECONDS`, `PLACES_EMPTY_CACHE_TTL_SECONDS` and
 * `PLACES_RATE_LIMIT_MAX` into `apps/api/src/config/environment.ts` once the
 * config owner picks them up.
 */

export const PLACES_SETTINGS = Symbol("ROAMLOG_PLACES_SETTINGS");

export const DEFAULT_PHOTON_URL = "https://photon.komoot.io/api";
export const DEFAULT_PHOTON_TIMEOUT_MS = 2_500;
export const DEFAULT_PLACES_CACHE_TTL_SECONDS = 15 * 60;
export const DEFAULT_PLACES_EMPTY_CACHE_TTL_SECONDS = 30;
export const DEFAULT_PLACES_RATE_LIMIT_MAX = 30;
export const DEFAULT_PLACES_RATE_LIMIT_WINDOW_SECONDS = 60;
export const DEFAULT_PLACES_RATE_LIMIT_TIMEOUT_MS = 750;
export const DEFAULT_PLACES_REDIS_TIMEOUT_MS = 500;

export interface PlacesSettings {
  /** Full Photon search endpoint, for example `https://photon.komoot.io/api`. */
  readonly baseUrl: string;
  /** Hard upstream budget enforced with an AbortController. */
  readonly timeoutMs: number;
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

export function resolvePlacesSettings(env: NodeJS.ProcessEnv = process.env): PlacesSettings {
  return {
    baseUrl: stringSetting(env, "PHOTON_URL", DEFAULT_PHOTON_URL),
    timeoutMs: integerSetting(env, "PHOTON_TIMEOUT_MS", DEFAULT_PHOTON_TIMEOUT_MS, 1, 30_000),
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
  };
}
