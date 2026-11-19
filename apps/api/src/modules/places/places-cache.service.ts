import { Inject, Injectable } from "@nestjs/common";
import { PlaceSearchResponseSchema, type PlaceSearchResponse } from "@roamlog/contracts";
import { createHash } from "node:crypto";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "../redis/redis.service.js";
import {
  PLACES_SETTINGS,
  type PlacesResponseProvider,
  type PlacesSettingsSource,
} from "./places.settings.js";

/**
 * Versioned, provider-scoped cache namespace. The `v3` segment invalidates the
 * Photon-only payload shape, and the provider segment prevents a search issued
 * after switching `PLACES_PROVIDER` from hitting data produced by the other
 * source.
 */
const CACHE_KEY_PREFIX = "places:v3:";
const CACHE_WARN_THROTTLE_MS = 10_000;

export interface PlacesCacheKeyInput {
  readonly q: string;
  readonly limit: number;
  readonly lang?: string;
  /** Primary provider; part of the key so switching sources misses old entries. */
  readonly provider: PlacesResponseProvider;
}

/**
 * Redis-backed cache for normalized place searches.
 *
 * - The key is `places:v3:{provider}:{sha256(trim+lowercase(q) | limit | lang)}`,
 *   so raw queries never appear in Redis keys or logs.
 * - Redis is best-effort: read/write failures and timeouts are swallowed and
 *   logged once per throttle window. A search must keep working without Redis.
 * - Cached payloads are re-validated against the strict response contract.
 *   Manual (`"local"`) places and unexpected response providers are ignored so
 *   search can never serve client-authored fallback data.
 */
@Injectable()
export class PlacesCacheService {
  private lastWarnAt = 0;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(PLACES_SETTINGS) private readonly settings: PlacesSettingsSource,
  ) {}

  key(input: PlacesCacheKeyInput): string {
    const normalized = [input.q.trim().toLowerCase(), input.limit, input.lang ?? ""].join("\u0000");
    const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
    return `${CACHE_KEY_PREFIX}${input.provider}:${digest}`;
  }

  async read(key: string): Promise<PlaceSearchResponse | undefined> {
    try {
      const settings = await this.settings.resolve();
      const stored = await withTimeout(
        this.redis.get(key),
        settings.redisTimeoutMs,
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
      if (
        parsed.data.provider !== "photon" &&
        parsed.data.provider !== "geoapify" &&
        parsed.data.provider !== "tencent"
      ) {
        this.warnUnavailable("read_unexpected_provider");
        return undefined;
      }
      if (parsed.data.items.some((item) => item.provider === "local")) {
        this.warnUnavailable("read_local_item");
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
      const settings = await this.settings.resolve();
      await withTimeout(
        this.redis.set(key, JSON.stringify(response), ttlSeconds),
        settings.redisTimeoutMs,
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