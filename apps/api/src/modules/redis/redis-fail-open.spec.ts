import { describe, expect, it, vi } from "vitest";

import { RateLimitService } from "../../common/security/rate-limit.service.js";
import type { AppConfigService } from "../../config/app-config.service.js";
import { JobQueueService } from "../exports/job-queue.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PlacesCacheService } from "../places/places-cache.service.js";
import { RedisService } from "./redis.service.js";

/**
 * Fail-open behaviour for every consumer when Redis is a closed port
 * (`redis://127.0.0.1:1`). Before this fix, `get`/`set` rejected with
 * `MaxRetriesPerRequestError` and, for unguarded callers, killed the process.
 */
const CLOSED_PORT_URL = "redis://127.0.0.1:1";

function logger(): PinoLoggerService {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  } as unknown as PinoLoggerService;
}

function redisService(log: PinoLoggerService): RedisService {
  return new RedisService(
    { redisUrl: CLOSED_PORT_URL, redisPrefix: "fail-open-test", redisRequired: false } as AppConfigService,
    log,
  );
}

describe("Redis consumers stay available when Redis is down", () => {
  it("rate limiting fails open (no 429 storm) and marks the decision degraded", async () => {
    const log = logger();
    const redis = redisService(log);
    const rateLimits = new RateLimitService(
      redis,
      {
        rateLimitWindowSeconds: 60,
        authRateLimitMax: 10,
        publicShareRateLimitMax: 60,
        publicSharePasswordRateLimitMax: 20,
        mediaPresignRateLimitMax: 20,
      } as unknown as AppConfigService,
      log,
    );

    try {
      const decisions = await Promise.all(
        Array.from({ length: 5 }, () => rateLimits.consume("authMutation", "203.0.113.7")),
      );
      expect(decisions.every((decision) => decision.allowed)).toBe(true);
      expect(decisions.every((decision) => decision.degraded)).toBe(true);
      expect(log.warn).toHaveBeenCalled();
    } finally {
      await redis.onModuleDestroy();
    }
  }, 20_000);

  it("places cache misses read through to the upstream provider", async () => {
    const log = logger();
    const redis = redisService(log);
    const cache = new PlacesCacheService(redis, log, {
      redisTimeoutMs: 1_500,
      geoapifyDailyLimit: 100,
    } as never);

    try {
      const key = cache.key({ q: "kyoto", limit: 5, provider: "photon" });
      // A degraded read is a cache miss: the caller refetches from the provider.
      await expect(cache.read(key)).resolves.toBeUndefined();
      await expect(cache.write(key, { items: [] } as never, 60)).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalled();
    } finally {
      await redis.onModuleDestroy();
    }
  }, 20_000);

  it("queue ingress fails closed: it never reports a job that was not queued", async () => {
    const log = logger();
    const redis = redisService(log);
    const queue = new JobQueueService(redis);

    try {
      await expect(
        queue.enqueue({
          queue: "export",
          name: "trip-export",
          jobId: "export-abc",
          data: { tripId: "t" },
        }),
      ).rejects.toThrow();
    } finally {
      await redis.onModuleDestroy();
    }
  }, 20_000);
});