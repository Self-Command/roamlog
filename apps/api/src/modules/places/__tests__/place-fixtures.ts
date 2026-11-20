import { vi } from "vitest";

import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { PlacesSettings } from "../places.settings.js";

export interface LoggerMock {
  readonly log: ReturnType<typeof vi.fn>;
  readonly warn: ReturnType<typeof vi.fn>;
  readonly error: ReturnType<typeof vi.fn>;
  readonly debug: ReturnType<typeof vi.fn>;
}

export function makeLogger(): LoggerMock {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

export function asLogger(logger: LoggerMock): PinoLoggerService {
  return logger as unknown as PinoLoggerService;
}

export function testSettings(overrides: Partial<PlacesSettings> = {}): PlacesSettings {
  return {
    provider: "photon",
    baseUrl: "https://photon.example.test/api",
    timeoutMs: 2_500,
    geoapifyBaseUrl: "https://geoapify.example.test/v1/geocode/autocomplete",
    geoapifyApiKey: "test-key",
    geoapifyTimeoutMs: 1_200,
    geoapifyDailyLimit: 3_000,
    fallbackToPhoton: true,
    tencentBaseUrl: "https://tencent.example.test/ws",
    // A dummy key keeps the China route reachable; no test performs real I/O.
    tencentApiKey: "test-key",
    tencentTimeoutMs: 1_500,
    tencentCacheTtlSeconds: 300,
    tencentDailyLimit: 10_000,
    cacheTtlSeconds: 900,
    emptyCacheTtlSeconds: 30,
    rateLimitMax: 30,
    rateLimitWindowSeconds: 60,
    rateLimitTimeoutMs: 750,
    redisTimeoutMs: 500,
    defaultLimit: 6,
    /**
     * The production default. `lang` is a display preference only: it must not
     * decide the route, so the shared fixture keeps the real value and every
     * provider test below exercises the Chinese UI's actual configuration.
     */
    defaultLang: "zh",
    sources: ["tencent", "geoapify", "photon"],
    sourceOrder: ["tencent", "geoapify", "photon"],
    photonLanguages: ["en"],
    focusPoint: null,
    ...overrides,
  };
}

export interface FakeRedis {
  readonly store: Map<string, string>;
  readonly get: ReturnType<typeof vi.fn>;
  readonly set: ReturnType<typeof vi.fn>;
  readonly incrementFixedWindow: ReturnType<typeof vi.fn>;
}

export function fakeRedis(): FakeRedis {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    incrementFixedWindow: vi.fn(async (key: string) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return { count, ttlSeconds: 60 };
    }),
  };
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch stub that never resolves until the request is aborted. */
export function abortAwareFetch() {
  return vi.fn(
    (_url: URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
        });
      }),
  );
}

export function firstFetchCall(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls[0] as unknown as [URL, RequestInit] | undefined;
  if (!call) {
    throw new Error("expected the upstream client to call fetch");
  }
  return { url: call[0], init: call[1] };
}

export interface PhotonFeatureOverrides {
  name?: unknown;
  country?: unknown;
  countrycode?: unknown;
  coordinates?: unknown;
  osm_id?: unknown;
  osm_type?: unknown;
  type?: unknown;
  osm_key?: unknown;
  osm_value?: unknown;
  street?: unknown;
  housenumber?: unknown;
  postcode?: unknown;
  city?: unknown;
  state?: unknown;
  county?: unknown;
  district?: unknown;
  suburb?: unknown;
  extra?: unknown;
  extent?: unknown;
  importance?: unknown;
}

export function photonFeature(overrides: PhotonFeatureOverrides = {}) {
  const geometry: { type: string; coordinates: unknown } = {
    type: "Point",
    coordinates: [2.3522, 48.8566],
  };
  const properties: Record<string, unknown> = {
    osm_id: 7444,
    osm_type: "R",
    osm_key: "place",
    osm_value: "city",
    type: "city",
    name: "Paris",
    city: "Paris",
    state: "Île-de-France",
    country: "France",
    countrycode: "fr",
  };

  // Explicit `undefined`/`null` values must win over the defaults so tests can
  // model missing fields honestly.
  if ("coordinates" in overrides) {
    geometry.coordinates = overrides.coordinates;
  }
  for (const key of [
    "osm_id",
    "osm_type",
    "osm_key",
    "osm_value",
    "type",
    "name",
    "country",
    "countrycode",
    "street",
    "housenumber",
    "postcode",
    "city",
    "state",
    "county",
    "district",
    "suburb",
    "extra",
    "extent",
    "importance",
  ] as const) {
    if (key in overrides) {
      properties[key] = overrides[key];
    }
  }

  return { type: "Feature", geometry, properties };
}

export function photonPayload(features: unknown[] = [photonFeature()]) {
  return { type: "FeatureCollection", features };
}

export interface GeoapifyFeatureOverrides {
  place_id?: unknown;
  name?: unknown;
  country?: unknown;
  country_code?: unknown;
  coordinates?: unknown;
  lon?: unknown;
  lat?: unknown;
  result_type?: unknown;
  formatted?: unknown;
  address_line1?: unknown;
  address_line2?: unknown;
  state?: unknown;
  city?: unknown;
  county?: unknown;
  district?: unknown;
  suburb?: unknown;
  street?: unknown;
  housenumber?: unknown;
  postcode?: unknown;
  timezone?: unknown;
  bbox?: unknown;
  propertyBbox?: unknown;
  rank?: unknown;
}

