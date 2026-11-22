import { describe, expect, it, vi } from "vitest";

import { AdminMutationError } from "./admin-api-error";
import { AdminSettingsError } from "./admin-settings-api";
import { createProviderSettingsApi } from "./provider-settings-api";

const PROVIDER_ID = "0199a0c1-1100-7000-8000-000000000001";
const NOW = "2026-11-22T12:00:00.000Z";

const provider = {
  id: PROVIDER_ID,
  group: "ai",
  adapter: "openai-chat",
  preset: "deepseek",
  label: "DeepSeek",
  enabled: true,
  priority: 10,
  config: { baseUrl: "https://api.deepseek.com/v1" },
  version: 3,
  secrets: [{ field: "apiKey", hasValue: true, last4: "cret", version: 2 }],
  health: {
    status: "healthy",
    lastCheckedAt: NOW,
    lastErrorCode: null,
    cooldownUntil: null,
  },
  createdAt: NOW,
  updatedAt: NOW,
};

const group = {
  group: "ai",
  label: "AI 服务",
  routingMode: "priority",
  maxAttempts: 3,
  cooldownSeconds: 30,
  version: 5,
  providers: [provider],
};

const catalog = {
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
          capabilities: ["model_discovery"],
          configFields: [],
          secretFields: [{ key: "apiKey", label: "API Key", required: true }],
          presets: [{ preset: "deepseek", label: "DeepSeek", defaultBaseUrl: null }],
        },
      ],
    },
  ],
};

const probe = {
  ok: true,
  providerId: PROVIDER_ID,
  testedAt: NOW,
  checks: [],
};

const discovery = {
  models: [
    {
      modelId: "deepseek-chat",
      displayName: "DeepSeek Chat",
      ownedBy: null,
      capabilities: {},
    },
  ],
  fetchedAt: NOW,
  manualEntryRequired: false,
};

const providerModel = {
  id: "0199a0c1-1100-7000-8000-000000000099",
  providerId: PROVIDER_ID,
  modelId: "deepseek-chat",
  displayName: "DeepSeek Chat",
  ownedBy: null,
  enabled: true,
  isDefault: true,
  capabilities: { vision: true, reasoning: true, tools: false },
  discoveredAt: NOW,
  updatedAt: NOW,
};

