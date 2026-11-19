import { Inject, Injectable } from "@nestjs/common";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "../redis/redis.service.js";
import { PLACES_SETTINGS, type PlacesSettingsSource } from "./places.settings.js";

const GEOAPIFY_QUOTA_KEY_PREFIX = "places:quota:geoapify:";
const TENCENT_QUOTA_KEY_PREFIX = "places:quota:tencent:";
const GEOAPIFY_QUOTA_POLICY = "geoapifyDaily";
const TENCENT_QUOTA_POLICY = "tencentDaily";
const QUOTA_WARN_THROTTLE_MS = 10_000;

export interface PlacesQuotaDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
}

/** Seconds until the next UTC midnight; Geoapify's daily quota resets on UTC. */
export function secondsUntilUtcMidnight(now: Date): number {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1_000));
}

/**
 * Server-side daily request cap for Geoapify.
 *
 * - Uses `INCR` + `EXPIRE` through the shared Redis fixed-window primitive. The
 *   TTL ends at the next UTC midnight, so the counter resets with the provider
 *   quota.
 * - The counter is consumed **before** the upstream call: once the cap is
 *   reached the request is degraded without spending another Geoapify call.
 * - Redis is best-effort and fails open, like the rate limiter: a Redis outage
 *   must not make search unavailable.
 * - `GEOAPIFY_DAILY_LIMIT=0` disables the cap (useful for tests/self-hosted
 *   keys); it never calls Redis in that case.
 */
@Injectable()
export class PlacesQuotaService {
  private lastWarnAt = 0;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(PLACES_SETTINGS) private readonly settings: PlacesSettingsSource,
  ) {}

  async consume(now: Date = new Date()): Promise<PlacesQuotaDecision> {
    const settings = await this.settings.resolve();
    return this.consumeFor(
      GEOAPIFY_QUOTA_KEY_PREFIX,
      settings.geoapifyDailyLimit,
      settings.redisTimeoutMs,
      GEOAPIFY_QUOTA_POLICY,
      now,
    );
  }

  /**
   * Same fixed window for the Tencent key (`TENCENT_MAPS_DAILY_LIMIT`). The
   * China route degrades instead of spending a call once the cap is reached.
   */
  async consumeTencent(now: Date = new Date()): Promise<PlacesQuotaDecision> {
    const settings = await this.settings.resolve();
    return this.consumeFor(
      TENCENT_QUOTA_KEY_PREFIX,
      settings.tencentDailyLimit,
      settings.redisTimeoutMs,
      TENCENT_QUOTA_POLICY,
      now,
    );
  }

  private async consumeFor(
    prefix: string,
    limit: number,
    redisTimeoutMs: number,
    policy: string,
    now: Date,
  ): Promise<PlacesQuotaDecision> {
    if (limit <= 0) {
      return { allowed: true, limit, remaining: Number.MAX_SAFE_INTEGER };
    }

    const dateKey = now.toISOString().slice(0, 10);
    const key = `${prefix}${dateKey}`;

    try {
      const counter = await withTimeout(
        this.redis.incrementFixedWindow(key, secondsUntilUtcMidnight(now)),
        redisTimeoutMs,
        "Places daily quota counter timed out",
      );
      const remaining = Math.max(0, limit - counter.count);
      return { allowed: counter.count <= limit, limit, remaining };
    } catch (error) {
      this.warnFailOpen(error, policy);
      return { allowed: true, limit, remaining: limit };
    }
  }

  private warnFailOpen(error: unknown, policy: string): void {
    const now = Date.now();
    if (now - this.lastWarnAt < QUOTA_WARN_THROTTLE_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      {
        event: "places.quota_unavailable",
        policy,
        ...(error instanceof Error ? { reason: error.name } : {}),
      },
      "places.quota_fail_open",
    );
  }
}