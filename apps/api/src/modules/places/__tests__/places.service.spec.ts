import { BadRequestException } from "@nestjs/common";
import { PlaceSearchResponseSchema } from "@roamlog/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RedisService } from "../../redis/redis.service.js";
import { GeoapifyClient } from "../geoapify.client.js";
import { PhotonClient } from "../photon.client.js";
import {
  resolvePlacesSettings,
  staticPlacesSettingsSource,
  type PlacesSettings,
} from "../places.settings.js";
import { PlacesCacheService } from "../places-cache.service.js";
import { PlacesQuotaService } from "../places-quota.service.js";
import { PlacesService } from "../places.service.js";
import { TencentClient } from "../tencent.client.js";
import {
  abortAwareFetch,
  asLogger,
  fakeRedis,
  geoapifyPayload,
  jsonResponse,
  makeLogger,
  photonFeature,
  photonPayload,
  TENCENT_SKP_WGS84,
  tencentErrorPayload,
  tencentSuggestionPayload,
  testSettings,
  type FakeRedis,
} from "./place-fixtures.js";

function setup(
  options: {
    settings?: Partial<PlacesSettings>;
    /** Full settings snapshot, for tests that resolve them from an environment. */
    resolved?: PlacesSettings;
    redis?: FakeRedis;
  } = {},
): {
  settings: PlacesSettings;
  logger: ReturnType<typeof makeLogger>;
  redis: FakeRedis;
  cache: PlacesCacheService;
  service: PlacesService;
  photon: PhotonClient;
  geoapify: GeoapifyClient;
  tencent: TencentClient;
} {
  const settings = options.resolved ?? testSettings(options.settings);
  const source = staticPlacesSettingsSource(settings);
  const logger = makeLogger();
  const redis = options.redis ?? fakeRedis();
  const cache = new PlacesCacheService(
    redis as unknown as RedisService,
    asLogger(logger),
    source,
  );
  const photon = new PhotonClient(source);
  const geoapify = new GeoapifyClient(source);
  const tencent = new TencentClient(source);
  const service = new PlacesService(
    cache,
    geoapify,
    photon,
    tencent,
    new PlacesQuotaService(redis as unknown as RedisService, asLogger(logger), source),
    asLogger(logger),
    source,
  );
  return { settings, logger, redis, cache, service, photon, geoapify, tencent };
}

/** Dispatches by upstream host so a fallback test can fail only the primary. */
function hostFetch(handlers: {
  geoapify: () => Promise<Response>;
  photon: () => Promise<Response>;
}) {
  return vi.fn((url: URL) =>
    url.hostname.startsWith("geoapify") ? handlers.geoapify() : handlers.photon(),
  );
}

