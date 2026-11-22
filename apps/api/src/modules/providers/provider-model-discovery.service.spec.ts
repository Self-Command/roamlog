import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import type { AppConfigService } from "../../config/app-config.service.js";
import type { AuditService } from "../audit/audit.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { ProviderEgressGuard } from "./provider-egress.js";
import { ProviderModelDiscoveryService } from "./provider-model-discovery.service.js";
import { ProviderProblemException } from "./provider-errors.js";
import type { ProviderSecretService } from "./provider-secret.service.js";

const ACTOR = {
  user: { id: "0199a0c1-1100-7000-8000-000000000001" },
  ip: "127.0.0.1",
  userAgent: "vitest",
} as unknown as AuthenticatedActor;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function providerRow() {
  return {
    id: "0199a0c1-1100-7000-8000-000000000010",
    group: "ai",
    adapter: "openai-chat",
    preset: "openai",
    config: {
      baseUrl: "https://api.example.com/v1",
      timeoutMs: 60_000,
      maxOutputTokens: 4_096,
    },
    version: 1,
    deletedAt: null,
  };
}

function harness(
  existingModels: Array<{ modelId: string; isDefault: boolean; capabilities?: unknown }> = [],
) {
  const row = providerRow();
  const transaction = {
    providerModel: {
      upsert: vi.fn(async () => ({})),
    },
    providerConnection: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const prisma = {
    client: {
      providerConnection: {
        findUnique: vi.fn(async () => row),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      providerModel: {
        findMany: vi.fn(async () => existingModels),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    },
  } as unknown as PrismaService;
  const secrets = {
    resolvePlaintext: vi.fn(async () => ({ apiKey: "saved-key" })),
  } as unknown as ProviderSecretService;
  const egress = {
    assertAllowed: vi.fn(async () => undefined),
  } as unknown as ProviderEgressGuard;
  const audit = {
    record: vi.fn(async () => ({ id: "audit-1" })),
  } as unknown as AuditService;
  const service = new ProviderModelDiscoveryService(prisma, secrets, egress, audit);
  return { service, prisma, secrets, egress, audit, transaction, row };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.PROVIDER_EGRESS_ALLOW_PRIVATE;
});

describe("ProviderModelDiscoveryService", () => {
  it("discovers an OpenAI-compatible catalog and never auto-selects a model", async () => {
    const { service, egress } = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init?: RequestInit) => {
        expect(url.toString()).toBe("https://api.example.com/v1/models");
        expect(init?.redirect).toBe("error");
        expect(init?.headers).toMatchObject({ authorization: "Bearer draft-key" });
        return jsonResponse({
          data: [{ id: "gpt-4o", display_name: "GPT-4o", owned_by: "openai" }, { id: "gpt-4o" }],
        });
      }),
    );

    const result = await service.discoverDraft(ACTOR, {
      group: "ai",
      adapter: "openai-chat",
      preset: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "draft-key",
    });

    expect(result.models).toEqual([
      {
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        ownedBy: "openai",
        capabilities: {},
      },
    ]);
    expect(result.manualEntryRequired).toBe(false);
    expect(egress.assertAllowed).toHaveBeenCalledTimes(1);
  });

  it("uses Anthropic authentication headers", async () => {
    const { service } = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          "x-api-key": "sk-ant",
          "anthropic-version": "2023-06-01",
        });
        return jsonResponse({
          data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }],
        });
      }),
    );

    const result = await service.discoverDraft(ACTOR, {
      group: "ai",
      adapter: "anthropic-messages",
      preset: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant",
    });

    expect(result.models[0]?.modelId).toBe("claude-sonnet-4");
  });

  it("returns manual entry for an empty catalog", async () => {
    const { service } = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [] })),
    );

    const result = await service.discoverDraft(ACTOR, {
      group: "ai",
      adapter: "openai-chat",
      preset: "custom-openai-compatible",
      baseUrl: "https://gateway.example/v1",
      apiKey: "draft-key",
    });

    expect(result.models).toEqual([]);
    expect(result.manualEntryRequired).toBe(true);
  });

  it.each([
    [401, "PROVIDER_MODELS_DISCOVERY_FAILED"],
    [404, "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED"],
    [429, "PROVIDER_LIMIT_REACHED"],
    [500, "PROVIDER_MODELS_DISCOVERY_FAILED"],
  ])("maps HTTP %s to %s without exposing upstream details", async (status, code) => {
    const { service } = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "upstream body with https://api.example.com?key=secret" },
          { status },
        ),
      ),
    );

    const error = await service
      .discoverDraft(ACTOR, {
        group: "ai",
        adapter: "openai-chat",
        preset: "openai",
        baseUrl: "https://api.example.com/v1",
        apiKey: "draft-key",
      })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toMatch(/secret|api\.example\.com/);
  });

  it("rejects a catalog larger than the streamed cap", async () => {
    const { service } = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x".repeat(1_048_577), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": "1048577",
            },
          }),
      ),
    );

    await expect(
      service.discoverDraft(ACTOR, {
        group: "ai",
        adapter: "openai-chat",
        preset: "openai",
        baseUrl: "https://api.example.com/v1",
        apiKey: "draft-key",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_MODELS_RESPONSE_TOO_LARGE" });
  });

  it("maps an aborted request to the stable timeout code", async () => {
    vi.useFakeTimers();
    const { service } = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      ),
    );

    const pending = service.discoverDraft(ACTOR, {
      group: "ai",
      adapter: "openai-chat",
      preset: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "draft-key",
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "PROVIDER_MODELS_DISCOVERY_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("uses saved secrets, persists the catalog, and keeps no automatic default", async () => {
    const { service, secrets, transaction, audit } = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({ authorization: "Bearer saved-key" });
        return jsonResponse({ data: [{ id: "saved-model", owned_by: "gateway" }] });
      }),
    );

    const result = await service.refreshSaved(ACTOR, "0199a0c1-1100-7000-8000-000000000010");

    expect(secrets.resolvePlaintext).toHaveBeenCalledWith("0199a0c1-1100-7000-8000-000000000010");
    expect(result.models[0]?.modelId).toBe("saved-model");
    expect(transaction.providerModel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.not.objectContaining({ isDefault: true }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.provider.models_refreshed" }),
      transaction,
    );
  });

  it("returns stored capability state when refreshing a saved catalog", async () => {
    const { service } = harness([
      {
        modelId: "saved-model",
        isDefault: false,
        capabilities: { vision: true, reasoning: false, tools: true },
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ id: "saved-model" }] })),
    );

    const result = await service.refreshSaved(ACTOR, "0199a0c1-1100-7000-8000-000000000010");

    expect(result.models[0]?.capabilities).toEqual({
      vision: true,
      reasoning: false,
      tools: true,
    });
  });

  it("keeps the previous default visible as a required decision when it disappears", async () => {
    const { service, transaction } = harness([{ modelId: "retired-model", isDefault: true }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ id: "replacement-model" }] })),
    );

    await expect(
      service.refreshSaved(ACTOR, "0199a0c1-1100-7000-8000-000000000010"),
    ).rejects.toMatchObject({ code: "PROVIDER_MODEL_DEFAULT_REQUIRED" });
    expect(transaction.providerModel.upsert).not.toHaveBeenCalled();
    expect(transaction.providerConnection.updateMany).not.toHaveBeenCalled();
  });

  it("marks a saved provider degraded while preserving the previous catalog on failure", async () => {
    const { service, prisma } = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, { status: 503 })),
    );

    await expect(
      service.refreshSaved(ACTOR, "0199a0c1-1100-7000-8000-000000000010"),
    ).rejects.toBeInstanceOf(ProviderProblemException);
    expect(prisma.client.providerModel.findMany).not.toHaveBeenCalled();
    expect(prisma.client.providerConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: "PROVIDER_MODELS_DISCOVERY_FAILED",
          healthStatus: "degraded",
        }),
      }),
    );
  });

  it("rejects manual-only providers", async () => {
    const placesHarness = harness();
    placesHarness.row.group = "places";
    placesHarness.row.adapter = "tencent";
    placesHarness.row.preset = "tencent";
    placesHarness.row.config = {
      baseUrl: "https://apis.map.qq.com/ws",
      timeoutMs: 2000,
      maxOutputTokens: 4096,
    };
    await expect(
      placesHarness.service.refreshSaved(ACTOR, "0199a0c1-1100-7000-8000-000000000010"),
    ).rejects.toMatchObject({ code: "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED" });
  });
});

