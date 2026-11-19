import { HttpException, Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request } from "express";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { withTimeout } from "../../common/utils/with-timeout.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "../redis/redis.service.js";

/** The probe can send real mail, so it is capped independently of auth limits. */
export const MAIL_TEST_LIMIT_PER_MINUTE = 3;
export const MAIL_TEST_WINDOW_SECONDS = 60;
const KEY_PREFIX = "rate-limit:mailTest:";

interface MemoryCounter {
  count: number;
  expiresAt: number;
}

/**
 * Per-admin rate limit for the real test send: three attempts per rolling
 * minute, Redis-backed with a process-local fallback when Redis is degraded.
 */
@Injectable()
export class MailTestRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, MemoryCounter>();

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & Request>();
    const identity = request.user?.id ?? request.ip ?? "anonymous";
    const key = `${KEY_PREFIX}${createHash("sha256").update(identity, "utf8").digest("hex")}`;

    let count: number;
    let retryAfterSeconds: number;
    try {
      const counter = await withTimeout(
        this.redis.incrementFixedWindow(key, MAIL_TEST_WINDOW_SECONDS),
        750,
        "Mail test rate-limit counter timed out",
      );
      count = counter.count;
      retryAfterSeconds = Math.max(1, counter.ttlSeconds);
    } catch {
      this.logger.warn({ event: "mail.test_rate_limit_fallback" }, "mail.test_rate_limit_fallback");
      const counter = this.incrementMemoryCounter(key);
      count = counter.count;
      retryAfterSeconds = Math.max(1, Math.ceil((counter.expiresAt - Date.now()) / 1_000));
    }

    if (count <= MAIL_TEST_LIMIT_PER_MINUTE) {
      return true;
    }

    throw new HttpException(
      {
        code: "MAIL_TEST_RATE_LIMITED",
        message: "Too many test emails. Try again in a minute.",
        retryAfterSeconds,
      },
      429,
    );
  }

  private incrementMemoryCounter(key: string): MemoryCounter {
    const now = Date.now();
    const current = this.memoryCounters.get(key);
    if (!current || current.expiresAt <= now) {
      const next = { count: 1, expiresAt: now + MAIL_TEST_WINDOW_SECONDS * 1_000 };
      this.memoryCounters.set(key, next);
      return next;
    }
    current.count += 1;
    return current;
  }
}