async function rejection(promise: Promise<unknown>): Promise<BadRequestException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return error as BadRequestException;
  }
  throw new Error("expected the search to be rejected");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlacesService", () => {
  it("maps a normal Photon response and caches it for 15 minutes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(photonPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service, redis, logger } = setup();

    const response = await service.search({ q: "Paris", limit: 2 });

    expect(response).toEqual({
      items: [
        {
          provider: "photon",
          providerPlaceId: "R:7444",
          name: "Paris",
          address: "Paris, Île-de-France, France",
          country: "France",
          countryCode: "FR",
          lat: 48.8566,
          lng: 2.3522,
          timeZone: null,
          bbox: null,
          importance: null,
          type: "city",
        },
      ],
      provider: "photon",
      degraded: false,
      cached: false,
    });
    expect(PlaceSearchResponseSchema.parse(response)).toEqual(response);

    const [, stored, ttl] = redis.set.mock.calls[0] as [string, string, number];
    expect(ttl).toBe(900);
    expect(JSON.parse(stored)).toMatchObject({ provider: "photon", degraded: false });

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ cache: "miss", queryLength: 5, resultCount: 1 }),
      "places.search_completed",
    );
    // The raw query must never be logged.
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain("Paris");
  });

  it("searches Geoapify first and returns its address, time zone, bbox and importance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(geoapifyPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service } = setup({ settings: { provider: "geoapify" } });

    const response = await service.search({ q: "Kyoto", limit: 3, lang: "en" });

    expect(response).toEqual({
      items: [
        {
          provider: "geoapify",
          providerPlaceId:
            "51e1bdfea47461405994da8b683bb64140f00103f901d146c57b01000000c00201920309e6b885e6b0b4e5afba",
          name: "京都市",
          address: "京都市, 京都府, 日本",
          country: "日本",
          countryCode: "JP",
          lat: 35.0115754,
          lng: 135.7681441,
          timeZone: "Asia/Tokyo",
          bbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
          importance: 0.18666666666666665,
          type: "city",
        },
      ],
      provider: "geoapify",
      degraded: false,
      cached: false,
    });
    expect(PlaceSearchResponseSchema.parse(response)).toEqual(response);
    expect(fetchMock.mock.calls[0]?.[0]).toMatchObject({ hostname: "geoapify.example.test" });
  });

  it("serves a cache hit without a second upstream call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(photonPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service, logger } = setup();

    const first = await service.search({ q: "Paris", limit: 6 });
    const second = await service.search({ q: "  paris ", limit: 6 });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.items).toEqual(first.items);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ cache: "hit", queryLength: 5 }),
      "places.search_cache_hit",
    );
  });

  it("does not reuse a cache entry after switching the primary provider", async () => {
    const fetchMock = hostFetch({
      geoapify: async () => jsonResponse(geoapifyPayload()),
      photon: async () => jsonResponse(photonPayload()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const redis = fakeRedis();

    const photon = setup({ redis }).service;
    const geoapify = setup({ redis, settings: { provider: "geoapify" } }).service;

    const first = await photon.search({ q: "Kyoto", limit: 3 });
    const second = await geoapify.search({ q: "Kyoto", limit: 3 });

    expect(first.provider).toBe("photon");
    expect(second.provider).toBe("geoapify");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const keys = [...redis.store.keys()];
    expect(keys).toHaveLength(2);
    expect(keys.some((key) => key.startsWith("places:v3:photon:"))).toBe(true);
    expect(keys.some((key) => key.startsWith("places:v3:geoapify:"))).toBe(true);
  });

  it("keeps working when Redis reads throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(photonPayload())));
    const redis = fakeRedis();
    redis.get.mockRejectedValue(new Error("redis unavailable"));
    const { service, logger } = setup({ redis });

    const response = await service.search({ q: "Paris", limit: 6 });

    expect(response.items).toHaveLength(1);
    expect(response.cached).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "places.cache_unavailable" }),
      "places.cache_bypassed",
    );
  });

  it("keeps working when Redis writes throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(photonPayload())));
    const redis = fakeRedis();
    redis.set.mockRejectedValue(new Error("redis unavailable"));
    const { service } = setup({ redis });

    await expect(service.search({ q: "Paris", limit: 6 })).resolves.toMatchObject({
      degraded: false,
      cached: false,
    });
  });

  it("degrades to an empty 200 result on a Photon 500 and caches it for 30 seconds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 500)));
    const { service, redis, logger } = setup();

    const response = await service.search({ q: "Paris", limit: 6 });

    expect(response).toEqual({
      items: [],
      provider: "photon",
      degraded: true,
      cached: false,
    });
    expect(PlaceSearchResponseSchema.parse(response)).toEqual(response);

    const [, , ttl] = redis.set.mock.calls[0] as [string, string, number];
    expect(ttl).toBe(30);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "places.upstream_failed",
        reason: "http_error",
        httpStatus: 500,
        queryLength: 5,
      }),
      "places.search_degraded",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("Paris");
  });

  it("degrades on a Photon timeout instead of failing the request", async () => {
    vi.stubGlobal("fetch", abortAwareFetch());
    const { service, redis } = setup({ settings: { timeoutMs: 20 } });

    const response = await service.search({ q: "Paris", limit: 6 });

    expect(response).toMatchObject({ items: [], provider: "photon", degraded: true });
    expect((redis.set.mock.calls[0] as [string, string, number])[2]).toBe(30);
  });

  it("falls back to Photon when Geoapify times out, keeping degraded true", async () => {
    const fetchMock = vi.fn((url: URL, init?: RequestInit) => {
      if (url.hostname.startsWith("geoapify")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          });
        });
      }
      return Promise.resolve(jsonResponse(photonPayload()));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service, logger } = setup({
      settings: { provider: "geoapify", geoapifyTimeoutMs: 10 },
    });

    const response = await service.search({ q: "Kyoto", limit: 3 });

    expect(response).toMatchObject({ provider: "photon", degraded: true, cached: false });
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({ provider: "photon", name: "Paris" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "places.upstream_failed",
        provider: "geoapify",
        reason: "timeout",
        fallback: "photon",
      }),
      "places.search_degraded",
    );
  });

  it("returns an empty degraded result when both Geoapify and Photon fail", async () => {
    vi.stubGlobal(
      "fetch",
      hostFetch({
        geoapify: async () => jsonResponse({ message: "boom" }, 500),
        photon: async () => jsonResponse({ message: "down" }, 503),
      }),
    );
    const { service, logger } = setup({ settings: { provider: "geoapify" } });

    const response = await service.search({ q: "Kyoto", limit: 3 });

    expect(response).toEqual({
      items: [],
      provider: "geoapify",
      degraded: true,
      cached: false,
    });
    expect(PlaceSearchResponseSchema.parse(response)).toEqual(response);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "geoapify",
        reason: "http_error",
        httpStatus: 500,
        fallbackReason: "http_error",
        fallbackHttpStatus: 503,
      }),
      "places.search_degraded",
    );
  });

  it("stops calling Geoapify once the daily cap is exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(geoapifyPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service, logger } = setup({
      settings: {
        provider: "geoapify",
        geoapifyDailyLimit: 1,
        fallbackToPhoton: false,
      },
    });

    const first = await service.search({ q: "Kyoto", limit: 3 });
    const second = await service.search({ q: "Osaka", limit: 3 });

    expect(first.degraded).toBe(false);
    expect(second).toEqual({ items: [], provider: "geoapify", degraded: true, cached: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "quota_exceeded", fallback: null }),
      "places.search_degraded",
    );
  });

  it("falls back to Photon when the daily cap is exhausted", async () => {
    vi.stubGlobal(
      "fetch",
      hostFetch({
        geoapify: async () => jsonResponse(geoapifyPayload()),
        photon: async () => jsonResponse(photonPayload()),
      }),
    );
    const { service } = setup({
      settings: { provider: "geoapify", geoapifyDailyLimit: 1 },
    });

    await service.search({ q: "Kyoto", limit: 3 });
    const second = await service.search({ q: "Osaka", limit: 3 });

    expect(second).toMatchObject({ provider: "photon", degraded: true });
    expect(second.items[0]).toMatchObject({ provider: "photon" });
    const hosts = (vi.mocked(fetch).mock.calls as unknown as [URL][])
      .map(([url]) => url.hostname)
      .filter((host) => host.startsWith("geoapify"));
    expect(hosts).toHaveLength(1);
  });

  it("degrades on malformed upstream JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    const { service, logger } = setup();

    await expect(service.search({ q: "Paris", limit: 6 })).resolves.toMatchObject({
      degraded: true,
      items: [],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "invalid_payload" }),
      "places.search_degraded",
    );
  });

  it("caches an empty result for 30 seconds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(photonPayload([]))));
    const { service, redis, logger } = setup();

    const response = await service.search({ q: "Atlantis", limit: 6 });

    expect(response).toEqual({ items: [], provider: "photon", degraded: false, cached: false });
    expect((redis.set.mock.calls[0] as [string, string, number])[2]).toBe(30);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps the Chinese and global routes in separate cache namespaces", async () => {
    const fetchMock = vi.fn((url: URL) =>
      Promise.resolve(
        url.hostname.startsWith("tencent")
          ? jsonResponse(tencentErrorPayload(500))
          : jsonResponse(photonPayload()),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { service, redis } = setup();

    // Han script picks the China route and only ever reaches Tencent; a
    // romanized keyword keeps the global route, whatever `lang` says — the
    // fixture's `zh` default no longer moves Paris to the mainland source.
    await service.search({ q: "建国路87号", limit: 6, lang: "zh" });
    await service.search({ q: "Paris", limit: 6, lang: "zh" });
    await service.search({ q: "Paris", limit: 6, lang: "zh" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const hosts = (fetchMock.mock.calls as unknown as [URL][]).map(([url]) => url.hostname);
    expect(hosts).toEqual(["tencent.example.test", "photon.example.test"]);

    const keys = [...redis.store.keys()];
    expect(keys.some((key) => key.startsWith("places:v3:tencent:"))).toBe(true);
    expect(keys.some((key) => key.startsWith("places:v3:photon:"))).toBe(true);
  });

  it("rejects invalid queries with the shared VALIDATION_ERROR problem", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { service } = setup();

    const empty = await rejection(service.search({ q: "" }));
    expect(empty.getStatus()).toBe(400);
    expect(empty.getResponse()).toMatchObject({ code: "VALIDATION_ERROR" });

    expect((await rejection(service.search({ q: "x", limit: 11 }))).getStatus()).toBe(400);
    expect((await rejection(service.search({ q: "x", limit: 0 }))).getStatus()).toBe(400);
    expect((await rejection(service.search({ q: "x", bbox: "1,2,3,4" }))).getStatus()).toBe(400);
    expect((await rejection(service.search({}))).getStatus()).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never serves a cached local (manual) place from search", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(photonPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service, cache, redis } = setup();

    redis.store.set(
      cache.key({ q: "Paris", limit: 6, provider: "photon" }),
      JSON.stringify({
        items: [
          {
            provider: "local",
            providerPlaceId: null,
            name: "Manually added spot",
            address: null,
            country: "France",
            countryCode: "FR",
            lat: 48.85,
            lng: 2.35,
            timeZone: null,
            bbox: null,
            importance: null,
            type: "other",
          },
        ],
        provider: "local",
        degraded: false,
        cached: false,
      }),
    );

    const response = await service.search({ q: "Paris", limit: 6 });

    expect(response.provider).toBe("photon");
    expect(response.items.every((place) => place.provider === "photon")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("derives cache keys from provider, normalized query, limit and lang", () => {
    const { cache } = setup();

    const base = { q: "  PARIS ", limit: 6, provider: "photon" as const };
    expect(cache.key(base)).toBe(cache.key({ ...base, q: "paris" }));
    expect(cache.key(base)).not.toBe(cache.key({ ...base, limit: 5 }));
    expect(cache.key(base)).not.toBe(cache.key({ ...base, lang: "zh" }));
    expect(cache.key(base)).not.toBe(cache.key({ ...base, provider: "geoapify" }));
    expect(cache.key(base)).toMatch(/^places:v3:photon:[a-f0-9]{64}$/);
  });

  it("truncates more upstream items than the requested limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          photonPayload([
            photonFeature(),
            photonFeature({ osm_id: 12, name: "Louvre", type: "house" }),
            photonFeature({ osm_id: 13, name: "Lyon", type: "city" }),
          ]),
        ),
      ),
    );
    const { service } = setup();

    const response = await service.search({ q: "France", limit: 2 });

    expect(response.items).toHaveLength(2);
  });
});

