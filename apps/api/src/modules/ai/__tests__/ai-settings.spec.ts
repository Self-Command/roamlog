import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AiSettingsResolver,
  DEFAULT_AI_PROTOCOL,
  resolveAiSettingsFromStored,
} from "../ai.settings.js";
import { loggerStub } from "./ai-fixtures.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  AI_BASE_URL: "http://127.0.0.1:3425/v1",
  AI_MODEL: "auto/deepseek-v4.1-flash",
  AI_PROTOCOL: "openai-chat",
  AI_TIMEOUT_MS: "30000",
  AI_MAX_OUTPUT_TOKENS: "2048",
  AI_DAILY_QUOTA: "5",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ai.* settings merge", () => {
  it("lets the stored values beat the environment", () => {
    const { settings } = resolveAiSettingsFromStored({
      env: BASE_ENV,
      stored: {
        "ai.defaultProvider": "anthropic-messages",
        "ai.timeoutMs": 15_000,
        "ai.maxOutputTokens": 1_234,
        "ai.dailyQuota": 2,
      },
    });

    expect(settings).toMatchObject({
      protocol: "anthropic-messages",
      timeoutMs: 15_000,
      maxOutputTokens: 1_234,
      dailyQuota: 2,
      // Credentials stay environment-only.
      baseUrl: "http://127.0.0.1:3425/v1",
      model: "auto/deepseek-v4.1-flash",
      configured: true,
    });
  });

  it("uses the environment for keys without a stored row", () => {
    const { settings, ignored } = resolveAiSettingsFromStored({
      env: BASE_ENV,
      stored: {},
    });

    expect(settings).toMatchObject({
      protocol: "openai-chat",
      timeoutMs: 30_000,
      maxOutputTokens: 2_048,
      dailyQuota: 5,
    });
    expect(ignored).toEqual([]);
  });

  it("enforces envLocked even when a caller hands over raw stored rows", () => {
    const { settings } = resolveAiSettingsFromStored({
      env: { ...BASE_ENV, AI_TIMEOUT_MS: "45000" },
      stored: { "ai.timeoutMs": 9_000, "ai.dailyQuota": 3 },
      envLockOf: (key) =>
        key === "ai.timeoutMs"
          ? { envLocked: true, envVar: "AI_TIMEOUT_MS" }
          : { envLocked: false },
    });

    expect(settings.timeoutMs).toBe(45_000);
    // Unlocked keys still prefer the database.
    expect(settings.dailyQuota).toBe(3);
  });

  it("ignores an unknown provider id and falls back to the environment protocol", () => {
    const { settings, ignored } = resolveAiSettingsFromStored({
      env: { ...BASE_ENV, AI_PROTOCOL: "openai-responses" },
      stored: { "ai.defaultProvider": "gemini-pro" },
    });

    expect(settings.protocol).toBe("openai-responses");
    expect(ignored).toEqual([{ key: "ai.defaultProvider", reason: "unsupported_value" }]);
  });

  it("ignores out-of-contract numbers instead of passing them to the adapter", () => {
    const { settings, ignored } = resolveAiSettingsFromStored({
      env: BASE_ENV,
      stored: { "ai.timeoutMs": 200, "ai.maxOutputTokens": 999_999, "ai.dailyQuota": -1 },
    });

    expect(settings).toMatchObject({
      timeoutMs: 30_000,
      maxOutputTokens: 2_048,
      dailyQuota: 5,
    });
    expect(ignored.map((entry) => entry.key)).toEqual([
      "ai.timeoutMs",
      "ai.maxOutputTokens",
      "ai.dailyQuota",
    ]);
  });

  it("keeps configured false without an upstream, without throwing", () => {
    const { settings } = resolveAiSettingsFromStored({ env: {}, stored: null });
    expect(settings).toMatchObject({
      protocol: DEFAULT_AI_PROTOCOL,
      baseUrl: null,
      model: "",
      configured: false,
    });
  });
});

describe("AiSettingsResolver", () => {
  function resolverWith(
    getGroup: () => Promise<Record<string, unknown>>,
    clock: () => Date = () => new Date("2026-11-19T00:00:00.000Z"),
  ) {
    const settings = { getGroup: vi.fn(getGroup) };
    const logger = loggerStub();
    const resolver = new AiSettingsResolver(settings as never, logger as never, clock);
    return { resolver, settings, logger };
  }

  it("reads the ai group on every request (no boot-time snapshot)", async () => {
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:3425/v1");
    vi.stubEnv("AI_MODEL", "auto/deepseek-v4.1-flash");
    const settings = { getGroup: vi.fn(async () => ({ "ai.dailyQuota": 1 })) };
    const logger = loggerStub();
    const source = new AiSettingsResolver(settings as never, logger as never, () => new Date());

    await expect(source.resolve()).resolves.toMatchObject({ dailyQuota: 1 });
    await expect(source.resolve()).resolves.toMatchObject({ dailyQuota: 1 });
    expect(settings.getGroup).toHaveBeenCalledTimes(2);
    expect(settings.getGroup).toHaveBeenCalledWith("ai");
  });

  it("falls back to the environment when the database is unavailable, with a throttled warn", async () => {
    vi.stubEnv("AI_PROTOCOL", "openai-chat");
    vi.stubEnv("AI_DAILY_QUOTA", "7");
    let now = Date.parse("2026-11-19T00:00:00.000Z");
    const { resolver, logger } = resolverWith(
      () => Promise.reject(new Error("db down")),
      () => new Date(now),
    );

    const first = await resolver.resolve();
    const second = await resolver.resolve();
    expect(first.dailyQuota).toBe(7);
    expect(second.dailyQuota).toBe(7);
    // One warning per 10 s window, not one per request.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[1]).toBe("ai.settings_fallback_env");

    now += 10_001;
    await resolver.resolve();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("warns once for a stored value the runtime cannot honour", async () => {
    vi.stubEnv("AI_PROTOCOL", "openai-chat");
    const { resolver, logger } = resolverWith(async () => ({
      "ai.defaultProvider": "unknown-provider",
    }));

    const resolved = await resolver.resolve();
    expect(resolved.protocol).toBe("openai-chat");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
      event: "ai.setting_value_ignored",
      key: "ai.defaultProvider",
      reason: "unsupported_value",
    });
  });
});