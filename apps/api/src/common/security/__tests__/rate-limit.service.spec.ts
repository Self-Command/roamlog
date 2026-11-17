import { describe, expect, it, vi } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service.js";
import type { PinoLoggerService } from "../../../modules/observability/pino-logger.service.js";
import type { RedisService } from "../../../modules/redis/redis.service.js";
import { RateLimitService } from "../rate-limit.service.js";

function config(): AppConfigService {
  return {
    rateLimitWindowSeconds: 60,
    authRateLimitMax: 10,
    publicShareRateLimitMax: 60,
    publicSharePasswordRateLimitMax: 20,
    mediaPresignRateLimitMax: 20,
  } as unknown as AppConfigService;
}

function logger(): PinoLoggerService {
  return {
    warn: vi.fn(),
  } as unknown as PinoLoggerService;
}

describe("RateLimitService", () => {
  it("uses the distributed fixed-window counter when Redis is available", async () => {
    const incrementFixedWindow = vi.fn();
    const service = new RateLimitService(
      { incrementFixedWindow } as unknown as RedisService,
      config(),
      logger(),
    );

    for (let count = 1; count <= 10; count += 1) {
      incrementFixedWindow.mockResolvedValueOnce({ count, ttlSeconds: 60 });
      await expect(service.consume("authMutation", "127.0.0.1")).resolves.toMatchObject({
        allowed: true,
        limit: 10,
        remaining: 10 - count,
        degraded: false,
      });
    }

    incrementFixedWindow.mockResolvedValueOnce({ count: 11, ttlSeconds: 47 });
    await expect(service.consume("authMutation", "127.0.0.1")).resolves.toMatchObject({
      allowed: false,
      limit: 10,
      remaining: 0,
      retryAfterSeconds: 47,
      degraded: false,
    });
    expect(incrementFixedWindow).toHaveBeenCalledTimes(11);
  });

  it("falls back to the process-local fixed window and marks the result degraded", async () => {
    const service = new RateLimitService(
      {
        incrementFixedWindow: vi.fn().mockRejectedValue(new Error("redis unavailable")),
      } as unknown as RedisService,
      config(),
      logger(),
    );

    for (let count = 1; count <= 20; count += 1) {
      await expect(service.consume("mediaPresign", "127.0.0.1")).resolves.toMatchObject({
        allowed: true,
        limit: 20,
        degraded: true,
      });
    }
    await expect(service.consume("mediaPresign", "127.0.0.1")).resolves.toMatchObject({
      allowed: false,
      limit: 20,
      remaining: 0,
      degraded: true,
    });
  });

  it("falls back when the Redis service does not expose the distributed counter", async () => {
    const service = new RateLimitService({} as RedisService, config(), logger());

    await expect(service.consume("publicShareRead", "127.0.0.1")).resolves.toMatchObject({
      allowed: true,
      limit: 60,
      remaining: 59,
      degraded: true,
    });
  });
});