describe("ProviderEgressGuard", () => {
  const config = { nodeEnv: "test", appEnv: "test" } as AppConfigService;
  const guard = new ProviderEgressGuard(config);

  it("allows a public DNS target", async () => {
    await expect(
      guard.assertAllowed(new URL("https://api.example.com/v1/models"), {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    "http://127.0.0.1/models",
    "http://10.0.0.8/models",
    "http://172.16.0.8/models",
    "http://192.168.1.8/models",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/models",
    "http://[fd00::1]/models",
    "http://metadata.google.internal/models",
  ])("blocks a private or metadata target: %s", async (value) => {
    await expect(
      guard.assertAllowed(new URL(value), {
        resolve: async () => [{ address: "10.0.0.8", family: 4 }],
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_EGRESS_BLOCKED" });
  });

  it("blocks a public hostname that resolves to a private address", async () => {
    await expect(
      guard.assertAllowed(new URL("https://gateway.example/v1/models"), {
        resolve: async () => [{ address: "10.0.0.8", family: 4 }],
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_EGRESS_BLOCKED" });
  });

  it("blocks credentials and query strings before DNS", async () => {
    const resolve = vi.fn();
    await expect(
      guard.assertAllowed(new URL("https://user:pass@example.com/v1/models"), { resolve }),
    ).rejects.toMatchObject({ code: "PROVIDER_EGRESS_BLOCKED" });
    await expect(
      guard.assertAllowed(new URL("https://example.com/v1/models?key=secret"), { resolve }),
    ).rejects.toMatchObject({ code: "PROVIDER_EGRESS_BLOCKED" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("allows explicit private endpoints only outside production", async () => {
    process.env.PROVIDER_EGRESS_ALLOW_PRIVATE = "true";
    await expect(
      guard.assertAllowed(new URL("http://127.0.0.1:8080/v1/models")),
    ).resolves.toBeUndefined();

    const production = new ProviderEgressGuard({
      nodeEnv: "production",
      appEnv: "production",
    } as AppConfigService);
    await expect(
      production.assertAllowed(new URL("http://127.0.0.1:8080/v1/models")),
    ).rejects.toMatchObject({ code: "PROVIDER_EGRESS_BLOCKED" });
  });
});
