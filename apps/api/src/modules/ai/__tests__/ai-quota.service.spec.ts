import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AiPlanService } from "../ai-plan.service.js";
import { AiQuotaService } from "../ai-quota.service.js";
import { staticAiSettingsSource } from "../ai.settings.js";
import { AiToolbox } from "../ai-tools.js";
import {
  actorStub,
  aiSettings,
  fixedClock,
  loggerStub,
  membershipStub,
  runStoreStub,
  scriptedAdapter,
  toolServiceMocks,
  USER_ID,
} from "./ai-fixtures.js";

const NOW = new Date("2026-11-19T03:00:00.000Z");

function counterRedis() {
  const counts = new Map<string, number>();
  return {
    incrementFixedWindow: vi.fn(async (key: string) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { count, ttlSeconds: 3_600 };
    }),
  };
}

function toolbox(): AiToolbox {
  const tools = toolServiceMocks();
  return new AiToolbox(
    tools.places as never,
    tools.trips as never,
    tools.stops as never,
    tools.itinerary as never,
    tools.packing as never,
  );
}

describe("AiQuotaService", () => {
  it("allows the first plan and refuses the second when ai.dailyQuota is 1", async () => {
    const redis = counterRedis();
    const quota = new AiQuotaService(
      redis as never,
      loggerStub() as never,
      staticAiSettingsSource(aiSettings({ dailyQuota: 1 })),
    );

    await expect(quota.consume(USER_ID, NOW)).resolves.toMatchObject({
      allowed: true,
      limit: 1,
      remaining: 0,
    });
    await expect(quota.consume(USER_ID, NOW)).resolves.toMatchObject({
      allowed: false,
      limit: 1,
      remaining: 0,
    });
    expect(redis.incrementFixedWindow).toHaveBeenCalledTimes(2);
  });

  it("applies a changed quota on the next call instead of the boot snapshot", async () => {
    const redis = counterRedis();
    let limit = 5;
    const quota = new AiQuotaService(
      redis as never,
      loggerStub() as never,
      { resolve: async () => aiSettings({ dailyQuota: limit }) },
    );

    await quota.consume(USER_ID, NOW);
    limit = 0; // 0 disables the cap
    await expect(quota.consume(USER_ID, NOW)).resolves.toMatchObject({
      allowed: true,
      limit: 0,
      remaining: Number.MAX_SAFE_INTEGER,
    });
  });

  it("fails open when Redis is down and warns once per window", async () => {
    const redis = { incrementFixedWindow: vi.fn().mockRejectedValue(new Error("down")) };
    const logger = loggerStub();
    const quota = new AiQuotaService(
      redis as never,
      logger as never,
      staticAiSettingsSource(aiSettings({ dailyQuota: 1 })),
    );

    await expect(quota.consume(USER_ID, NOW)).resolves.toMatchObject({ allowed: true });
    await expect(quota.consume(USER_ID, NOW)).resolves.toMatchObject({ allowed: true });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[1]).toBe("ai.quota_fail_open");
  });

  it("turns the second plan into 429 AI_QUOTA at the endpoint behaviour level", async () => {
    const quota = new AiQuotaService(
      counterRedis() as never,
      loggerStub() as never,
      staticAiSettingsSource(aiSettings({ dailyQuota: 1 })),
    );
    const adapter = scriptedAdapter([{ text: "ok", toolCalls: [] }]);
    const service = new AiPlanService(
      staticAiSettingsSource(aiSettings({ dailyQuota: 1 })),
      () => adapter,
      toolbox(),
      quota,
      runStoreStub() as never,
      loggerStub() as never,
      fixedClock(),
    );

    await expect(
      service.chat(actorStub(), membershipStub(), { message: "Kyoto" }),
    ).resolves.toMatchObject({ provider: { protocol: "openai-chat" } });

    const error = await service
      .chat(actorStub(), membershipStub(), { message: "Kyoto again" })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(((error as HttpException).getResponse() as { code?: string }).code).toBe("AI_QUOTA");
    // The model was called exactly once: the refused run never reaches it.
    expect(adapter.inputs).toHaveLength(1);
  });
});