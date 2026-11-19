import { HttpException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { RedisService } from "../../redis/redis.service.js";
import { MailTestRateLimitGuard } from "../mail-test-rate-limit.guard.js";

function logger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as PinoLoggerService;
}

function context(userId = "actor-1"): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: userId }, ip: "127.0.0.1" }),
    }),
  } as unknown as ExecutionContext;
}

describe("MailTestRateLimitGuard", () => {
  it("allows three probes per minute and rejects the fourth with 429", async () => {
    let count = 0;
    const redis = {
      incrementFixedWindow: vi.fn(async () => {
        count += 1;
        return { count, ttlSeconds: 60 };
      }),
    } as unknown as RedisService;
    const guard = new MailTestRateLimitGuard(redis, logger());

    await expect(guard.canActivate(context())).resolves.toBe(true);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    const error = await guard.canActivate(context()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: "MAIL_TEST_RATE_LIMITED",
    });
    expect(redis.incrementFixedWindow).toHaveBeenCalledTimes(4);
  });

  it("falls back to a process-local window when Redis is unavailable", async () => {
    const redis = {
      incrementFixedWindow: vi.fn().mockRejectedValue(new Error("redis down")),
    } as unknown as RedisService;
    const guard = new MailTestRateLimitGuard(redis, logger());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(guard.canActivate(context())).resolves.toBe(true);
    }
    const error = await guard.canActivate(context()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it("counts each admin separately", async () => {
    let count = 0;
    const redis = {
      incrementFixedWindow: vi.fn(async () => {
        count += 1;
        return { count, ttlSeconds: 60 };
      }),
    } as unknown as RedisService;
    const guard = new MailTestRateLimitGuard(redis, logger());

    // The Redis key includes the hashed actor id, so a different admin has its
    // own counter in a real deployment. Here the fake returns the same count;
    // assert the key differs instead.
    await guard.canActivate(context("actor-1"));
    await guard.canActivate(context("actor-2"));
    const keys = (redis.incrementFixedWindow as unknown as { mock: { calls: [string, number][] } }).mock
      .calls;
    expect(keys[0]?.[0]).not.toBe(keys[1]?.[0]);
  });
});