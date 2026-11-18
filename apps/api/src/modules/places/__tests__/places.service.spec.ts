import { BadRequestException } from "@nestjs/common";
import { PlaceSearchResponseSchema } from "@roamlog/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RedisService } from "../../redis/redis.service.js";
import { PhotonClient } from "../photon.client.js";
import type { PlacesSettings } from "../places.settings.js";
import { PlacesCacheService } from "../places-cache.service.js";
import { PlacesService } from "../places.service.js";
import {
  abortAwareFetch,
  asLogger,
  fakeRedis,
  jsonResponse,
  makeLogger,
  photonFeature,
  photonPayload,
  testSettings,
  type FakeRedis,
} from "./place-fixtures.js";

function setup(
  options: { settings?: Partial<PlacesSettings>; redis?: FakeRedis } = {},
): {
  settings: PlacesSettings;
  logger: ReturnType<typeof makeLogger>;
  redis: FakeRedis;
  cache: PlacesCacheService;
  service: PlacesService;
} {
  const settings = testSettings(options.settings);
  const logger = makeLogger();
  const redis = options.redis ?? fakeRedis();
  const cache = new PlacesCacheService(
    redis as unknown as RedisService,
    asLogger(logger),
    settings,
  );
  const service = new PlacesService(cache, new PhotonClient(settings), asLogger(logger), settings);
  return { settings, logger, redis, cache, service };
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
  it("maps a normal upstream response and caches it for 15 minutes", async () => {
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
          country: "France",
          countryCode: "FR",
          lat: 48.8566,
          lng: 2.3522,
          timeZone: null,
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

  it("degrades to an empty 200 result on an upstream 500 and caches it for 30 seconds", async () => {
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

  it("degrades on a timeout instead of failing the request", async () => {
    vi.stubGlobal("fetch", abortAwareFetch());
    const { service, redis } = setup({ settings: { timeoutMs: 20 } });

    const response = await service.search({ q: "Paris", limit: 6 });

    expect(response).toMatchObject({ items: [], provider: "photon", degraded: true });
    expect((redis.set.mock.calls[0] as [string, string, number])[2]).toBe(30);
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

  it("keys the cache by the requested language even when it is not forwarded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(photonPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { service } = setup();

    await service.search({ q: "Paris", limit: 6, lang: "zh" });
    await service.search({ q: "Paris", limit: 6, lang: "en" });
    await service.search({ q: "Paris", limit: 6, lang: "zh" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
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
      cache.key({ q: "Paris", limit: 6 }),
      JSON.stringify({
        items: [
          {
            provider: "local",
            providerPlaceId: null,
            name: "Manually added spot",
            country: "France",
            countryCode: "FR",
            lat: 48.85,
            lng: 2.35,
            timeZone: null,
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

  it("derives cache keys from normalized query, limit and lang only", () => {
    const { cache } = setup();

    expect(cache.key({ q: "  PARIS ", limit: 6 })).toBe(cache.key({ q: "paris", limit: 6 }));
    expect(cache.key({ q: "paris", limit: 6 })).not.toBe(cache.key({ q: "paris", limit: 5 }));
    expect(cache.key({ q: "paris", limit: 6, lang: "zh" })).not.toBe(
      cache.key({ q: "paris", limit: 6, lang: "en" }),
    );
    expect(cache.key({ q: "paris", limit: 6 })).toMatch(/^places:search:[a-f0-9]{64}$/);
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
