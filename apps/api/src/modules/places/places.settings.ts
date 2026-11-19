/**
 * Settings for the Places module.
 *
 * These values are intentionally resolved from `process.env` with safe defaults
 * instead of `AppConfigService`: the shared environment schema lives outside this
 * module's file boundary. Follow-up: move `PHOTON_URL`, `PHOTON_TIMEOUT_MS`,
 * `GEOAPIFY_URL`, `GEOAPIFY_TIMEOUT_MS`, `GEOAPIFY_API_KEY`,
 * `GEOAPIFY_DAILY_LIMIT`, `PLACES_PROVIDER`, `PLACES_CACHE_TTL_SECONDS`,
 * `PLACES_EMPTY_CACHE_TTL_SECONDS` and `PLACES_RATE_LIMIT_MAX` into
 * `apps/api/src/config/environment.ts` once the config owner picks them up.
 */

export const PLACES_SETTINGS = Symbol("ROAMLOG_PLACES_SETTINGS");

export type PlacesProvider = "geoapify" | "photon";

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
  };
}