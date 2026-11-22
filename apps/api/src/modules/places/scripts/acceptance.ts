/**
 * Real-provider acceptance run for the five §5.10 queries.
 *
 * Usage (from `apps/api`):
 *   npx tsx src/modules/places/scripts/acceptance.ts
 *
 * It constructs `PlacesService` with the real Tencent / Geoapify / Photon
 * clients and an in-memory Redis double (cache + daily quota only). Every
 * upstream call is a live HTTPS request; nothing is stubbed. `.env.local` is
 * read for credentials and never printed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PlaceSearchResponse } from "@roamlog/contracts";

import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { RedisService } from "../../redis/redis.service.js";
import { GeoapifyClient } from "../geoapify.client.js";
import { PhotonClient } from "../photon.client.js";
import { PlacesCacheService } from "../places-cache.service.js";
import { PlacesMergeService } from "../places-merge.service.js";
import { staticPlacesProviderRuntimeSource } from "../places-provider-runtime.service.js";
import { PlacesQuotaService } from "../places-quota.service.js";
import { PlacesService } from "../places.service.js";
import { resolvePlacesSettings, staticPlacesSettingsSource } from "../places.settings.js";
import { TencentClient } from "../tencent.client.js";

function loadDotEnv(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return values;
  }
  for (const line of content.split(/\r?\n/)) {
    if (!/^[A-Z0-9_]+=/.test(line)) {
      continue;
    }
    const index = line.indexOf("=");
    values[line.slice(0, index)] = line.slice(index + 1).replace(/^"|"$/g, "");
  }
  return values;
}

function memoryRedis(): RedisService {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
    incrementFixedWindow: async (key: string) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return { count, ttlSeconds: 60 };
    },
  } as unknown as RedisService;
}

const logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as PinoLoggerService;

const env = { ...process.env, ...loadDotEnv(resolve(process.cwd(), "../../.env.local")) };
const settings = resolvePlacesSettings(env);
const source = staticPlacesSettingsSource(settings);
const redis = memoryRedis();
const service = new PlacesService(
  new PlacesCacheService(redis, logger, source),
  new GeoapifyClient(source),
  new PhotonClient(source),
  new TencentClient(source),
  new PlacesQuotaService(redis, logger, source),
  new PlacesMergeService(),
  logger,
  source,
  staticPlacesProviderRuntimeSource(settings),
);

function brief(response: PlaceSearchResponse) {
  return {
    provider: response.provider,
    degraded: response.degraded,
    fallback: response.fallback ?? null,
    items: response.items.slice(0, 2).map((item) => ({
      provider: item.provider,
      name: item.name,
      address: item.address,
      country: item.country,
      countryCode: item.countryCode,
      lat: Number(item.lat.toFixed(5)),
      lng: Number(item.lng.toFixed(5)),
      type: item.type,
      importance: item.importance,
    })),
  };
}

const queries = ["北京", "东京", "京都", "建国路87号", "Paris"] as const;

const results: Record<string, ReturnType<typeof brief>> = {};
for (const q of queries) {
  results[q] = brief(await service.search({ q, limit: 6, lang: "zh" }));
}

process.stdout.write(
  `${JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2)}\n`,
);