const secretState = { field: "apiKey", hasValue: true, last4: "cret", version: 4 };
const reveal = { field: "apiKey", value: "plaintext-only-in-response", expiresAt: null };

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof mockFetch>, index: number): unknown {
  const init = fetchMock.mock.calls[index]?.[1];
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

describe("provider settings API client", () => {
  it("loads the catalog and a group with same-origin credentials", async () => {
    const fetchMock = mockFetch(jsonResponse(catalog), jsonResponse(group));
    const api = createProviderSettingsApi(fetchMock);

    await expect(api.catalog()).resolves.toEqual(catalog);
    await expect(api.group("ai")).resolves.toEqual(group);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/admin/provider-catalog");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      credentials: "same-origin",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/admin/provider-groups/ai");
  });

  it("updates policy and reorders with the expected group version", async () => {
    const fetchMock = mockFetch(jsonResponse(group), jsonResponse(group));
    const api = createProviderSettingsApi(fetchMock);

    await api.updatePolicy("ai", {
      routingMode: "priority",
      maxAttempts: 3,
      cooldownSeconds: 30,
      expectedVersion: 5,
    });
    await api.reorder("ai", [PROVIDER_ID], 5);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/admin/provider-groups/ai");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
    expect(bodyOf(fetchMock, 0)).toEqual({
      routingMode: "priority",
      maxAttempts: 3,
      cooldownSeconds: 30,
      expectedVersion: 5,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/admin/provider-groups/ai/order");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(bodyOf(fetchMock, 1)).toEqual({
      ids: [PROVIDER_ID],
      expectedGroupVersion: 5,
    });
  });

  it("creates a provider with its initial secret in the POST body", async () => {
    const fetchMock = mockFetch(jsonResponse(provider, 201));
    const api = createProviderSettingsApi(fetchMock);

    await api.create({
      group: "ai",
      adapter: "openai-chat",
      preset: "deepseek",
      label: "DeepSeek",
      enabled: true,
      config: { baseUrl: "https://api.deepseek.com/v1" },
      secrets: { apiKey: "new-secret" },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/admin/providers");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(bodyOf(fetchMock, 0)).toMatchObject({
      secrets: { apiKey: "new-secret" },
      group: "ai",
      preset: "deepseek",
    });
  });

  it("keeps secrets out of PATCH and uses the dedicated secret PUT", async () => {
    const fetchMock = mockFetch(jsonResponse(provider), jsonResponse(secretState));
    const api = createProviderSettingsApi(fetchMock);

    await api.update(PROVIDER_ID, {
      label: "DeepSeek",
      config: { baseUrl: "https://api.deepseek.com/v1" },
      expectedVersion: 3,
    });
    await api.replaceSecret(PROVIDER_ID, "apiKey", {
      value: "new-secret",
      expectedVersion: 4,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/v1/admin/providers/${PROVIDER_ID}`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
    expect(bodyOf(fetchMock, 0)).not.toHaveProperty("secrets");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/v1/admin/providers/${PROVIDER_ID}/secrets/apiKey`);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(bodyOf(fetchMock, 1)).toEqual({ value: "new-secret", expectedVersion: 4 });
  });

  it("passes expectedVersion on delete, probe, and refresh", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ message: "Provider deleted." }),
      jsonResponse(probe),
      jsonResponse(discovery),
    );
    const api = createProviderSettingsApi(fetchMock);

    await api.remove(PROVIDER_ID, 3);
    await api.probe(PROVIDER_ID, 4);
    await api.refreshModels(PROVIDER_ID, 5);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/v1/admin/providers/${PROVIDER_ID}?expectedVersion=3`,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("DELETE");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/v1/admin/providers/${PROVIDER_ID}/probe?expectedVersion=4`,
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `/v1/admin/providers/${PROVIDER_ID}/models/refresh?expectedVersion=5`,
    );
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");
  });

  it("tests draft config, discovers models, and reveals a secret", async () => {
    const fetchMock = mockFetch(jsonResponse(probe), jsonResponse(discovery), jsonResponse(reveal));
    const api = createProviderSettingsApi(fetchMock);

    await api.probeDraft({
      group: "ai",
      adapter: "openai-chat",
      preset: "deepseek",
      config: { baseUrl: "https://api.deepseek.com/v1" },
      secrets: { apiKey: "draft-secret" },
    });
    await api.discoverModels({
      group: "ai",
      adapter: "openai-chat",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "draft-secret",
    });
    await api.revealSecret(PROVIDER_ID, "apiKey", true);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/admin/providers/probe");
    expect(bodyOf(fetchMock, 0)).toMatchObject({ secrets: { apiKey: "draft-secret" } });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/admin/provider-models/discover");
    expect(bodyOf(fetchMock, 1)).toMatchObject({ apiKey: "draft-secret" });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `/v1/admin/providers/${PROVIDER_ID}/secrets/apiKey/reveal`,
    );
    expect(bodyOf(fetchMock, 2)).toEqual({ confirm: true });
  });

  it("updates model capabilities with the provider version", async () => {
    const fetchMock = mockFetch(jsonResponse(providerModel));
    const api = createProviderSettingsApi(fetchMock);

    await api.updateModel(PROVIDER_ID, "deepseek-chat", {
      capabilities: { vision: true, reasoning: true, tools: false },
      expectedVersion: 4,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/v1/admin/providers/${PROVIDER_ID}/models/deepseek-chat`,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
    expect(bodyOf(fetchMock, 0)).toEqual({
      capabilities: { vision: true, reasoning: true, tools: false },
      expectedVersion: 4,
    });
  });

  it("preserves 409 field errors and policy codes", async () => {
    const fetchMock = mockFetch(
      jsonResponse(
        {
          type: "https://roamlog.app/errors/conflict",
          title: "Conflict",
          status: 409,
          detail: "The provider changed.",
          code: "PROVIDER_VERSION_CONFLICT",
          errors: [
            {
              field: "label",
              code: "PROVIDER_VERSION_CONFLICT",
              message: "Reload the provider before saving.",
            },
          ],
        },
        409,
      ),
    );
    const api = createProviderSettingsApi(fetchMock);

    const error = await api
      .update(PROVIDER_ID, { label: "Changed", expectedVersion: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminSettingsError);
    expect(error).toMatchObject({
      failure: { code: "PROVIDER_VERSION_CONFLICT", status: 409 },
      errorsByField: { label: "Reload the provider before saving." },
    });
  });

  it("rejects malformed success responses without accepting an invalid contract", async () => {
    const api = createProviderSettingsApi(mockFetch(jsonResponse({ providers: "wrong" })));

    const error = await api.group("ai").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminMutationError);
    expect(error).toMatchObject({
      name: "AdminMutationError",
      failure: { code: "ADMIN_RESPONSE_INVALID" },
    });
  });
});
