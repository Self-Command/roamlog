import { Inject, Injectable } from "@nestjs/common";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "../redis/redis.service.js";
import { AI_SETTINGS, type AiSettings } from "./ai.settings.js";

const QUOTA_KEY_PREFIX = "ai:quota:";
const WARN_THROTTLE_MS = 10_000;

export interface AiQuotaDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/** Seconds until UTC midnight; the daily plan-run counter resets with it. */
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
 * Per-user daily cap on AI plan runs (`AI_DAILY_QUOTA`, default 20).
 *
 * Redis-backed fixed window keyed by user + UTC date, consumed before the model
 * is called. `0` disables the cap. Redis is best-effort: a cache outage must not
 * take AI planning down, so it fails open (and logs once per 10s).
 */
@Injectable()
export class AiQuotaService {
  private lastWarnAt = 0;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(AI_SETTINGS) private readonly settings: AiSettings,
  ) {}

  async consume(userId: string, now: Date = new Date()): Promise<AiQuotaDecision> {
    const limit = this.settings.dailyQuota;
    const retryAfterSeconds = secondsUntilUtcMidnight(now);
    if (limit <= 0) {
      return { allowed: true, limit, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds };
    }

    const dateKey = now.toISOString().slice(0, 10);
    const key = `${QUOTA_KEY_PREFIX}${userId}:${dateKey}`;

    try {
      const counter = await withTimeout(
        this.redis.incrementFixedWindow(key, retryAfterSeconds),
        1_000,
        "AI daily quota counter timed out",
      );
      return {
        allowed: counter.count <= limit,
        limit,
        remaining: Math.max(0, limit - counter.count),
        retryAfterSeconds,
      };
    } catch (error) {
      this.warnFailOpen(error);
      return { allowed: true, limit, remaining: limit, retryAfterSeconds };
    }
  }

  private warnFailOpen(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_THROTTLE_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      {
        event: "ai.quota_unavailable",
        ...(error instanceof Error ? { reason: error.name } : {}),
      },
      "ai.quota_fail_open",
    );
  }
}