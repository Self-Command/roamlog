import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PinoLoggerService } from "../observability/pino-logger.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type {
  ProviderRuntime,
  ProviderRuntimeService,
} from "../providers/provider-runtime.service.js";
import { AiUpstreamError } from "./adapters/http.js";
import type { AiSettings } from "./ai.settings.js";
import { staticAiSettingsSource } from "./ai.settings.js";
import { AiProviderRouter } from "./ai-provider-router.service.js";

const PROVIDER_A = "0199a0c1-1100-7000-8000-000000000001";
const PROVIDER_B = "0199a0c1-1100-7000-8000-000000000002";

function settings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    protocol: "openai-chat",
    baseUrl: "https://legacy.example/v1",
    apiKey: "legacy-secret",
    model: "legacy-model",
    allowedModels: ["legacy-model"],
    timeoutMs: 60_000,
    maxOutputTokens: 4_096,
    dailyQuota: 20,
    vision: false,
    configured: true,
    ...overrides,
  };
}

function runtime(
  id: string,
  adapter: ProviderRuntime["adapter"],
  priority: number,
  config: Record<string, unknown>,
  apiKey = "provider-secret",
): ProviderRuntime {
  return {
    id,
    group: "ai",
    adapter,
    preset: adapter === "anthropic-messages" ? "anthropic" : "custom-openai-compatible",
    label: id,
    priority,
    config,
    secrets: { apiKey },
    health: {
      status: "healthy",
      lastCheckedAt: null,
      lastErrorCode: null,
      cooldownUntil: null,
    },
  };
}

function harness(input: {
  providers: ProviderRuntime[];
  models: Array<{
    providerId: string;
    modelId: string;
    displayName?: string;
    ownedBy?: string | null;
    enabled?: boolean;
    isDefault?: boolean;
    capabilities?: Record<string, boolean>;
  }>;
  legacy?: AiSettings;
}) {
  const resolveGroup = vi.fn(async () => ({
    policy: {
      group: "ai" as const,
      routingMode: "priority" as const,
      maxAttempts: 3,
      cooldownSeconds: 30,
      version: 1,
    },
    providers: input.providers,
  }));
  const findMany = vi.fn(async ({ where }: { where: { providerId: { in: string[] } } }) =>
    input.models
      .filter((model) => where.providerId.in.includes(model.providerId))
      .filter((model) => model.enabled !== false)
      .map((model) => ({
        providerId: model.providerId,
        modelId: model.modelId,
        displayName: model.displayName ?? model.modelId,
        ownedBy: model.ownedBy ?? null,
        enabled: model.enabled ?? true,
        isDefault: model.isDefault ?? false,
        capabilities: model.capabilities ?? {},
      })),
  );
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const router = new AiProviderRouter(
    { resolveGroup } as unknown as ProviderRuntimeService,
    { client: { providerModel: { findMany } } } as unknown as PrismaService,
    staticAiSettingsSource(input.legacy ?? settings()),
    logger as unknown as PinoLoggerService,
  );
  return { router, resolveGroup, findMany, logger };
}