/**
 * The route signals, pinned independently of the China route's behaviour.
 *
 * `places.lang` defaults to `zh`, so reading it as a geographic signal sent
 * every search typed in the Chinese UI — `Paris` included — to a source that
 * only covers the mainland, and overseas destinations are a main flow here.
 */
describe("PlacesService route signals", () => {
  it("sends a Chinese-UI search for Paris to Geoapify and never calls Tencent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(geoapifyPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service, tencent } = setup({ settings: { provider: "geoapify" } });
    const tencentSuggest = vi.spyOn(tencent, "suggest");

    const response = await service.search({ q: "Paris", limit: 3, lang: "zh" });

    expect(response.provider).toBe("geoapify");
    expect(response.degraded).toBe(false);
    expect(response.items).toHaveLength(1);
    expect(tencentSuggest).not.toHaveBeenCalled();
    const hosts = (vi.mocked(fetch).mock.calls as unknown as [URL][]).map(([url]) => url.hostname);
    expect(hosts).toEqual(["geoapify.example.test"]);
  });

  /**
   * Deviation from the requested test list, reported to the requester.
   *
   * `东京` is Han script, so `country === "CN" || HAN_SCRIPT.test(q)` routes it
   * to Tencent — exactly like `京都`. The requested pair "`lang=zh` + `东京` →
   * Geoapify" and "no lang + `京都` → Tencent" cannot both hold: the two
   * keywords differ in meaning, not in script, and the agreed fix uses only
   * `country` and Han script. Separating them would need a signal the spec
   * explicitly forbids inventing (a China locality list / address-shape rule),
   * so this test pins today's real behaviour instead of a false expectation.
   * Overseas place names written in Han still reach the China route.
   */
  it("still routes `东京` to Tencent, because Han script is the only keyword signal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload())));
    const { service, tencent } = setup({ settings: { provider: "geoapify" } });
    const tencentSuggest = vi.spyOn(tencent, "suggest");

    const response = await service.search({ q: "东京", limit: 3, lang: "zh" });

    expect(tencentSuggest).toHaveBeenCalledTimes(1);
    expect(response.provider).toBe("tencent");
  });

  it("routes a Han street address from the Chinese UI to Tencent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload())));
    const { service, geoapify } = setup({ settings: { provider: "geoapify" } });
    const geoapifySearch = vi.spyOn(geoapify, "search");

    const response = await service.search({ q: "建国路87号", limit: 3, lang: "zh" });

    expect(response.provider).toBe("tencent");
    expect(response.degraded).toBe(false);
    expect(geoapifySearch).not.toHaveBeenCalled();
    expect((vi.mocked(fetch).mock.calls[0] as unknown as [URL])[0].hostname).toBe(
      "tencent.example.test",
    );
  });

  it("routes country=CN even when the keyword is romanized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload())));
    const { service, geoapify } = setup({ settings: { provider: "geoapify" } });
    const geoapifySearch = vi.spyOn(geoapify, "search");

    const response = await service.search({ q: "Beijing", limit: 3, country: "CN" });

    expect(response.provider).toBe("tencent");
    expect(geoapifySearch).not.toHaveBeenCalled();
  });

  it("routes a Han keyword to Tencent when the caller omits lang entirely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload())));
    const { settings, service } = setup({ settings: { provider: "geoapify" } });

    const response = await service.search({ q: "京都", limit: 3 });

    expect(settings.defaultLang).toBe("zh");
    expect(response.provider).toBe("tencent");
  });
});

