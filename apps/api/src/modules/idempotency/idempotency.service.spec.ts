import { describe, expect, it, vi } from "vitest";

import { IDEMPOTENCY_TTL_SECONDS, IdempotencyService } from "./idempotency.service.js";
import type { PinoLoggerService } from "../observability/pino-logger.service.js";
import type { RedisService } from "../redis/redis.service.js";

class MemoryRedis {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.values.set(key, value);
    if (ttlSeconds !== undefined) {
      this.ttls.set(key, ttlSeconds);
    }
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.values.has(key)) {
      return false;
    }
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async tryAcquire(key: string, value: string, ttlSeconds: number): Promise<"acquired" | "taken" | "unavailable"> {
    return (await this.setIfAbsent(key, value, ttlSeconds)) ? "acquired" : "taken";
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.ttls.delete(key);
  }
}

function createLogger(): PinoLoggerService {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as PinoLoggerService;
}

describe("IdempotencyService", () => {
  it("stores results for 24 hours and replays a completed operation", async () => {
    const redis = new MemoryRedis();
    const service = new IdempotencyService(redis as unknown as RedisService, createLogger());
    const operation = vi.fn().mockResolvedValue({ accepted: true });

    await expect(service.run("invitations", "request-1", operation)).resolves.toEqual({
      accepted: true,
    });
    await expect(service.run("invitations", "request-1", operation)).resolves.toEqual({
      accepted: true,
    });

    expect(operation).toHaveBeenCalledOnce();
    expect(IDEMPOTENCY_TTL_SECONDS).toBe(86_400);
    expect([...redis.ttls.values()]).toEqual([IDEMPOTENCY_TTL_SECONDS]);
  });

  it("clears the in-progress marker after a failed operation", async () => {
    const redis = new MemoryRedis();
    const service = new IdempotencyService(redis as unknown as RedisService, createLogger());

    await expect(
      service.run("exports", "request-1", async () => {
        throw new Error("worker unavailable");
      }),
    ).rejects.toThrow("worker unavailable");

    await expect(service.run("exports", "request-1", async () => "retried")).resolves.toBe(
      "retried",
    );
  });

  it("runs the operation and warns when Redis cannot answer (fail-open, no 500)", async () => {
    const log = createLogger();
    // Shape of a Redis outage as seen by the service: reads return "nothing
    // stored" and the NX acquisition reports that it could not ask Redis.
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      tryAcquire: vi.fn().mockResolvedValue("unavailable"),
    };
    const service = new IdempotencyService(redis as unknown as RedisService, log);
    const operation = vi.fn().mockResolvedValue({ accepted: true });

    await expect(service.run("exports", "request-1", operation)).resolves.toEqual({
      accepted: true,
    });
    expect(operation).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "idempotency.redis_unavailable", policy: "fail-open" }),
      "idempotency.degraded",
    );
    // The degraded path never invents a conflict.
    expect(redis.tryAcquire).toHaveBeenCalledOnce();
  });
});
