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
    baseUrl: "https://photon.example.test/api",
    timeoutMs: 2_500,
    cacheTtlSeconds: 900,
    emptyCacheTtlSeconds: 30,
    rateLimitMax: 30,
    rateLimitWindowSeconds: 60,
    rateLimitTimeoutMs: 750,
    redisTimeoutMs: 500,
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
  let counter = 0;

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    incrementFixedWindow: vi.fn(async () => {
      counter += 1;
      return { count: counter, ttlSeconds: 60 };
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
