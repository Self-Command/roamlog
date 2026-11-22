import { describe, expect, it } from "vitest";

import type { ProviderCatalog, ProviderConnection } from "@roamlog/contracts";

import { AdminMutationError } from "./admin-api-error";
import type { ProviderUpdateInput } from "./provider-settings-api";
import {
  providerAdapterLabel,
  providerDraftPayload,
  providerMutationErrorMessage,
  providerOrderIds,
  providerPresetLabel,
  providerSecretLabel,
  providerStatusLabel,
} from "./provider-settings";

const catalog: ProviderCatalog = {
  version: 1,
  groups: [
    {
      group: "ai",
      label: "AI 服务",
      routingModes: ["priority"],
      adapters: [
        {
          adapter: "openai-chat",
          label: "OpenAI Chat Completions",
          capabilities: ["model_discovery", "probe", "priority"],
          configFields: [],
          secretFields: [{ key: "apiKey", label: "API Key", required: true }],
          presets: [
            {
              preset: "deepseek",
              label: "DeepSeek",
              defaultBaseUrl: "https://api.deepseek.com/v1",
            },
            {
              preset: "openrouter",
              label: "OpenRouter",
              defaultBaseUrl: "https://openrouter.ai/api/v1",
            },
          ],
        },
      ],
    },
    {
      group: "places",
      label: "地图服务",
      routingModes: ["merge", "priority_failover"],
      adapters: [
        {
          adapter: "tencent",
          label: "腾讯位置服务",
          capabilities: ["probe", "priority", "merge"],
          configFields: [],
          secretFields: [{ key: "apiKey", label: "API Key", required: true }],
          presets: [
            {
              preset: "tencent",
              label: "腾讯地图",
              defaultBaseUrl: "https://apis.map.qq.com/ws",
            },
          ],
        },
      ],
    },
  ],
};

function provider(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: "0199b0c1-2200-7000-8000-000000000001",
    group: "ai",
    adapter: "openai-chat",
    preset: "deepseek",
    label: "DeepSeek",
    enabled: true,
    priority: 10,
    config: { baseUrl: "https://api.deepseek.com/v1" },
    version: 2,
    secrets: [
      {
        field: "apiKey",
        hasValue: true,
        last4: "9xQ2",
        version: 1,
      },
    ],
    health: {
      status: "healthy",
      lastCheckedAt: "2026-11-22T12:00:00.000Z",
      lastErrorCode: null,
      cooldownUntil: null,
    },
    createdAt: "2026-11-22T11:00:00.000Z",
    updatedAt: "2026-11-22T12:00:00.000Z",
    ...overrides,
  };
}

describe("provider settings helpers", () => {
  it("resolves preset, adapter, status and secret labels from the catalog", () => {
    const row = provider();

    expect(providerPresetLabel(row, catalog)).toBe("DeepSeek");
    expect(providerAdapterLabel(row, catalog)).toBe("OpenAI Chat Completions");
    expect(providerStatusLabel(row)).toBe("正常");
    expect(providerSecretLabel(row)).toBe("••••9xQ2");
  });

  it("falls back deterministically for unknown ids and disabled providers", () => {
    expect(
      providerPresetLabel(
        provider({ preset: "future-preset", adapter: "future-adapter" }),
        catalog,
      ),
    ).toBe("future-adapter");
    expect(providerAdapterLabel(provider({ adapter: "future-adapter" }), catalog)).toBe(
      "future-adapter",
    );
    expect(providerStatusLabel(provider({ enabled: false }))).toBe("已停用");
    expect(
      providerStatusLabel(provider({ health: { ...provider().health, status: "unhealthy" } })),
    ).toBe("异常");
  });

  it("masks the selected secret and handles missing or unspecified fields", () => {
    const row = provider({
      secrets: [
        { field: "apiKey", hasValue: true, last4: "1234", version: 1 },
        { field: "secondaryKey", hasValue: true, last4: null, version: 1 },
      ],
    });

    expect(providerSecretLabel(row, "secondaryKey")).toBe("已设置");
    expect(providerSecretLabel(row, "missing")).toBe("未设置");
    expect(providerSecretLabel(provider({ secrets: [] }))).toBe("未设置");
  });

  it("orders provider ids by priority with stable tie-breaks", () => {
    expect(
      providerOrderIds([
        provider({
          id: "0199b0c1-2200-7000-8000-000000000003",
          priority: 30,
          createdAt: "2026-11-22T13:00:00.000Z",
        }),
        provider({
          id: "0199b0c1-2200-7000-8000-000000000002",
          priority: 10,
          createdAt: "2026-11-22T12:00:00.000Z",
        }),
        provider({
          id: "0199b0c1-2200-7000-8000-000000000001",
          priority: 10,
          createdAt: "2026-11-22T11:00:00.000Z",
        }),
      ]),
    ).toEqual([
      "0199b0c1-2200-7000-8000-000000000001",
      "0199b0c1-2200-7000-8000-000000000002",
      "0199b0c1-2200-7000-8000-000000000003",
    ]);
  });

  it("removes secret drafts without losing the optimistic version", () => {
    const input = {
      adapter: "openai-chat",
      preset: "deepseek",
      label: "DeepSeek",
      enabled: true,
      priority: 20,
      config: { baseUrl: "https://api.deepseek.com/v1" },
      expectedVersion: 7,
      secrets: { apiKey: "must-not-leak" },
    } satisfies ProviderUpdateInput & { secrets: Record<string, string> };

    const payload = providerDraftPayload(input);

    expect(payload).toEqual({
      adapter: "openai-chat",
      preset: "deepseek",
      label: "DeepSeek",
      enabled: true,
      priority: 20,
      config: { baseUrl: "https://api.deepseek.com/v1" },
      expectedVersion: 7,
    });
    expect(payload).not.toHaveProperty("secrets");
    expect(input.secrets).toEqual({ apiKey: "must-not-leak" });
  });

  it("maps keyring, secret-service, version, order and active conflicts to actionable copy", () => {
    const failure = (code: string, status = 409) =>
      new AdminMutationError({
        code,
        status,
        title: "Request failed",
        detail: "server detail",
        degraded: [],
      });

    expect(providerMutationErrorMessage(failure("SETTINGS_ENCRYPTION_UNAVAILABLE", 503))).toContain(
      "密钥存储",
    );
    expect(providerMutationErrorMessage(failure("PROVIDER_SECRETS_UNAVAILABLE", 503))).toContain(
      "密钥服务",
    );
    expect(providerMutationErrorMessage(failure("PROVIDER_VERSION_CONFLICT"))).toContain(
      "最新版本",
    );
    expect(providerMutationErrorMessage(failure("PROVIDER_ORDER_CONFLICT"))).toContain("顺序");
    expect(providerMutationErrorMessage(failure("PROVIDER_ACTIVE_CONFLICT"))).toContain("停用");
    expect(providerMutationErrorMessage(new Error("network down"))).toContain("无法连接");
  });
});
