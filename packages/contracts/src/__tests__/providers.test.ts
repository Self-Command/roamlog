import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "../../scripts/generate-openapi";
import {
  CreateProviderRequestSchema,
  ProviderConnectionSchema,
  ProviderGroupResponseSchema,
  ProviderHealthSchema,
  UpdateProviderRequestSchema,
} from "../api/providers";

const PROVIDER_ID = "019c0a2e-7d4b-7d61-8d6a-5a7f6d8e9a01";

function connection() {
  return {
    id: PROVIDER_ID,
    group: "ai",
    adapter: "openai-chat",
    preset: "deepseek",
    label: "DeepSeek",
    enabled: true,
    priority: 10,
    config: {
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      timeoutMs: 30_000,
      maxOutputTokens: 8_192,
    },
    version: 2,
    secrets: [{ field: "apiKey", hasValue: true, last4: "a1b2", version: 1 }],
    health: {
      status: "healthy",
      lastCheckedAt: "2026-11-22T12:00:00.000Z",
      lastErrorCode: null,
      cooldownUntil: null,
    },
    createdAt: "2026-11-22T11:00:00.000Z",
    updatedAt: "2026-11-22T12:00:00.000Z",
  };
}

describe("provider contracts", () => {
  it("accepts a complete provider connection", () => {
    expect(ProviderConnectionSchema.parse(connection())).toMatchObject({
      group: "ai",
      preset: "deepseek",
      secrets: [{ field: "apiKey", hasValue: true, last4: "a1b2", version: 1 }],
    });
  });

  it("rejects unknown groups and unsupported routing modes", () => {
    expect(ProviderConnectionSchema.safeParse({ ...connection(), group: "llm" }).success).toBe(
      false,
    );

    const response = {
      group: "ai",
      label: "AI 服务",
      routingMode: "round_robin",
      maxAttempts: 3,
      cooldownSeconds: 30,
      version: 1,
      providers: [],
    };
    expect(ProviderGroupResponseSchema.safeParse(response).success).toBe(false);
  });

  it("uses the flat group response shape and rejects a nested policy object", () => {
    const response = {
      group: "ai",
      label: "AI 服务",
      routingMode: "priority",
      maxAttempts: 3,
      cooldownSeconds: 30,
      version: 1,
      providers: [connection()],
    };

    expect(ProviderGroupResponseSchema.parse(response)).toMatchObject({
      routingMode: "priority",
      providers: [{ id: PROVIDER_ID }],
    });
    expect(
      ProviderGroupResponseSchema.safeParse({
        ...response,
        policy: {
          group: "ai",
          routingMode: "priority",
          maxAttempts: 3,
          cooldownSeconds: 30,
          version: 1,
        },
      }).success,
    ).toBe(false);
  });

  it("accepts initial secrets only on create and never on ordinary PATCH", () => {
    expect(
      CreateProviderRequestSchema.parse({
        group: "ai",
        adapter: "openai-chat",
        preset: "deepseek",
        label: "DeepSeek",
        config: { baseUrl: "https://api.deepseek.com/v1" },
        secrets: { apiKey: "plaintext-only-in-this-request" },
      }),
    ).toMatchObject({
      secrets: { apiKey: "plaintext-only-in-this-request" },
    });

    expect(
      UpdateProviderRequestSchema.safeParse({
        label: "Renamed",
        expectedVersion: 2,
        secrets: { apiKey: "must-not-be-accepted" },
      }).success,
    ).toBe(false);
  });

  it("requires uuidv7 provider ids and a positive secret version", () => {
    expect(
      ProviderConnectionSchema.safeParse({
        ...connection(),
        id: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(false);
    expect(
      ProviderConnectionSchema.safeParse({
        ...connection(),
        secrets: [{ field: "apiKey", hasValue: true, last4: "a1b2" }],
      }).success,
    ).toBe(false);
  });

  it("does not invent a disabled health state", () => {
    expect(
      ProviderHealthSchema.safeParse({
        status: "disabled",
        lastCheckedAt: null,
        lastErrorCode: null,
        cooldownUntil: null,
      }).success,
    ).toBe(false);
  });

  it("publishes every provider operation in OpenAPI", () => {
    const document = buildOpenApiDocument() as unknown as {
      paths: Record<string, Record<string, unknown>>;
    };

    const expected = [
      ["get", "/v1/admin/provider-catalog"],
      ["get", "/v1/admin/provider-groups/{group}"],
      ["patch", "/v1/admin/provider-groups/{group}"],
      ["put", "/v1/admin/provider-groups/{group}/order"],
      ["post", "/v1/admin/providers"],
      ["patch", "/v1/admin/providers/{id}"],
      ["delete", "/v1/admin/providers/{id}"],
      ["post", "/v1/admin/providers/{id}/probe"],
      ["post", "/v1/admin/providers/probe"],
      ["post", "/v1/admin/provider-models/discover"],
      ["post", "/v1/admin/providers/{id}/models/refresh"],
      ["patch", "/v1/admin/providers/{id}/models/{modelId}"],
      ["put", "/v1/admin/providers/{id}/secrets/{field}"],
      ["post", "/v1/admin/providers/{id}/secrets/{field}/reveal"],
    ] as const;

    for (const [method, path] of expected) {
      expect(document.paths[path], `missing path ${path}`).toHaveProperty(method);
    }

    const model = document.paths["/v1/admin/providers/{id}/models/{modelId}"]?.patch as {
      operationId?: string;
    };
    expect(model.operationId).toBe("updateProviderModel");

    const operationIds: string[] = [];
    for (const item of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!["get", "post", "patch", "put", "delete"].includes(method)) continue;
        const value = operation as { operationId?: string };
        operationIds.push(value.operationId ?? `${method}:missing`);
      }
    }
    expect(operationIds).not.toContain("missing");
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
