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
import { PlacesMergeService } from "../places-merge.service.js";
import {
  staticPlacesProviderRuntimeSource,
  type PlacesRoutingMode,
} from "../places-provider-runtime.service.js";
import { PlacesQuotaService } from "../places-quota.service.js";
import { PlacesService, eligibleSources, routeFor } from "../places.service.js";
import { TencentClient } from "../tencent.client.js";
import {
  asLogger,
  fakeRedis,
  geoapifyFeature,
  geoapifyPayload,
  jsonResponse,
  makeLogger,
  photonFeature,
  photonPayload,
  tencentErrorPayload,
  tencentGeocodePayload,
  tencentGeocodeResult,
  tencentSuggestItem,
  tencentSuggestionPayload,
  testSettings,
  type FakeRedis,
} from "./place-fixtures.js";

function setup(
  options: {
    settings?: Partial<PlacesSettings>;
    redis?: FakeRedis;
    runtimeMode?: PlacesRoutingMode;
  } = {},
): {
  settings: PlacesSettings;
  logger: ReturnType<typeof makeLogger>;
  redis: FakeRedis;
  cache: PlacesCacheService;
  service: PlacesService;
} {
  const settings = testSettings(options.settings);
  const source = staticPlacesSettingsSource(settings);
  const logger = makeLogger();
  const redis = options.redis ?? fakeRedis();
  const cache = new PlacesCacheService(redis as unknown as RedisService, asLogger(logger), source);
  const service = new PlacesService(
    cache,
    new GeoapifyClient(source),
    new PhotonClient(source),
    new TencentClient(source),
    new PlacesQuotaService(redis as unknown as RedisService, asLogger(logger), source),
    new PlacesMergeService(),
    asLogger(logger),
    source,
    staticPlacesProviderRuntimeSource(settings, options.runtimeMode),
  );
  return { settings, logger, redis, cache, service };
}

interface ProviderHandlers {
  readonly tencentGeocode?: () => Response;
  readonly tencentSuggest?: () => Response;
  readonly geoapify: () => Response;
  readonly photon: () => Response;
}

/** Dispatches by upstream host *and* Tencent endpoint. */
function providerFetch(handlers: ProviderHandlers) {
  return vi.fn((url: URL) => {
    if (url.hostname.startsWith("tencent")) {
      return Promise.resolve(
        url.pathname.includes("/geocoder/")
          ? (handlers.tencentGeocode ?? (() => jsonResponse(tencentErrorPayload(348))))()
          : (handlers.tencentSuggest ?? (() => jsonResponse(tencentSuggestionPayload([]))))(),
      );
    }
    if (url.hostname.startsWith("geoapify")) {
      return Promise.resolve(handlers.geoapify());
    }
    return Promise.resolve(handlers.photon());
  });
}

function beijingGeoapifyPayload() {
  return geoapifyPayload([
    geoapifyFeature({
      name: "北京市",
      country: "中国",
      country_code: "cn",
      result_type: "city",
      city: "北京市",
      state: "北京市",
      coordinates: [116.3912972, 39.9057136],
      formatted: "北京市, 中国",
    }),
  ]);
}

function beijingPhotonPayload() {
  return photonPayload([
    photonFeature({
      name: "北京市",
      country: "中国",
      countrycode: "cn",
      type: "city",
      osm_value: "city",
      city: "北京市",
      state: "北京市",
      coordinates: [116.3912972, 39.9057136],
      osm_id: 9_200_001,
    }),
  ]);
}

