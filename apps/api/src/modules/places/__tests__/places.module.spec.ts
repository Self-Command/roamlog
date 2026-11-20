import { Test } from "@nestjs/testing";
import { expect, it } from "vitest";

import { AppModule } from "../../../app.module.js";
import { PlaceSearchRateLimitGuard } from "../places-rate-limit.guard.js";
import { PlacesController } from "../places.controller.js";
import { PlacesService } from "../places.service.js";
import { resolvePlacesSettings } from "../places.settings.js";

it("wires the places module into AppModule", async () => {
  const settings = resolvePlacesSettings({});
  expect(settings.provider).toBe("geoapify");
  expect(settings.baseUrl).toBe("https://photon.komoot.io/api");
  expect(settings.timeoutMs).toBe(2_500);
  expect(settings.geoapifyBaseUrl).toBe("https://api.geoapify.com/v1/geocode/autocomplete");
  expect(settings.geoapifyTimeoutMs).toBe(4_000);
  expect(settings.geoapifyApiKey).toBeNull();
  expect(settings.geoapifyDailyLimit).toBe(3_000);
  expect(settings.fallbackToPhoton).toBe(true);
  expect(settings.cacheTtlSeconds).toBe(900);
  expect(settings.emptyCacheTtlSeconds).toBe(30);
  expect(settings.rateLimitMax).toBe(30);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  expect(moduleRef.get(PlacesService)).toBeInstanceOf(PlacesService);
  expect(moduleRef.get(PlacesController)).toBeInstanceOf(PlacesController);
  expect(moduleRef.get(PlaceSearchRateLimitGuard)).toBeInstanceOf(PlaceSearchRateLimitGuard);

  await moduleRef.close();
});

it("reads overrides from the environment", () => {
  const settings = resolvePlacesSettings({
    PLACES_PROVIDER: "photon",
    PHOTON_URL: "https://photon.internal/api",
    PHOTON_TIMEOUT_MS: "1200",
    GEOAPIFY_URL: "https://geoapify.internal/v1/geocode/autocomplete",
    GEOAPIFY_API_KEY: "env-key",
    GEOAPIFY_TIMEOUT_MS: "900",
    GEOAPIFY_DAILY_LIMIT: "120",
    PLACES_FALLBACK_TO_PHOTON: "false",
    PLACES_CACHE_TTL_SECONDS: "60",
    PLACES_EMPTY_CACHE_TTL_SECONDS: "10",
    PLACES_RATE_LIMIT_MAX: "5",
  });

  expect(settings).toMatchObject({
    provider: "photon",
    baseUrl: "https://photon.internal/api",
    timeoutMs: 1_200,
    geoapifyBaseUrl: "https://geoapify.internal/v1/geocode/autocomplete",
    geoapifyApiKey: "env-key",
    geoapifyTimeoutMs: 900,
    geoapifyDailyLimit: 120,
    fallbackToPhoton: false,
    cacheTtlSeconds: 60,
    emptyCacheTtlSeconds: 10,
    rateLimitMax: 5,
  });
});

it("falls back to defaults for invalid overrides", () => {
  const settings = resolvePlacesSettings({
    PLACES_PROVIDER: "google",
    PHOTON_TIMEOUT_MS: "zero",
    GEOAPIFY_TIMEOUT_MS: "0",
    GEOAPIFY_DAILY_LIMIT: "-3",
    PLACES_FALLBACK_TO_PHOTON: "maybe",
    PLACES_CACHE_TTL_SECONDS: "-3",
    PLACES_RATE_LIMIT_MAX: "1e9",
    PHOTON_URL: "   ",
  });

  expect(settings).toMatchObject({
    provider: "geoapify",
    baseUrl: "https://photon.komoot.io/api",
    timeoutMs: 2_500,
    geoapifyTimeoutMs: 4_000,
    geoapifyDailyLimit: 3_000,
    fallbackToPhoton: true,
    cacheTtlSeconds: 900,
    rateLimitMax: 30,
  });
});
