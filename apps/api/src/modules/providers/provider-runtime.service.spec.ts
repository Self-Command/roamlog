import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderGroup } from "@roamlog/contracts";

import type { PrismaService } from "../prisma/prisma.service.js";
import type { PinoLoggerService } from "../observability/pino-logger.service.js";
import type { RedisService } from "../redis/redis.service.js";
import type { SettingsService } from "../settings/settings.service.js";
import { ProviderProblemException } from "./provider-errors.js";
import {
  PROVIDER_RUNTIME_CACHE_TTL_MS,
  PROVIDER_RUNTIME_INVALIDATION_CHANNEL,
  ProviderRuntimeService,
  resolveProviderConfigMode,
} from "./provider-runtime.service.js";
import type { ProviderSecretService } from "./provider-secret.service.js";

interface RowOverrides {
  id?: string;
  group?: ProviderGroup;
  adapter?: string;
  preset?: string | null;
  label?: string;
  enabled?: boolean;
  priority?: number;
  config?: unknown;
  healthStatus?: string;
  cooldownUntil?: Date | null;
  lastCheckedAt?: Date | null;
  lastErrorCode?: string | null;
  createdAt?: Date;
  deletedAt?: Date | null;
}

function row(overrides: RowOverrides = {}) {
  return {
    id: "provider-a",
    group: "ai" as ProviderGroup,
    adapter: "openai-chat",
    preset: "openai",
    label: "Provider A",
    enabled: true,
    priority: 10,
    config: { baseUrl: "https://api.example/v1" },
    version: 1,
    healthStatus: "unknown",
    cooldownUntil: null,
    lastCheckedAt: null,
    lastErrorCode: null,
    createdAt: new Date("2026-11-22T00:00:00.000Z"),
    updatedAt: new Date("2026-11-22T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    group: "ai",
    routingMode: "priority",
    maxAttempts: 3,
    cooldownSeconds: 30,
    config: {},
    version: 4,
    updatedById: null,
    updatedAt: new Date("2026-11-22T00:00:00.000Z"),
    createdAt: new Date("2026-11-22T00:00:00.000Z"),
    ...overrides,
  };
}

function harness(
  options: {
    rows?: ReturnType<typeof row>[];
    policyRow?: ReturnType<typeof policy> | null;
    stored?: Record<string, unknown> | null;
  } = {},
) {
  const providerConnection = {
    findMany: vi.fn().mockResolvedValue(options.rows ?? [row()]),
  };
  const providerGroupPolicy = {
    findUnique: vi.fn().mockResolvedValue(options.policyRow ?? null),
  };
  const prisma = {
    client: { providerConnection, providerGroupPolicy },
  } as unknown as PrismaService;

  const secrets = {
    resolvePlaintext: vi.fn(async (providerId: string) => ({ apiKey: `key-${providerId}` })),
  } as unknown as ProviderSecretService;
  const settings = {
    getGroup: vi.fn().mockResolvedValue(options.stored ?? {}),
  } as unknown as SettingsService;

  const subscriber = Object.assign(new EventEmitter(), {
    status: "ready",
    subscribe: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  });
  const redis = {
    client: {
      publish: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue("OK"),
    },
    subscribeChannel: vi.fn(
      (channel: string, onMessage: (message: string) => void) => {
        subscriber.on("message", (received: string, message: string) => {
          if (received === channel) {
            onMessage(message);
          }
        });
        void subscriber.subscribe(channel);
        return {
          close: async () => {
            await subscriber.quit();
          },
        };
      },
    ),
  } as unknown as RedisService;

  const logger = {
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLoggerService;

  const service = new ProviderRuntimeService(prisma, secrets, settings, redis, logger);
  return {
    service,
    providerConnection,
    providerGroupPolicy,
    secrets,
    settings,
    redis,
    subscriber,
    logger,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ProviderRuntimeService", () => {
  it("resolves enabled providers by priority and skips cooldown/disabled rows", async () => {
    vi.stubEnv("PROVIDER_CONFIG_MODE", "v2");
    const { service, providerConnection, providerGroupPolicy, secrets } = harness({
      policyRow: policy(),
      rows: [
        row({
          id: "provider-b",
          priority: 20,
          config: { baseUrl: "https://b.example/v1" },
        }),
        row({
          id: "provider-a",
          priority: 10,
          config: { baseUrl: "https://a.example/v1" },
        }),
        row({ id: "disabled", enabled: false }),
        row({ id: "cooling", cooldownUntil: new Date(Date.now() + 60_000) }),
        row({ id: "invalid-config", config: {} }),
        row({ id: "invalid-adapter", adapter: "not-real" }),
      ],
    });

    const result = await service.resolveGroup("ai");

    expect(result.policy).toMatchObject({
      group: "ai",
      routingMode: "priority",
      maxAttempts: 3,
      cooldownSeconds: 30,
      version: 4,
    });
    expect(result.providers.map((provider) => provider.id)).toEqual(["provider-a", "provider-b"]);
    expect(result.providers[0]?.config).toMatchObject({
      baseUrl: "https://a.example/v1",
      timeoutMs: 60_000,
      maxOutputTokens: 4_096,
    });
    expect(result.providers[0]?.secrets).toEqual({ apiKey: "key-provider-a" });
    expect(secrets.resolvePlaintext).toHaveBeenCalledTimes(2);
    expect(providerConnection.findMany).toHaveBeenCalledWith({
      where: { group: "ai", deletedAt: null },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    expect(providerGroupPolicy.findUnique).toHaveBeenCalledWith({ where: { group: "ai" } });
  });

  it("does not hide a missing keyring behind an empty provider list", async () => {
    vi.stubEnv("PROVIDER_CONFIG_MODE", "v2");
    const { service, secrets } = harness();
    vi.mocked(secrets.resolvePlaintext).mockRejectedValueOnce(
      new ProviderProblemException("PROVIDER_SECRETS_UNAVAILABLE"),
    );

    await expect(service.resolveGroup("ai")).rejects.toMatchObject({
      code: "PROVIDER_SECRETS_UNAVAILABLE",
    });
  });

  it("caches a snapshot for five seconds and invalidates it locally", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
    vi.stubEnv("PROVIDER_CONFIG_MODE", "v2");
    const { service, providerConnection, redis } = harness();

    await service.resolveGroup("ai");
    await service.resolveGroup("ai");
    expect(providerConnection.findMany).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + PROVIDER_RUNTIME_CACHE_TTL_MS + 1);
    await service.resolveGroup("ai");
    expect(providerConnection.findMany).toHaveBeenCalledTimes(2);

    await service.invalidate("ai", 9);
    expect(redis.client.publish).toHaveBeenCalledWith(
      PROVIDER_RUNTIME_INVALIDATION_CHANNEL,
      JSON.stringify({ group: "ai", version: 9 }),
    );
    await service.resolveGroup("ai");
    expect(providerConnection.findMany).toHaveBeenCalledTimes(3);
  });

  it("clears its snapshot when another process publishes an invalidation", async () => {
    vi.stubEnv("PROVIDER_CONFIG_MODE", "v2");
    const { service, providerConnection, subscriber } = harness();

    await service.onModuleInit();
    expect(subscriber.subscribe).toHaveBeenCalledWith(PROVIDER_RUNTIME_INVALIDATION_CHANNEL);
    await service.resolveGroup("ai");
    expect(providerConnection.findMany).toHaveBeenCalledTimes(1);

    subscriber.emit(
      "message",
      PROVIDER_RUNTIME_INVALIDATION_CHANNEL,
      JSON.stringify({ group: "ai", version: 5 }),
    );
    await service.resolveGroup("ai");
    expect(providerConnection.findMany).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
    expect(subscriber.quit).toHaveBeenCalled();
  });

  it("builds one legacy AI provider from the existing settings source", async () => {
    vi.stubEnv("PROVIDER_CONFIG_MODE", "legacy");
    const { service, providerConnection } = harness({
      stored: {
        "ai.defaultProvider": "anthropic-messages",
        "ai.baseUrl": "https://legacy-ai.example/v1",
        "ai.apiKey": "legacy-secret",
        "ai.model": "legacy-model",
        "ai.timeoutMs": 30_000,
        "ai.maxOutputTokens": 2_048,
      },
    });

    const result = await service.resolveGroup("ai");

    expect(providerConnection.findMany).not.toHaveBeenCalled();
    expect(result.policy).toMatchObject({ routingMode: "priority", version: 1 });
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]).toMatchObject({
      id: "legacy:ai",
      adapter: "anthropic-messages",
      preset: "anthropic",
      priority: 10,
      config: {
        baseUrl: "https://legacy-ai.example/v1",
        defaultModel: "legacy-model",
        timeoutMs: 30_000,
        maxOutputTokens: 2_048,
      },
      secrets: { apiKey: "legacy-secret" },
    });
  });

  it("builds legacy map providers in sourceOrder with their own secrets", async () => {
    vi.stubEnv("PROVIDER_CONFIG_MODE", "legacy");
    vi.stubEnv("TENCENT_MAPS_KEY", "tencent-secret");
    vi.stubEnv("PLACES_SOURCES", "tencent,geoapify,photon");
    vi.stubEnv("PLACES_SOURCE_ORDER", "geoapify,tencent,photon");
    const { service } = harness({
      stored: {
        "places.provider": "geoapify",
        "places.apiKey": "geoapify-secret",
      },
    });

    const result = await service.resolveGroup("places");

    expect(result.policy).toMatchObject({ routingMode: "merge" });
    expect(result.providers.map((provider) => provider.adapter)).toEqual([
      "geoapify",
      "tencent",
      "photon",
    ]);
    expect(result.providers.map((provider) => provider.priority)).toEqual([10, 20, 30]);
    expect(result.providers[0]?.secrets).toEqual({ apiKey: "geoapify-secret" });
    expect(result.providers[1]?.secrets).toEqual({ apiKey: "tencent-secret" });
    expect(result.providers[2]?.secrets).toEqual({});
  });

  it("rejects an unknown configuration mode at the boundary", () => {
    expect(() => resolveProviderConfigMode({ PROVIDER_CONFIG_MODE: "round_robin" })).toThrow(
      /PROVIDER_CONFIG_MODE/,
    );
  });

  it("shadow mode compares v2 but keeps serving the legacy snapshot", async () => {
    vi.stubEnv("PROVIDER_CONFIG_MODE", "shadow");
    const { service, providerConnection, logger } = harness({
      stored: {
        "ai.defaultProvider": "openai-chat",
        "ai.baseUrl": "https://legacy-ai.example/v1",
        "ai.model": "legacy-model",
      },
      rows: [row({ id: "v2-provider", label: "V2 Provider" })],
    });

    const result = await service.resolveGroup("ai");

    expect(result.providers.map((provider) => provider.id)).toEqual(["legacy:ai"]);
    expect(providerConnection.findMany).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "provider.runtime.shadow_mismatch", group: "ai" }),
      "provider.runtime.shadow_mismatch",
    );
  });

  it("v2 never silently combines legacy settings or secrets", async () => {
    vi.stubEnv("PROVIDER_CONFIG_MODE", "v2");
    const { service, providerConnection, settings } = harness({
      stored: {
        "ai.baseUrl": "https://legacy-ai.example/v1",
        "ai.apiKey": "legacy-secret",
        "ai.model": "legacy-model",
      },
      rows: [],
    });

    const result = await service.resolveGroup("ai");

    expect(providerConnection.findMany).toHaveBeenCalledTimes(1);
    expect(settings.getGroup).not.toHaveBeenCalled();
    expect(result.providers).toEqual([]);
  });
});