/** A trimmed copy of a real Kyoto autocomplete hit (2026-11-19). */
export function geoapifyFeature(overrides: GeoapifyFeatureOverrides = {}) {
  const geometry: { type: string; coordinates: unknown } = {
    type: "Point",
    coordinates: [135.7681441, 35.0115754],
  };
  const properties: Record<string, unknown> = {
    place_id:
      "51e1bdfea47461405994da8b683bb64140f00103f901d146c57b01000000c00201920309e6b885e6b0b4e5afba",
    name: "京都市",
    country: "日本",
    country_code: "jp",
    city: "京都市",
    state: "京都府",
    formatted: "京都市, 京都府, 日本",
    address_line1: "京都市",
    address_line2: "京都府, 日本",
    lon: 135.7681441,
    lat: 35.0115754,
    result_type: "city",
    timezone: { name: "Asia/Tokyo", abbreviation_STD: "JST" },
    rank: { importance: 0.18666666666666665, confidence: 1 },
  };
  const feature: Record<string, unknown> = {
    type: "Feature",
    geometry,
    properties,
    bbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
  };

  if ("coordinates" in overrides) {
    geometry.coordinates = overrides.coordinates;
  }
  if ("bbox" in overrides) {
    feature.bbox = overrides.bbox;
  }
  if ("propertyBbox" in overrides) {
    properties.bbox = overrides.propertyBbox;
  }
  for (const key of [
    "place_id",
    "name",
    "country",
    "country_code",
    "lon",
    "lat",
    "result_type",
    "formatted",
    "address_line1",
    "address_line2",
    "state",
    "city",
    "county",
    "district",
    "suburb",
    "street",
    "housenumber",
    "postcode",
    "timezone",
    "rank",
  ] as const) {
    if (key in overrides) {
      properties[key] = overrides[key];
    }
  }

  return feature;
}

export function geoapifyPayload(features: unknown[] = [geoapifyFeature()]) {
  return { type: "FeatureCollection", features };
}

/**
 * A trimmed `place/v1/suggestion` hit (北京SKP, `建国路87号`) built from the
 * documented response fields. The coordinate is GCJ-02, exactly as Tencent
 * returns it; `gcoord` converts it to WGS-84 inside the normalizer.
 */
export interface TencentSuggestItemOverrides {
  id?: unknown;
  title?: unknown;
  address?: unknown;
  category?: unknown;
  type?: unknown;
  location?: unknown;
  ad_info?: unknown;
  province?: unknown;
  city?: unknown;
  district?: unknown;
}

export const TENCENT_SKP_GCJ02 = { lat: 39.908619, lng: 116.463658 };
export const TENCENT_SKP_WGS84 = { lat: 39.90728075553551, lng: 116.4575016135038 };

export function tencentSuggestItem(overrides: TencentSuggestItemOverrides = {}) {
  const item: Record<string, unknown> = {
    id: "10233345183344841920",
    title: "北京SKP",
    address: "建国路87号",
    category: "购物:商场",
    type: 0,
    location: { ...TENCENT_SKP_GCJ02 },
    ad_info: { adcode: 110105, province: "北京市", city: "北京市", district: "朝阳区" },
  };

  for (const key of [
    "id",
    "title",
    "address",
    "category",
    "type",
    "location",
    "ad_info",
    "province",
    "city",
    "district",
  ] as const) {
    if (key in overrides) {
      item[key] = overrides[key];
    }
  }

  return item;
}

export function tencentSuggestionPayload(items: unknown[] = [tencentSuggestItem()]) {
  return { status: 0, message: "query ok", count: items.length, data: items };
}

/** A Tencent error body: `status: 0` is the only success code. */
export function tencentErrorPayload(status: number, message = "error") {
  return { status, message };
}

export function tencentGeocodePayload(result: Record<string, unknown>) {
  return { status: 0, message: "query ok", request_id: "req-1", result };
}

/** `geocoder/v1?address=` result for 北京市海淀区彩和坊路海淀西大街74号. */
export function tencentGeocodeResult(overrides: Record<string, unknown> = {}) {
  return {
    title: "北京市海淀区彩和坊路海淀西大街74号",
    location: { lat: 39.984154, lng: 116.30749 },
    address_components: {
      province: "北京市",
      city: "北京市",
      district: "海淀区",
      street: "彩和坊路海淀西大街",
      street_number: "74号",
    },
    ad_info: { adcode: "110108" },
    reliability: 7,
    level: 9,
    ...overrides,
  };
}

/** `geocoder/v1?location=` result for 深圳市南山区腾讯滨海大厦. */
export function tencentReverseResult(overrides: Record<string, unknown> = {}) {
  return {
    address: "广东省深圳市南山区深南大道10000号",
    formatted_addresses: {
      recommend: "腾讯滨海大厦(滨海大道辅路)",
      rough: "南山区 腾讯滨海大厦",
    },
    address_component: {
      nation: "中国",
      province: "广东省",
      city: "深圳市",
      district: "南山区",
      street: "深南大道",
      street_number: "10000号",
    },
    location: { lat: 22.539878, lng: 113.934528 },
    ...overrides,
  };
}