function beijingTencentGeocode() {
  return jsonResponse(
    tencentGeocodePayload(
      tencentGeocodeResult({
        title: "北京市",
        level: 1,
        location: { lat: 39.9042, lng: 116.4074 },
        address_components: {
          province: "北京市",
          city: "北京市",
          district: "",
          street: "",
          street_number: "",
        },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function rejection(promise: Promise<unknown>): Promise<BadRequestException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return error as BadRequestException;
  }
  throw new Error("expected the search to be rejected");
}

describe("PlacesService — multi-source recall", () => {
  it("queries Tencent geocoder + suggestion, Geoapify and Photon for 北京", async () => {
    const fetchMock = providerFetch({
      tencentGeocode: beijingTencentGeocode,
      tencentSuggest: () =>
        jsonResponse(
          tencentSuggestionPayload([
            tencentSuggestItem({
              title: "北京天安门广场",
              address: "北京市东城区东长安街",
              location: { lat: 39.90374, lng: 116.397827 },
              ad_info: {
                adcode: 110101,
                province: "北京市",
                city: "北京市",
                district: "东城区",
              },
            }),
          ]),
        ),
      geoapify: () => jsonResponse(beijingGeoapifyPayload()),
      photon: () => jsonResponse(beijingPhotonPayload()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service, logger } = setup();

    const response = await service.search({ q: "北京", limit: 6 });

    expect(response.degraded).toBe(false);
    expect(response.items[0]?.provider).toBe("tencent");
    expect(response.items[0]?.name).toContain("北京");
    expect(response.items[0]?.countryCode).toBe("CN");
    expect(PlaceSearchResponseSchema.parse(response)).toEqual(response);

    const hosts = (fetchMock.mock.calls as unknown as [URL][]).map(([url]) => url.hostname).sort();
    expect(hosts).toEqual([
      "geoapify.example.test",
      "photon.example.test",
      "tencent.example.test",
      "tencent.example.test",
    ]);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        cache: "miss",
        route: "mixed",
        resultCount: response.items.length,
      }),
      "places.search_completed",
    );
    // The raw query must never be logged.
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain("北京");
  });

  it("never calls Tencent for a romanized query and returns Paris, France", async () => {
    const fetchMock = providerFetch({
      geoapify: () =>
        jsonResponse(
          geoapifyPayload([
            geoapifyFeature({
              name: "巴黎",
              country: "法国",
              country_code: "fr",
              result_type: "city",
              city: "巴黎",
              state: "法兰西岛",
              coordinates: [2.3483915, 48.8534951],
              formatted: "巴黎, 法国",
            }),
          ]),
        ),
      photon: () =>
        jsonResponse(
          photonPayload([
            photonFeature({
              name: "Paris",
              country: "France",
              countrycode: "fr",
              type: "city",
              osm_value: "city",
              city: "Paris",
              state: "Île-de-France",
              coordinates: [2.3483915, 48.8534951],
              osm_id: 9_200_002,
            }),
          ]),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service } = setup({ settings: { provider: "geoapify" } });

    const response = await service.search({ q: "Paris", limit: 3 });

    expect(response.items[0]?.countryCode).toBe("FR");
    const hosts = (fetchMock.mock.calls as unknown as [URL][]).map(([url]) => url.hostname);
    expect(hosts.some((host) => host.startsWith("tencent"))).toBe(false);
  });

  it("does not call Tencent when country is explicitly JP, even for a Han query", async () => {
    const fetchMock = providerFetch({
      geoapify: () =>
        jsonResponse(
          geoapifyPayload([
            geoapifyFeature({
              name: "东京都/東京都",
              country: "日本",
              country_code: "jp",
              result_type: "city",
              city: "东京都",
              state: "东京都",
              coordinates: [139.7638947, 35.6768601],
              formatted: "东京都, 日本",
            }),
          ]),
        ),
      photon: () =>
        jsonResponse(
          photonPayload([
            photonFeature({
              name: "東京都",
              country: "日本",
              countrycode: "jp",
              type: "city",
              osm_value: "city",
              city: "東京都",
              state: "東京都",
              coordinates: [139.7638947, 35.6768601],
              osm_id: 9_200_003,
            }),
          ]),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service } = setup({ settings: { provider: "geoapify" } });

    const response = await service.search({ q: "东京", country: "JP", limit: 3 });

    expect(response.items[0]?.countryCode).toBe("JP");
    const hosts = (fetchMock.mock.calls as unknown as [URL][]).map(([url]) => url.hostname);
    expect(hosts.some((host) => host.startsWith("tencent"))).toBe(false);
  });

  it("serves a cache hit without a second upstream call", async () => {
    const fetchMock = providerFetch({
      tencentGeocode: beijingTencentGeocode,
      geoapify: () => jsonResponse(beijingGeoapifyPayload()),
      photon: () => jsonResponse(beijingPhotonPayload()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service, logger } = setup();

    const first = await service.search({ q: "北京", limit: 6 });
    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await service.search({ q: " 北京 ", limit: 6 });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.items).toEqual(first.items);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ cache: "hit", route: "mixed" }),
      "places.search_cache_hit",
    );
  });

  it("keeps mixed and global routes in separate cache namespaces", async () => {
    const fetchMock = providerFetch({
      tencentGeocode: beijingTencentGeocode,
      geoapify: () => jsonResponse(beijingGeoapifyPayload()),
      photon: () => jsonResponse(beijingPhotonPayload()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service, redis } = setup({ settings: { provider: "geoapify" } });

    await service.search({ q: "北京", limit: 6 });
    await service.search({ q: "Paris", limit: 6 });
    await service.search({ q: "Paris", limit: 6 });

    const keys = [...redis.store.keys()];
    expect(keys.some((key) => key.startsWith("places:v4:mixed:"))).toBe(true);
    expect(keys.some((key) => key.startsWith("places:v4:global:"))).toBe(true);
  });

  it("degrades to map_pick when every provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 500)));
    const { service, logger, redis } = setup({ settings: { provider: "geoapify" } });

    const response = await service.search({ q: "Paris", limit: 6 });

    expect(response).toEqual({
      items: [],
      provider: "geoapify",
      degraded: true,
      cached: false,
      fallback: "map_pick",
    });
    expect(PlaceSearchResponseSchema.parse(response)).toEqual(response);
    expect((redis.set.mock.calls[0] as [string, string, number])[2]).toBe(30);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "places.upstream_failed",
        fallback: "map_pick",
      }),
      "places.search_degraded",
    );
  });

  it("keeps high-confidence results when only one provider fails", async () => {
    const fetchMock = providerFetch({
      tencentGeocode: () => jsonResponse({ message: "down" }, 500),
      tencentSuggest: () => jsonResponse({ message: "down" }, 503),
      geoapify: () => jsonResponse(beijingGeoapifyPayload()),
      photon: () => jsonResponse(beijingPhotonPayload()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service, logger } = setup({ settings: { provider: "geoapify" } });

    const response = await service.search({ q: "北京", limit: 6 });

    expect(response.degraded).toBe(false);
    expect(response.items.length).toBeGreaterThan(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "places.upstream_failed", provider: "tencent" }),
      "places.search_degraded",
    );
  });

  it("priority_failover stops before calling the next provider once enough results exist", async () => {
    const fetchMock = providerFetch({
      geoapify: () => jsonResponse(beijingGeoapifyPayload()),
      photon: () => jsonResponse(beijingPhotonPayload()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service } = setup({
      settings: { provider: "photon", defaultLimit: 1 },
      runtimeMode: "priority_failover",
    });

    const response = await service.search({ q: "Paris", limit: 1 });
    const hosts = (fetchMock.mock.calls as unknown as [URL][]).map(([url]) => url.hostname);

    expect(response.items).toHaveLength(1);
    expect(hosts.some((host) => host.startsWith("geoapify"))).toBe(true);
    expect(hosts.some((host) => host.startsWith("photon"))).toBe(false);
  });

  it("stops calling Geoapify once its daily cap is exhausted and lets Photon answer", async () => {
    const fetchMock = providerFetch({
      geoapify: () => jsonResponse(beijingGeoapifyPayload()),
      photon: () => jsonResponse(beijingPhotonPayload()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service } = setup({
      settings: { provider: "geoapify", geoapifyDailyLimit: 1 },
    });

    await service.search({ q: "Paris", limit: 6 });
    const second = await service.search({ q: "Lyon", limit: 6 });

    expect(second.items.length).toBeGreaterThan(0);
    const geoapifyHosts = (fetchMock.mock.calls as unknown as [URL][])
      .map(([url]) => url.hostname)
      .filter((host) => host.startsWith("geoapify"));
    expect(geoapifyHosts).toHaveLength(1);
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
    const fetchMock = providerFetch({
      geoapify: () => jsonResponse(beijingGeoapifyPayload()),
      photon: () => jsonResponse(beijingPhotonPayload()),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service, cache, redis } = setup({ settings: { provider: "geoapify" } });

    redis.store.set(
      cache.key({ q: "Paris", limit: 6, lang: "zh", route: "global" }),
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
            type: "poi",
          },
        ],
        provider: "geoapify",
        degraded: false,
        cached: false,
      }),
    );

    const response = await service.search({ q: "Paris", limit: 6 });

    expect(response.cached).toBe(false);
    expect(response.items.every((item) => item.provider !== "local")).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("changes the cache key by route, country and focus", () => {
    const { cache } = setup();
    const base = { q: "Paris", limit: 6, route: "global" as const };
    expect(cache.key(base)).not.toBe(cache.key({ ...base, route: "mixed" }));
    expect(cache.key(base)).not.toBe(cache.key({ ...base, country: "FR" }));
    expect(cache.key(base)).not.toBe(cache.key({ ...base, focus: { lat: 48.85, lon: 2.35 } }));
    expect(cache.key(base)).not.toBe(cache.key({ ...base, providerSignature: "v1:geoapify@10" }));
    expect(cache.key({ ...base, providerSignature: "v1:geoapify@10" })).not.toBe(
      cache.key({ ...base, providerSignature: "v2:geoapify@10" }),
    );
    expect(cache.key(base)).toMatch(/^places:v4:global:[a-f0-9]{64}$/);
  });
});

describe("PlacesService — eligibility helpers", () => {
  it("routes Han queries without country to mixed and country=CN to china", () => {
    expect(routeFor({ q: "北京" })).toBe("mixed");
    expect(routeFor({ q: "北京", country: "CN" })).toBe("china");
    expect(routeFor({ q: "Paris" })).toBe("global");
  });

  it("orders eligible sources by settings.sourceOrder", () => {
    const settings = resolvePlacesSettings({ GEOAPIFY_API_KEY: "key" });
    expect(eligibleSources({ q: "北京" }, settings)).toEqual(["tencent", "geoapify", "photon"]);
    expect(eligibleSources({ q: "Paris", country: "JP" }, settings)).toEqual([
      "geoapify",
      "photon",
    ]);
  });
});
