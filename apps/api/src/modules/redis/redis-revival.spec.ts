import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfigService } from "../../config/app-config.service.js";
import type { PinoLoggerService } from "../observability/pino-logger.service.js";
import { REDIS_REVIVAL_INTERVAL_MS, RedisService } from "./redis.service.js";

/**
 * The fast retry budget (10 attempts, ≈14s) is deliberately bounded. Without a
 * slow probe a Redis restart longer than that would leave the instance without
 * Redis until the next deployment, so a single 30s attempt re-opens the
 * connection. These tests drive the `end` event directly instead of waiting
 * ~14s for the real retry budget to run out.
 */
const CLOSED_PORT_URL = "redis://127.0.0.1:1";

function create(): RedisService {
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  } as unknown as PinoLoggerService;
  return new RedisService(
    {
      redisUrl: CLOSED_PORT_URL,
      redisPrefix: "revival-test",
      redisRequired: false,
    } as unknown as AppConfigService,
    logger,
  );
}

/** Put the client in the terminal `end` state ioredis reaches after the cap. */
function exhaust(redis: RedisService): void {
  redis.client.disconnect();
  (redis.client as unknown as { status: string }).status = "end";
  redis.client.emit("end");
}

describe("RedisService revival probe", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("probes the dead connection once per interval, not continuously", async () => {
    vi.useFakeTimers();
    const redis = create();
    exhaust(redis);
    const connect = vi.spyOn(redis.client, "connect").mockResolvedValue(redis.client as never);

    try {
      expect(connect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(REDIS_REVIVAL_INTERVAL_MS - 1);
      expect(connect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      await redis.onModuleDestroy();
    }
  });

  it("re-arms itself when the probe fails again", async () => {
    vi.useFakeTimers();
    const redis = create();
    exhaust(redis);
    const connect = vi
      .spyOn(redis.client, "connect")
      .mockRejectedValue(new Error("still down"));

    try {
      await vi.advanceTimersByTimeAsync(REDIS_REVIVAL_INTERVAL_MS);
      expect(connect).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(REDIS_REVIVAL_INTERVAL_MS);
      expect(connect).toHaveBeenCalledTimes(2);
    } finally {
      await redis.onModuleDestroy();
    }
  });

  it("stops probing after shutdown (no zombie sockets or timers)", async () => {
    vi.useFakeTimers();
    const redis = create();
    exhaust(redis);
    const connect = vi.spyOn(redis.client, "connect").mockResolvedValue(redis.client as never);

    await redis.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(REDIS_REVIVAL_INTERVAL_MS * 3);

    expect(connect).not.toHaveBeenCalled();
  });
});