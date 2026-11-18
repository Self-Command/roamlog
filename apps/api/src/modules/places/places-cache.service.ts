import { Inject, Injectable } from "@nestjs/common";
import { PlaceSearchResponseSchema, type PlaceSearchResponse } from "@roamlog/contracts";
import { createHash } from "node:crypto";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "../redis/redis.service.js";
import { PLACES_SETTINGS, type PlacesSettings } from "./places.settings.js";

const CACHE_KEY_PREFIX = "places:search:";
const CACHE_WARN_THROTTLE_MS = 10_000;

export interface PlacesCacheKeyInput {
  readonly q: string;
  readonly limit: number;
  readonly lang?: string;
}

/**
 * Redis-backed cache for normalized place searches.
 *
 * - The key is a SHA-256 digest of `trim+lowercase(q) | limit | lang`, so raw
 *   queries never appear in Redis keys or logs.
 * - Redis is best-effort: read/write failures and timeouts are swallowed and
 *   logged once per throttle window. A search must keep working without Redis.
 * - Cached payloads are re-validated against the strict response contract and
 *   must be `provider: "photon"`; a poisoned or stale `local` entry is ignored
 *   so search can never serve manual fallback data.
 */
@Injectable()
export class PlacesCacheService {
  private lastWarnAt = 0;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(PLACES_SETTINGS) private readonly settings: PlacesSettings,
  ) {}

  key(input: PlacesCacheKeyInput): string {
    const normalized = [input.q.trim().toLowerCase(), input.limit, input.lang ?? ""].join("\u0000");
    const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
    return `${CACHE_KEY_PREFIX}${digest}`;
  }

  async read(key: string): Promise<PlaceSearchResponse | undefined> {
    try {
      const stored = await withTimeout(
        this.redis.get(key),
        this.settings.redisTimeoutMs,
        "Places cache read timed out",
      );
      if (stored === null) {
        return undefined;
      }

      const parsed = PlaceSearchResponseSchema.safeParse(JSON.parse(stored) as unknown);
      if (!parsed.success) {
        this.warnUnavailable("read_invalid_entry");
        return undefined;
      }
      if (parsed.data.provider !== "photon") {
        this.warnUnavailable("read_unexpected_provider");
        return undefined;
      }
      return parsed.data;
    } catch (error) {
      this.warnUnavailable("read", error);
      return undefined;
    }
  }

  async write(key: string, response: PlaceSearchResponse, ttlSeconds: number): Promise<void> {
    try {
      await withTimeout(
        this.redis.set(key, JSON.stringify(response), ttlSeconds),
        this.settings.redisTimeoutMs,
        "Places cache write timed out",
      );
    } catch (error) {
      this.warnUnavailable("write", error);
    }
  }

  private warnUnavailable(operation: string, error?: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < CACHE_WARN_THROTTLE_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      {
        event: "places.cache_unavailable",
        operation,
        ...(error instanceof Error ? { reason: error.name } : {}),
      },
      "places.cache_bypassed",
    );
  }
}
