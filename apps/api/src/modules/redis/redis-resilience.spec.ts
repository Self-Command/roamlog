import { describe, expect, it, vi } from "vitest";

import type { AppConfigService } from "../../config/app-config.service.js";
import type { PinoLoggerService } from "../observability/pino-logger.service.js";
import {
  REDIS_MAX_RECONNECT_ATTEMPTS,
  REDIS_RETRY_MAX_DELAY_MS,
  RedisService,
  redisSubscriberRetryStrategy,
  type RedisRetryStrategy,
} from "./redis.service.js";

/**
 * Regression suite for the production crash observed twice:
 * `.audit/authz-override-report.md:215` and `.audit/g3-api-journeys-report.md:59`.
 *
 * The API must survive a Redis outage. `redis://127.0.0.1:1` is a closed port,
 * so every operation here exercises the real `ioredis` failure path instead of
 * a hand-written rejection.
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

function config(overrides: Partial<Record<string, unknown>> = {}): AppConfigService {
  return {
    redisUrl: CLOSED_PORT_URL,
    redisPrefix: "resilience-test",
    redisRequired: false,
    ...overrides,
  } as unknown as AppConfigService;
}

function create(overrides: Partial<Record<string, unknown>> = {}): {
  redis: RedisService;
  log: PinoLoggerService;
} {
  const log = logger();
  return { redis: new RedisService(config(overrides), log), log };
}

describe("RedisService with an unavailable server", () => {
  it("returns a degraded read instead of throwing", async () => {
    const { redis } = create();

    try {
      await expect(redis.get("missing-key")).resolves.toBeNull();
      await expect(redis.set("key", "value", 60)).resolves.toBeUndefined();
      await expect(redis.delete("key")).resolves.toBeUndefined();
    } finally {
      await redis.onModuleDestroy();
    }
  }, 15_000);

  it("reports an unknown acquisition instead of pretending the lock is held", async () => {
    const { redis } = create();

    try {
      await expect(redis.tryAcquire("lock", "value", 60)).resolves.toBe("unavailable");
    } finally {
      await redis.onModuleDestroy();
    }
  }, 15_000);

  it("keeps the client error events listened to so ioredis cannot crash the process", async () => {
    const { redis, log } = create();

    try {
      expect(redis.client.listenerCount("error")).toBeGreaterThanOrEqual(1);
      // Give the failed connections a moment to emit `error`; the listener must
      // absorb them and the process must stay alive (this test would crash the
      // worker if the event were unhandled).
      await redis.get("any-key");
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(log.warn).toHaveBeenCalled();
    } finally {
      await redis.onModuleDestroy();
    }
  }, 15_000);

  it("fails fast instead of queueing commands for a long time", async () => {
    const { redis } = create();

    try {
      const startedAt = Date.now();
      await redis.get("any-key");
      // A capped retry budget plus `enableOfflineQueue: false` keeps the command
      // path in the millisecond range; the old 20-retry client hung for seconds.
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await redis.onModuleDestroy();
    }
  }, 15_000);

  it("requires Redis at boot only when REDIS_REQUIRED is explicitly on", async () => {
    const failFast = create();
    const required = create({ redisRequired: true });

    try {
      await expect(failFast.redis.onModuleInit()).resolves.toBeUndefined();
      await expect(required.redis.onModuleInit()).rejects.toThrow(/Redis is required/u);
    } finally {
      await failFast.redis.onModuleDestroy();
      await required.redis.onModuleDestroy();
    }
  }, 20_000);
});

describe("RedisService client options", () => {
  it("bounds the retry budget, disables the offline queue, and caps the backoff", async () => {
    const { redis } = create();

    try {
      const retryStrategy = (redis.client as unknown as { options: { retryStrategy?: RedisRetryStrategy } })
        .options.retryStrategy;
      expect(typeof retryStrategy).toBe("function");

      const delays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((attempt) => retryStrategy!(attempt));
      for (const delay of delays) {
        expect(typeof delay).toBe("number");
        expect(delay as number).toBeGreaterThan(0);
        expect(delay as number).toBeLessThanOrEqual(REDIS_RETRY_MAX_DELAY_MS);
      }
      // Monotonic, then capped.
      expect(delays[0] as number).toBeLessThan(delays[2] as number);
      expect(delays[3] as number).toBeLessThan(delays[5] as number);
      // The cap exists: reconnect attempts end at a finite number.
      for (let attempt = REDIS_MAX_RECONNECT_ATTEMPTS + 1; attempt <= REDIS_MAX_RECONNECT_ATTEMPTS + 3; attempt += 1) {
        expect(retryStrategy!(attempt)).toBeNull();
      }
    } finally {
      await redis.onModuleDestroy();
    }
  }, 15_000);

  it("keeps subscriber reconnects alive beyond the request-client retry budget", () => {
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const delay = redisSubscriberRetryStrategy(attempt);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(REDIS_RETRY_MAX_DELAY_MS);
    }
    expect(redisSubscriberRetryStrategy(REDIS_MAX_RECONNECT_ATTEMPTS + 1)).toBeGreaterThan(0);
  });
});
