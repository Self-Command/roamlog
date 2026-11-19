import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "../redis/redis.service.js";
import {
  LIMITS_SETTINGS,
  type LimitsSettingsSource,
} from "../settings/limits-settings.consumer.js";
import { PLACES_SETTINGS, type PlacesSettingsSource } from "./places.settings.js";

const RATE_LIMIT_KEY_PREFIX = "rate-limit:placeSearch:";
const RATE_LIMIT_WARN_THROTTLE_MS = 10_000;

export interface PlacesRateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/**
 * Per-user+IP fixed-window limiter for place search.
 *
 * Reuses the shared `RedisService.incrementFixedWindow` primitive. Unlike the
 * auth/media limiters this one fails **open**: if Redis is unavailable we log a
 * warning and allow the request, because search is a read path and a Redis
 * outage must not turn the whole API into 429s.
 *
 * The allowance comes from `limits.searchPerMinute` (LIMITS_SETTINGS_WIRED),
 * resolved per request so an admin change applies on the next search; the
 * window still comes from `PLACES_RATE_LIMIT_WINDOW_SECONDS` (default 60 s), so
 * "per minute" holds for the default configuration.
 */
@Injectable()
export class PlacesRateLimiter {
  private lastWarnAt = 0;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(PLACES_SETTINGS) private readonly settings: PlacesSettingsSource,
    @Inject(LIMITS_SETTINGS) private readonly limits: LimitsSettingsSource,
  ) {}

  async consume(identity: string): Promise<PlacesRateLimitDecision> {
    const [settings, limits] = await Promise.all([
      this.settings.resolve(),
      this.limits.resolve(),
    ]);
    const limit = limits.searchPerMinute;
    const windowSeconds = settings.rateLimitWindowSeconds;
    const key = `${RATE_LIMIT_KEY_PREFIX}${createHash("sha256").update(identity, "utf8").digest("hex")}`;

    try {
      const counter = await withTimeout(
        this.redis.incrementFixedWindow(key, windowSeconds),
        settings.rateLimitTimeoutMs,
        "Places rate-limit counter timed out",
      );
      return this.decision(counter.count, counter.ttlSeconds, limit);
    } catch (error) {
      this.warnFailOpen(error);
      return {
        allowed: true,
        limit,
        remaining: limit,
        retryAfterSeconds: windowSeconds,
      };
    }
  }

  private decision(count: number, ttlSeconds: number, limit: number): PlacesRateLimitDecision {
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, ttlSeconds),
    };
  }

  private warnFailOpen(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < RATE_LIMIT_WARN_THROTTLE_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      {
        event: "places.rate_limit_unavailable",
        policy: "placeSearch",
        ...(error instanceof Error ? { reason: error.name } : {}),
      },
      "places.rate_limit_fail_open",
    );
  }
}
