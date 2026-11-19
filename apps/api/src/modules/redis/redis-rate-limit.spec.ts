import { once } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { startRedisStub } from "../../../../../e2e/live-support/redis-stub.js";
import { RateLimitService } from "../../common/security/rate-limit.service.js";
import type { AppConfigService } from "../../config/app-config.service.js";
import type { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "./redis.service.js";

describe("RedisService fixed-window rate limiting", () => {
  it("uses shared Redis INCR/TTL counters without degrading to process memory", async () => {
    const stub = await startRedisStub({ port: 0 });
    const logger = {
      warn: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
      fatal: vi.fn(),
    } as unknown as PinoLoggerService;
    const redis = new RedisService(
      {
        redisUrl: `redis://127.0.0.1:${stub.port}`,
        redisPrefix: "rate-limit-test",
      } as AppConfigService,
      logger,
    );
    const rateLimits = new RateLimitService(
      redis,
      {
        rateLimitWindowSeconds: 60,
        authRateLimitMax: 10,
        publicShareRateLimitMax: 60,
        publicSharePasswordRateLimitMax: 20,
        mediaPresignRateLimitMax: 20,
      } as unknown as AppConfigService,
      logger,
    );

    try {
      // The client connects eagerly and `enableOfflineQueue` is off (by design:
      // a down Redis must fail fast), so wait for the handshake before asserting
      // that a healthy Redis produces non-degraded counters.
      if (redis.client.status !== "ready") {
        await once(redis.client, "ready");
      }
      for (let count = 1; count <= 10; count += 1) {
        await expect(rateLimits.consume("authMutation", "127.0.0.1")).resolves.toMatchObject({
          allowed: true,
          remaining: 10 - count,
          degraded: false,
        });
      }
      await expect(rateLimits.consume("authMutation", "127.0.0.1")).resolves.toMatchObject({
        allowed: false,
        remaining: 0,
        degraded: false,
      });
    } finally {
      await redis.onModuleDestroy();
      await stub.close();
    }
  });
});
