import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { User } from "@roamlog/contracts";
import { PlaceSearchResponseSchema } from "@roamlog/contracts";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequest } from "../../../common/guards/actor-context.js";
import { SessionGuard } from "../../../common/guards/session.guard.js";
import { VerifiedEmailGuard } from "../../../common/guards/verified-email.guard.js";
import { ProblemDetailsFilter } from "../../../common/filters/problem-details.filter.js";
import { AuthService } from "../../auth/auth.service.js";
import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { RedisService } from "../../redis/redis.service.js";
import { GeoapifyClient } from "../geoapify.client.js";
import { PhotonClient } from "../photon.client.js";
import { PlacesCacheService } from "../places-cache.service.js";
import { PlacesMergeService } from "../places-merge.service.js";
import { PlaceSearchRateLimitGuard } from "../places-rate-limit.guard.js";
import { PlacesQuotaService } from "../places-quota.service.js";
import { PlacesRateLimiter } from "../places-rate-limiter.service.js";
import { PlacesController } from "../places.controller.js";
import { PlacesService } from "../places.service.js";
import { TencentClient } from "../tencent.client.js";
import { PLACES_SETTINGS, staticPlacesSettingsSource } from "../places.settings.js";
import { LIMITS_SETTINGS } from "../../settings/limits-settings.consumer.js";
import {
  asLogger,
  fakeRedis,
  jsonResponse,
  makeLogger,
  photonPayload,
  tencentSuggestionPayload,
  testSettings,
  type FakeRedis,
} from "./place-fixtures.js";

const TEST_USER = {
  id: "01942f30-1200-7000-8000-000000000101",
  email: "traveler@roamlog.local",
  emailVerified: true,
} as unknown as User;

const apps: INestApplication[] = [];

