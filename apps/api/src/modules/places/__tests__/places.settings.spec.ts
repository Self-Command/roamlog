import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsService } from "../../settings/settings.service.js";
import { GeoapifyClient } from "../geoapify.client.js";
import { PhotonClient } from "../photon.client.js";
import { PlacesCacheService } from "../places-cache.service.js";
import { PlacesQuotaService } from "../places-quota.service.js";
import { PlacesService } from "../places.service.js";
import {
  PlacesSettingsResolver,
  resolvePlacesSettingsFromStored,
} from "../places.settings.js";
import { RedisService } from "../../redis/redis.service.js";
import {
  asLogger,
  fakeRedis,
  geoapifyPayload,
  jsonResponse,
  makeLogger,
  photonPayload,
  type LoggerMock,
} from "./place-fixtures.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function storedPlaces(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    "places.provider": "geoapify",
    "places.apiKey": null,
    "places.lang": "zh",
    "places.limit": 6,
    "places.cacheTtlSeconds": 900,
    "places.dailyQuota": 3_000,
    ...overrides,
  };
}

function settingsService(
  stored: Record<string, unknown> | Error,
): SettingsService {
  return {
    getGroup: vi.fn(async () => {
      if (stored instanceof Error) {
        throw stored;
      }
      return stored;
    }),
  } as unknown as SettingsService;
}

function harness(stored: Record<string, unknown> | Error, logger: LoggerMock = makeLogger()) {
  // URL and the API key are environment-only; pin them so the test never calls
  // a real provider even if the host shell exports a key.
  vi.stubEnv("GEOAPIFY_URL", "https://geoapify.example.test/v1/geocode/autocomplete");
  vi.stubEnv("PHOTON_URL", "https://photon.example.test/api");
  vi.stubEnv("GEOAPIFY_API_KEY", "");
  const redis = fakeRedis();
  const resolver = new PlacesSettingsResolver(settingsService(stored), asLogger(logger));
  const geoapify = new GeoapifyClient(resolver);
  const photon = new PhotonClient(resolver);
  const service = new PlacesService(
    new PlacesCacheService(redis as unknown as RedisService, asLogger(logger), resolver),
    geoapify,
    photon,
    new PlacesQuotaService(redis as unknown as RedisService, asLogger(logger), resolver),
    asLogger(logger),
    resolver,
  );
  return { service, resolver, redis, logger, geoapify, photon };
}

function hostFetch() {
  return vi.fn((url: URL) =>
    Promise.resolve(
      url.hostname.includes("geoapify")
        ? jsonResponse(geoapifyPayload())
        : jsonResponse(photonPayload()),
    ),
  );
}

describe("PlacesSettingsResolver", () => {
  it("switches the search to Photon when the database stores places.provider=photon", async () => {
    const fetchMock = hostFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { service, resolver, geoapify, photon } = harness(
      storedPlaces({ "places.provider": "photon" }),
    );
    const geoapifySearch = vi.spyOn(geoapify, "search");
    const photonSearch = vi.spyOn(photon, "search");

    const settings = await resolver.resolve();
    const response = await service.search({ q: "Kyoto" });

    expect(settings.provider).toBe("photon");
    expect(photonSearch).toHaveBeenCalledTimes(1);
    expect(geoapifySearch).not.toHaveBeenCalled();
    expect(response.provider).toBe("photon");
    expect(response.items[0]?.provider).toBe("photon");
  });

  it("keeps the database ahead of the environment for keys that are not envLocked", () => {
    const resolution = resolvePlacesSettingsFromStored({
      env: {
        PLACES_PROVIDER: "geoapify",
        GEOAPIFY_API_KEY: "env-key",
        PLACES_LIMIT: "6",
      },
      stored: storedPlaces({
        "places.provider": "photon",
        "places.apiKey": "db-key",
        "places.limit": 3,
      }),
    });

    expect(resolution.settings.provider).toBe("photon");
    expect(resolution.settings.geoapifyApiKey).toBe("db-key");
    expect(resolution.settings.defaultLimit).toBe(3);
    expect(resolution.ignored).toEqual([]);
  });

  it("lets a locked environment key win over the stored value", () => {
    const resolution = resolvePlacesSettingsFromStored({
      env: { PLACES_PROVIDER: "photon" },
      stored: storedPlaces({ "places.provider": "geoapify" }),
      envLockOf: (key) =>
        key === "places.provider"
          ? { envLocked: true, envVar: "PLACES_PROVIDER" }
          : undefined,
    });

    expect(resolution.settings.provider).toBe("photon");
  });

  it("falls back to the environment, warns, and never throws when the settings DB is down", async () => {
    vi.stubEnv("PLACES_PROVIDER", "photon");
    const fetchMock = hostFetch();
    vi.stubGlobal("fetch", fetchMock);
    const logger = makeLogger();
    const { service, resolver } = harness(new Error("db down"), logger);

    const settings = await resolver.resolve();
    const response = await service.search({ q: "Kyoto" });

    expect(settings.provider).toBe("photon");
    expect(response.provider).toBe("photon");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "places.settings_unavailable", reason: "Error" }),
      "places.settings_fallback_env",
    );
  });

  it("applies places.apiKey, lang, limit, cacheTtlSeconds and dailyQuota", async () => {
    const fetchMock = hostFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { service, redis, logger } = harness(
      storedPlaces({
        "places.provider": "geoapify",
        "places.apiKey": "db-key-9999",
        "places.lang": "en",
        "places.limit": 3,
        "places.cacheTtlSeconds": 120,
        "places.dailyQuota": 1,
      }),
    );

    const first = await service.search({ q: "Kyoto" });
    const [cacheKey, , cacheTtl] = redis.set.mock.calls[0] as [string, string, number];
    const url = (fetchMock.mock.calls[0] as unknown as [URL])[0];

    expect(cacheKey).toContain(":geoapify:");
    expect(cacheTtl).toBe(120);
    expect(url.searchParams.get("apiKey")).toBe("db-key-9999");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(first.provider).toBe("geoapify");
    expect(first.degraded).toBe(false);

    // The Redis counter is already at 2, and the stored quota is 1, so the
    // second distinct search must not spend another Geoapify call.
    const second = await service.search({ q: "Osaka" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as unknown as [URL])[0].hostname).toContain("photon");
    expect(second.degraded).toBe(true);
    expect(second.provider).toBe("photon");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "places.upstream_failed", reason: "quota_exceeded" }),
      "places.search_degraded",
    );
  });

  it("does not silently pretend an unsupported language works", async () => {
    vi.stubGlobal("fetch", hostFetch());
    const logger = makeLogger();
    const { resolver } = harness(storedPlaces({ "places.lang": "fr" }), logger);

    const settings = await resolver.resolve();

    expect(settings.defaultLang).toBe("zh");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "places.setting_value_ignored",
        key: "places.lang",
        reason: "unsupported_value",
      }),
      "places.setting_value_ignored",
    );
  });
});