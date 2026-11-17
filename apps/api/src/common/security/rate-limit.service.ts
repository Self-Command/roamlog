import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { withTimeout } from "../utils/with-timeout.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PinoLoggerService } from "../../modules/observability/pino-logger.service.js";
import { RedisService } from "../../modules/redis/redis.service.js";

export type RateLimitPolicy =
  "authMutation" | "publicShareRead" | "publicSharePassword" | "mediaPresign";

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  degraded: boolean;
}

interface MemoryCounter {
  count: number;
  expiresAt: number;
}

interface PolicySettings {
  limit: number;
  windowSeconds: number;
}

@Injectable()
export class RateLimitService {
  private readonly memoryCounters = new Map<string, MemoryCounter>();
  private lastFallbackLogAt = 0;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async consume(policy: RateLimitPolicy, identity: string): Promise<RateLimitDecision> {
    const settings = this.policySettings(policy);
    const key = `rate-limit:${policy}:${sha256(identity)}`;

    try {
      const increment = (this.redis as Partial<Pick<RedisService, "incrementFixedWindow">>)
        .incrementFixedWindow;
      if (typeof increment === "function") {
        const counter = await withTimeout(
          increment.call(this.redis, key, settings.windowSeconds),
          750,
          "Redis rate-limit counter timed out",
        );
        return this.decision(counter.count, counter.ttlSeconds, settings, false);
      }
    } catch {
      this.logFallback(policy);
    }

    const counter = this.incrementMemoryCounter(key, settings.windowSeconds);
    return this.decision(
      counter.count,
      Math.max(1, Math.ceil((counter.expiresAt - Date.now()) / 1_000)),
      settings,
      true,
    );
  }

  private policySettings(policy: RateLimitPolicy): PolicySettings {
    const windowSeconds = this.config.rateLimitWindowSeconds;
    switch (policy) {
      case "authMutation":
        return { limit: this.config.authRateLimitMax, windowSeconds };
      case "publicShareRead":
        return { limit: this.config.publicShareRateLimitMax, windowSeconds };
      case "publicSharePassword":
        return { limit: this.config.publicSharePasswordRateLimitMax, windowSeconds };
      case "mediaPresign":
        return { limit: this.config.mediaPresignRateLimitMax, windowSeconds };
    }
  }

  private decision(
    count: number,
    ttlSeconds: number,
    settings: PolicySettings,
    degraded: boolean,
  ): RateLimitDecision {
    return {
      allowed: count <= settings.limit,
      limit: settings.limit,
      remaining: Math.max(0, settings.limit - count),
      retryAfterSeconds: Math.max(1, ttlSeconds),
      degraded,
    };
  }

  private incrementMemoryCounter(key: string, windowSeconds: number): MemoryCounter {
    const now = Date.now();
    this.pruneMemoryCounters(now);
    const current = this.memoryCounters.get(key);
    if (!current || current.expiresAt <= now) {
      const next = { count: 1, expiresAt: now + windowSeconds * 1_000 };
      this.memoryCounters.set(key, next);
      return next;
    }
    current.count += 1;
    return current;
  }

  private pruneMemoryCounters(now: number): void {
    if (this.memoryCounters.size < 10_000) {
      return;
    }
    for (const [key, counter] of this.memoryCounters) {
      if (counter.expiresAt <= now) {
        this.memoryCounters.delete(key);
      }
    }
    while (this.memoryCounters.size >= 20_000) {
      const oldest = this.memoryCounters.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.memoryCounters.delete(oldest);
    }
  }

  private logFallback(policy: RateLimitPolicy): void {
    const now = Date.now();
    if (now - this.lastFallbackLogAt < 10_000) {
      return;
    }
    this.lastFallbackLogAt = now;
    this.logger.warn({ policy }, "rate_limit.redis_fallback");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