/**
 * The mainland-China route. The governing rule is that a Chinese address must
 * never be answered by Photon, whose same-street house numbers are wrong; a
 * failure degrades to `map_pick` instead.
 */
describe("PlacesService China route", () => {
  it("routes a Han keyword to Tencent, converts GCJ-02 to WGS-84 and never calls Photon", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service, photon } = setup();
    const photonSearch = vi.spyOn(photon, "search");

    const response = await service.search({ q: "北京市朝阳区建国路87号", limit: 3 });

    expect(response.provider).toBe("tencent");
    expect(response.degraded).toBe(false);
    expect(response.fallback).toBeUndefined();
    expect(response.items[0]).toMatchObject({
      provider: "tencent",
      providerPlaceId: "10233345183344841920",
      name: "北京SKP",
      address: "北京市朝阳区建国路87号",
      country: "中国",
      countryCode: "CN",
      timeZone: null,
      bbox: null,
      importance: null,
      type: "poi",
    });
    expect(response.items[0]?.lat).toBeCloseTo(TENCENT_SKP_WGS84.lat, 9);
    expect(response.items[0]?.lng).toBeCloseTo(TENCENT_SKP_WGS84.lng, 9);
    expect(PlaceSearchResponseSchema.parse(response)).toEqual(response);

    const url = (fetchMock.mock.calls[0] as unknown as [URL])[0];
    expect(url.hostname).toBe("tencent.example.test");
    expect(url.pathname).toBe("/ws/place/v1/suggestion");
    expect(url.searchParams.get("keyword")).toBe("北京市朝阳区建国路87号");
    expect(url.searchParams.get("page_size")).toBe("3");
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(photonSearch).not.toHaveBeenCalled();
  });

  it("caches a Chinese result in the Tencent namespace for 300 seconds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service, redis } = setup();

    const first = await service.search({ q: "建国路87号", limit: 3 });
    const second = await service.search({ q: "建国路87号", limit: 3 });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.items).toEqual(first.items);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [key, , ttl] = redis.set.mock.calls[0] as [string, string, number];
    expect(key.startsWith("places:v3:tencent:")).toBe(true);
    expect(ttl).toBe(300);
  });

  it("routes country=CN even when the keyword is romanized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload())));
    const { service, photon } = setup();
    const photonSearch = vi.spyOn(photon, "search");

    const response = await service.search({ q: "Shenzhen", limit: 3, country: "CN" });

    expect(response.provider).toBe("tencent");
    expect(response.items).toHaveLength(1);
    expect(photonSearch).not.toHaveBeenCalled();
  });

  it("never sends a non-Chinese query to Tencent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(photonPayload())));
    const { service } = setup();

    const response = await service.search({ q: "Paris", limit: 3, lang: "en" });

    expect(response.provider).toBe("photon");
    const hosts = (vi.mocked(fetch).mock.calls as unknown as [URL][]).map(([url]) => url.hostname);
    expect(hosts).toEqual(["photon.example.test"]);
  });

  it("degrades to map_pick when Tencent fails, without ever calling Photon", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tencentErrorPayload(520)));
    vi.stubGlobal("fetch", fetchMock);
    const { service, photon, logger } = setup();
    const photonSearch = vi.spyOn(photon, "search");

    const response = await service.search({ q: "建国路87号", limit: 3 });

    expect(response).toEqual({
      items: [],
      provider: "tencent",
      degraded: true,
      cached: false,
      fallback: "map_pick",
    });
    expect(PlaceSearchResponseSchema.parse(response)).toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(photonSearch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "places.upstream_failed",
        provider: "tencent",
        route: "china",
        reason: "upstream_error",
        code: "UPSTREAM_ERROR",
        upstreamStatus: 520,
        fallback: "map_pick",
      }),
      "places.search_degraded",
    );
  });

  it("degrades to map_pick on status 121 (QUOTA_EXCEEDED) without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(tencentErrorPayload(121, "此key每日调用量已达到上限")));
    vi.stubGlobal("fetch", fetchMock);
    const { service, photon, logger } = setup();
    const photonSearch = vi.spyOn(photon, "search");

    const response = await service.search({ q: "建国路87号", limit: 3 });

    expect(response).toMatchObject({ items: [], degraded: true, fallback: "map_pick" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(photonSearch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "quota_exceeded",
        code: "QUOTA_EXCEEDED",
        upstreamStatus: 121,
        fallback: "map_pick",
      }),
      "places.search_degraded",
    );
  });

  it("degrades to map_pick when TENCENT_MAPS_KEY is empty, without any upstream call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const settings = resolvePlacesSettings({ TENCENT_MAPS_KEY: "" } as NodeJS.ProcessEnv);
    const { service, photon } = setup({ resolved: settings });
    const photonSearch = vi.spyOn(photon, "search");

    const response = await service.search({ q: "深圳市南山区深南大道10000号", limit: 3 });

    expect(settings.tencentApiKey).toBeNull();
    expect(response).toEqual({
      items: [],
      provider: "tencent",
      degraded: true,
      cached: false,
      fallback: "map_pick",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(photonSearch).not.toHaveBeenCalled();
  });

  it("degrades to map_pick once the Tencent daily cap is exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service, logger } = setup({ settings: { tencentDailyLimit: 1 } });

    const first = await service.search({ q: "建国路87号", limit: 3 });
    const second = await service.search({ q: "深南大道10000号", limit: 3 });

    expect(first.degraded).toBe(false);
    expect(second).toEqual({
      items: [],
      provider: "tencent",
      degraded: true,
      cached: false,
      fallback: "map_pick",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "quota_exceeded", fallback: "map_pick" }),
      "places.search_degraded",
    );
  });
});