describe("AiProviderRouter", () => {
  it("returns candidates in provider priority order with per-provider models", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
          timeoutMs: 12_000,
          maxOutputTokens: 2_048,
        }),
        runtime(PROVIDER_B, "anthropic-messages", 20, {
          baseUrl: "https://b.example/v1",
          defaultModel: "b-default",
        }),
      ],
      models: [
        {
          providerId: PROVIDER_A,
          modelId: "a-default",
          isDefault: true,
        },
        {
          providerId: PROVIDER_B,
          modelId: "b-default",
          isDefault: true,
          capabilities: { vision: true },
        },
      ],
    });

    const candidates = await router.candidates();

    expect(candidates.map((candidate) => candidate.settings.model)).toEqual([
      "a-default",
      "b-default",
    ]);
    expect(candidates[0]?.settings.apiKey).toBe("provider-secret");
    expect(candidates[0]?.settings.timeoutMs).toBe(12_000);
    expect(candidates[1]?.settings.protocol).toBe("anthropic-messages");
    expect(candidates[1]?.settings.vision).toBe(true);
  });

  it("routes an explicit model to every provider that offers it", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
        runtime(PROVIDER_B, "openai-chat", 20, {
          baseUrl: "https://b.example/v1",
          defaultModel: "b-default",
        }),
      ],
      models: [
        { providerId: PROVIDER_A, modelId: "shared-model", isDefault: false },
        { providerId: PROVIDER_B, modelId: "shared-model", isDefault: false },
      ],
    });

    const candidates = await router.candidates("shared-model");

    expect(candidates.map((candidate) => candidate.runtime.id)).toEqual([PROVIDER_A, PROVIDER_B]);
    expect(candidates.every((candidate) => candidate.settings.model === "shared-model")).toBe(true);
  });

  it("does not auto-select the first model when a provider has no default", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
        }),
      ],
      models: [
        { providerId: PROVIDER_A, modelId: "first-model", isDefault: false },
        { providerId: PROVIDER_A, modelId: "second-model", isDefault: false },
      ],
    });

    await expect(router.candidates()).rejects.toMatchObject({
      status: 503,
      response: { code: "AI_PROVIDERS_UNAVAILABLE" },
    });
  });

  it("rejects an unknown explicit model", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
      ],
      models: [{ providerId: PROVIDER_A, modelId: "a-default", isDefault: true }],
    });

    await expect(router.candidates("not-a-model")).rejects.toMatchObject({
      status: 400,
      response: { code: "AI_MODEL_NOT_ALLOWED" },
    });
  });

  it("keeps the union deduplicated in provider priority order", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
        runtime(PROVIDER_B, "anthropic-messages", 20, {
          baseUrl: "https://b.example/v1",
          defaultModel: "b-default",
        }),
      ],
      models: [
        { providerId: PROVIDER_A, modelId: "a-default", isDefault: true },
        { providerId: PROVIDER_B, modelId: "a-default", isDefault: false },
        { providerId: PROVIDER_B, modelId: "b-default", isDefault: true },
      ],
    });

    const models = await router.chatModels();

    expect(models.defaultModel).toBe("a-default");
    expect(models.models.map((model) => model.id)).toEqual(["a-default", "b-default"]);
    expect(models.reasoningSupported).toBe(true);
  });

  it("fails over after a network failure and logs no provider secret", async () => {
    const { router, logger } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
        runtime(PROVIDER_B, "openai-chat", 20, {
          baseUrl: "https://b.example/v1",
          defaultModel: "a-default",
        }),
      ],
      models: [
        { providerId: PROVIDER_A, modelId: "a-default", isDefault: true },
        { providerId: PROVIDER_B, modelId: "a-default", isDefault: true },
      ],
    });
    const candidates = await router.candidates();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new AiUpstreamError("network"))
      .mockResolvedValueOnce("ok");

    await expect(router.runWithFailover(candidates, attempt)).resolves.toBe("ok");

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("provider-secret");
  });

  it("does not fail over after an authentication error", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
        runtime(PROVIDER_B, "openai-chat", 20, {
          baseUrl: "https://b.example/v1",
          defaultModel: "a-default",
        }),
      ],
      models: [
        { providerId: PROVIDER_A, modelId: "a-default", isDefault: true },
        { providerId: PROVIDER_B, modelId: "a-default", isDefault: true },
      ],
    });
    const candidates = await router.candidates();
    const error = new AiUpstreamError("http", 401);
    const attempt = vi.fn().mockRejectedValueOnce(error);

    await expect(router.runWithFailover(candidates, attempt)).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries safe upstream failures including 429 and 5xx", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
        runtime(PROVIDER_B, "openai-chat", 20, {
          baseUrl: "https://b.example/v1",
          defaultModel: "a-default",
        }),
      ],
      models: [
        { providerId: PROVIDER_A, modelId: "a-default", isDefault: true },
        { providerId: PROVIDER_B, modelId: "a-default", isDefault: true },
      ],
    });
    const candidates = await router.candidates();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new AiUpstreamError("http", 429))
      .mockResolvedValueOnce("ok");

    await expect(router.runWithFailover(candidates, attempt)).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(router.isRetryable(new AiUpstreamError("http", 401))).toBe(false);
    expect(router.isRetryable(new HttpException({ code: "UPSTREAM" }, 503))).toBe(true);
    expect(router.isRetryable(new AiUpstreamError("timeout"))).toBe(true);
  });

  it("buffers meta/progress and fails over before the first committed stream event", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
        runtime(PROVIDER_B, "openai-chat", 20, {
          baseUrl: "https://b.example/v1",
          defaultModel: "a-default",
        }),
      ],
      models: [
        { providerId: PROVIDER_A, modelId: "a-default", isDefault: true },
        { providerId: PROVIDER_B, modelId: "a-default", isDefault: true },
      ],
    });
    const candidates = await router.candidates();
    const attempts: string[] = [];
    type TestEvent =
      | { type: "meta"; provider: string }
      | { type: "progress" }
      | { type: "text.delta"; delta: string };

    const stream = router.streamWithFailover<TestEvent, string>(
      candidates,
      async function* (candidate) {
        attempts.push(candidate.runtime.id);
        if (candidate.runtime.id === PROVIDER_A) {
          yield { type: "meta", provider: "a" };
          yield { type: "progress" };
          throw new AiUpstreamError("network");
        }
        yield { type: "meta", provider: "b" };
        yield { type: "text.delta", delta: "ok" };
        return "outcome-b";
      },
      (event) => event.type === "text.delta",
    );

    const events: TestEvent[] = [];
    let result: { candidate: { runtime: ProviderRuntime }; outcome: string } | undefined;
    for (;;) {
      const next = await stream.next();
      if (next.done) {
        result = next.value as typeof result;
        break;
      }
      events.push(next.value.event);
    }

    expect(attempts).toEqual([PROVIDER_A, PROVIDER_B]);
    expect(events).toEqual([
      { type: "meta", provider: "b" },
      { type: "text.delta", delta: "ok" },
    ]);
    expect(result?.candidate.runtime.id).toBe(PROVIDER_B);
    expect(result?.outcome).toBe("outcome-b");
  });

  it("never switches providers after a committed stream event", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
        runtime(PROVIDER_B, "openai-chat", 20, {
          baseUrl: "https://b.example/v1",
          defaultModel: "a-default",
        }),
      ],
      models: [
        { providerId: PROVIDER_A, modelId: "a-default", isDefault: true },
        { providerId: PROVIDER_B, modelId: "a-default", isDefault: true },
      ],
    });
    const candidates = await router.candidates();
    const attempts: string[] = [];
    type TestEvent = { type: "meta" } | { type: "text.delta"; delta: string };

    const stream = router.streamWithFailover<TestEvent, string>(
      candidates,
      async function* (candidate) {
        attempts.push(candidate.runtime.id);
        yield { type: "meta" };
        yield { type: "text.delta", delta: "first" };
        throw new AiUpstreamError("network");
      },
      (event) => event.type === "text.delta",
    );

    const events: TestEvent[] = [];
    await expect(
      (async () => {
        for (;;) {
          const next = await stream.next();
          if (next.done) {
            return next.value;
          }
          events.push(next.value.event);
        }
      })(),
    ).rejects.toBeInstanceOf(AiUpstreamError);

    expect(attempts).toEqual([PROVIDER_A]);
    expect(events).toEqual([{ type: "meta" }, { type: "text.delta", delta: "first" }]);
  });

  it("treats a clean attempt completion as committed even without a text delta", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
      ],
      models: [{ providerId: PROVIDER_A, modelId: "a-default", isDefault: true }],
    });
    const candidates = await router.candidates();
    type TestEvent = { type: "meta" } | { type: "progress" };
    const stream = router.streamWithFailover<TestEvent, string>(
      candidates,
      async function* () {
        yield { type: "meta" };
        yield { type: "progress" };
        return "empty-success";
      },
      () => false,
    );

    const events: TestEvent[] = [];
    let outcome: string | undefined;
    for (;;) {
      const next = await stream.next();
      if (next.done) {
        outcome = next.value.outcome;
        break;
      }
      events.push(next.value.event);
    }

    expect(events).toEqual([{ type: "meta" }, { type: "progress" }]);
    expect(outcome).toBe("empty-success");
  });

  it("stops queued failover when the request is aborted", async () => {
    const { router } = harness({
      providers: [
        runtime(PROVIDER_A, "openai-chat", 10, {
          baseUrl: "https://a.example/v1",
          defaultModel: "a-default",
        }),
        runtime(PROVIDER_B, "openai-chat", 20, {
          baseUrl: "https://b.example/v1",
          defaultModel: "a-default",
        }),
      ],
      models: [
        { providerId: PROVIDER_A, modelId: "a-default", isDefault: true },
        { providerId: PROVIDER_B, modelId: "a-default", isDefault: true },
      ],
    });
    const candidates = await router.candidates();
    const controller = new AbortController();
    const attempts: string[] = [];

    const stream = router.streamWithFailover<{ type: "meta" }, string>(
      candidates,
      async function* (candidate) {
        attempts.push(candidate.runtime.id);
        controller.abort();
        yield { type: "meta" };
        throw new AiUpstreamError("network");
      },
      () => false,
      { signal: controller.signal },
    );

    await expect(stream.next()).rejects.toBeInstanceOf(DOMException);
    expect(attempts).toEqual([PROVIDER_A]);
  });
});
