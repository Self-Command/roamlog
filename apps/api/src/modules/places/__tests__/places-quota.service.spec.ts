import { describe, expect, it } from "vitest";

import { RedisService } from "../../redis/redis.service.js";
import { secondsUntilUtcMidnight, PlacesQuotaService } from "../places-quota.service.js";
import { asLogger, fakeRedis, makeLogger, testSettings, type FakeRedis } from "./place-fixtures.js";

function setup(options: { redis?: FakeRedis; dailyLimit?: number } = {}) {
  const redis = options.redis ?? fakeRedis();
  const settings = testSettings({
    provider: "geoapify",
    ...(options.dailyLimit === undefined ? {} : { geoapifyDailyLimit: options.dailyLimit }),
  });
  const logger = makeLogger();
  const quota = new PlacesQuotaService(
    redis as unknown as RedisService,
    asLogger(logger),
    settings,
  );
  return { quota, redis, logger };
}

describe("PlacesQuotaService", () => {
  it("allows requests while the counter is at or under the daily cap", async () => {
    const redis = fakeRedis();
    redis.incrementFixedWindow.mockResolvedValue({ count: 300, ttlSeconds: 3_600 });
    const { quota } = setup({ redis });

    await expect(quota.consume()).resolves.toEqual({
      allowed: true,
      limit: 3_000,
      remaining: 2_700,
    });
  });

  it("rejects and reports the remaining count once the cap is exceeded", async () => {
    const redis = fakeRedis();
    redis.incrementFixedWindow.mockResolvedValue({ count: 3_001, ttlSeconds: 3_600 });
    const { quota } = setup({ redis });

    await expect(quota.consume()).resolves.toEqual({
      allowed: false,
      limit: 3_000,
      remaining: 0,
    });
  });

  it("counts under a date-scoped Geoapify key with a UTC-midnight TTL", async () => {
    const { quota, redis } = setup();

    await quota.consume(new Date("2026-11-19T13:00:00.000Z"));

    const [key, ttl] = redis.incrementFixedWindow.mock.calls[0] as [string, number];
    expect(key).toBe("places:quota:geoapify:2026-11-19");
    expect(ttl).toBe(11 * 60 * 60);
  });

  it("computes seconds until UTC midnight and never returns zero", () => {
    expect(secondsUntilUtcMidnight(new Date("2026-11-19T23:59:30.000Z"))).toBe(30);
    expect(secondsUntilUtcMidnight(new Date("2026-11-19T00:00:00.000Z"))).toBe(86_400);
  });

  it("fails open when Redis is unavailable", async () => {
    const redis = fakeRedis();
    redis.incrementFixedWindow.mockRejectedValue(new Error("redis unavailable"));
    const { quota, logger } = setup({ redis });

    await expect(quota.consume()).resolves.toMatchObject({ allowed: true });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "places.quota_unavailable" }),
      "places.quota_fail_open",
    );
  });

  it("disables the cap without touching Redis when the limit is zero", async () => {
    const { quota, redis } = setup({ dailyLimit: 0 });

    await expect(quota.consume()).resolves.toMatchObject({ allowed: true });
    expect(redis.incrementFixedWindow).not.toHaveBeenCalled();
  });
});