async function createApp(options: { authenticated: boolean; redis?: FakeRedis }) {
  const logger = makeLogger();
  const redis = options.redis ?? fakeRedis();
  const settings = testSettings();
  // Mutable so a test can change `limits.searchPerMinute` between requests and
  // prove the guard re-reads it instead of using a startup snapshot.
  const limits = { searchPerMinute: 30, uploadPerMinute: 20 };

  const builder = Test.createTestingModule({
    controllers: [PlacesController],
    providers: [
      { provide: PLACES_SETTINGS, useValue: staticPlacesSettingsSource(settings) },
      { provide: LIMITS_SETTINGS, useValue: { resolve: async () => ({ ...limits }) } },
      { provide: PinoLoggerService, useValue: asLogger(logger) },
      { provide: RedisService, useValue: redis },
      { provide: AuthService, useValue: { resolveSession: vi.fn().mockResolvedValue(null) } },
      {
        provide: PrismaService,
        useValue: { client: { user: { findUnique: vi.fn() } } },
      },
      GeoapifyClient,
      PhotonClient,
      TencentClient,
      PlacesCacheService,
      PlacesQuotaService,
      PlacesMergeService,
      PlacesRateLimiter,
      PlacesService,
      SessionGuard,
      VerifiedEmailGuard,
      PlaceSearchRateLimitGuard,
    ],
  });

  if (options.authenticated) {
    builder.overrideGuard(SessionGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest<AuthenticatedRequest>().user = TEST_USER;
        return true;
      },
    });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(
    new ProblemDetailsFilter(asLogger(logger), { captureException: vi.fn() } as never),
  );
  await app.init();
  apps.push(app);
  return { app, logger, redis, limits };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("GET /v1/places/search", () => {
  it("rejects an anonymous request with 401", async () => {
    const { app } = await createApp({ authenticated: false });

    const response = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(401);

    expect(response.body).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("rejects an invalid query with a VALIDATION_ERROR problem", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { app } = await createApp({ authenticated: true });

    const response = await request(app.getHttpServer())
      .get("/v1/places/search?q=&limit=6")
      .expect(400);

    expect(response.body).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    expect(response.body.errors).toEqual([expect.objectContaining({ field: "q" })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns contract-valid places with rate-limit headers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(photonPayload())));
    const { app } = await createApp({ authenticated: true });

    const response = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(200);

    expect(PlaceSearchResponseSchema.parse(response.body)).toEqual(response.body);
    expect(response.body).toMatchObject({ provider: "photon", degraded: false, cached: false });
    expect(response.body.items).toHaveLength(1);
    expect(response.headers["ratelimit-limit"]).toBe("30");
    expect(response.headers["ratelimit-remaining"]).toBe("29");
  });

  it("applies the contract default limit and forwards only supported languages", async () => {
    const fetchMock = vi.fn((url: URL) =>
      Promise.resolve(
        url.hostname.startsWith("tencent")
          ? jsonResponse(tencentSuggestionPayload())
          : jsonResponse(photonPayload()),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { app } = await createApp({ authenticated: true });

    await request(app.getHttpServer()).get("/v1/places/search?q=paris").expect(200);
    // The fixture's `places.lang` default is `zh`, so the first request already
    // forwarded `lang=zh` and an explicit `lang=zh` shares its cache key.
    const cached = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris&lang=zh")
      .expect(200);
    // Han script makes Tencent eligible (`mixed` route) alongside the global
    // providers; `lang=zh` alone is not enough to pick the mainland source.
    const chinese = await request(app.getHttpServer())
      .get(`/v1/places/search?q=${encodeURIComponent("建国路87号")}&lang=zh`)
      .expect(200);

    const firstGeoapify = (fetchMock.mock.calls as unknown as [URL][])
      .map(([url]) => url)
      .find((url) => url.hostname.startsWith("geoapify"));
    expect(firstGeoapify?.hostname).toBe("geoapify.example.test");
    expect(firstGeoapify?.searchParams.get("limit")).toBe("6");
    // Geoapify accepts `lang=zh`; Photon drops it because its public instance
    // only supports default/de/en/fr.
    expect(firstGeoapify?.searchParams.get("lang")).toBe("zh");
    const firstPhoton = (fetchMock.mock.calls as unknown as [URL][])
      .map(([url]) => url)
      .find((url) => url.hostname.startsWith("photon"));
    expect(firstPhoton?.searchParams.get("lang")).toBeNull();
    const tencentCall = (fetchMock.mock.calls as unknown as [URL][])
      .map(([url]) => url)
      .find((url) => url.hostname.startsWith("tencent") && url.pathname.includes("suggestion"));
    expect(tencentCall?.searchParams.get("keyword")).toBe("建国路87号");
    // paris: geoapify + photon; 建国路87号 (two Han variants): tencent geocoder +
    // suggestion + two geoapify + two photon.
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(cached.body.cached).toBe(true);
    expect(chinese.body.provider).toBe("tencent");
  });

  it("serves the second identical request from cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(photonPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { app } = await createApp({ authenticated: true });

    const first = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(200);
    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(200);

    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("returns a degraded 200 when Photon fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 503)));
    const { app, logger } = await createApp({ authenticated: true });

    const response = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(200);

    expect(response.body).toEqual({
      items: [],
      provider: "photon",
      degraded: true,
      cached: false,
      fallback: "map_pick",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "places.upstream_failed", httpStatus: 503 }),
      "places.search_degraded",
    );
  });

  it("returns 429 when the per-user window is exhausted", async () => {
    const redis = fakeRedis();
    redis.incrementFixedWindow.mockResolvedValue({ count: 31, ttlSeconds: 42 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(photonPayload())));
    const { app } = await createApp({ authenticated: true, redis });

    const response = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(429);

    expect(response.body).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(response.headers["retry-after"]).toBe("42");
    expect(response.headers["ratelimit-remaining"]).toBe("0");
  });

  it("takes the search allowance from limits.searchPerMinute on every request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(photonPayload())));
    const { app, limits } = await createApp({ authenticated: true });
    limits.searchPerMinute = 2;

    await request(app.getHttpServer()).get("/v1/places/search?q=paris").expect(200);
    await request(app.getHttpServer()).get("/v1/places/search?q=paris").expect(200);
    const rejected = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(429);

    expect(rejected.body).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(rejected.headers["retry-after"]).toBe("60");
    expect(rejected.headers["ratelimit-limit"]).toBe("2");
    expect(rejected.headers["ratelimit-remaining"]).toBe("0");

    // Raising the allowance in the settings must apply to the very next
    // request: the guard resolves the limit per request instead of caching it.
    limits.searchPerMinute = 30;
    const allowed = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(200);
    expect(allowed.headers["ratelimit-limit"]).toBe("30");
  });

  it("still fails open on Redis errors when limits.searchPerMinute is low", async () => {
    const redis = fakeRedis();
    redis.incrementFixedWindow.mockRejectedValue(new Error("redis unavailable"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(photonPayload())));
    const { app, limits } = await createApp({ authenticated: true, redis });
    limits.searchPerMinute = 2;

    const response = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(200);
    expect(response.headers["ratelimit-limit"]).toBe("2");
  });

  it("fails open when the Redis rate-limit counter is unavailable", async () => {
    const redis = fakeRedis();
    redis.incrementFixedWindow.mockRejectedValue(new Error("redis unavailable"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(photonPayload())));
    const { app, logger } = await createApp({ authenticated: true, redis });

    const response = await request(app.getHttpServer())
      .get("/v1/places/search?q=paris")
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "places.rate_limit_unavailable" }),
      "places.rate_limit_fail_open",
    );
  });
});
