import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  ProviderCatalogSchema,
  type ProviderCatalog,
  type ProviderGroup,
} from "@roamlog/contracts";

import {
  PROVIDER_CATALOG_VERSION,
  parseProviderConfig,
  providerAdapterDefinition,
  providerCatalogResponse,
  providerPresetDefinition,
  requireProviderAdapter,
} from "./provider-catalog.js";
import { ProviderProblemException, safeProviderProblem } from "./provider-errors.js";

const AI_PRESETS = [
  ["openai", "openai-chat"],
  ["deepseek", "openai-chat"],
  ["openrouter", "openai-chat"],
  ["groq", "openai-chat"],
  ["together", "openai-chat"],
  ["gemini-openai", "openai-chat"],
  ["custom-openai-compatible", "openai-chat"],
  ["anthropic", "anthropic-messages"],
  ["openai-responses", "openai-responses"],
] as const;

describe("provider catalog", () => {
  it("freezes every AI vendor preset on its wire adapter", () => {
    for (const [preset, adapter] of AI_PRESETS) {
      const definition = providerPresetDefinition(adapter, preset);
      expect(definition, `${adapter}/${preset}`).toMatchObject({
        preset,
        adapter,
      });
      expect(definition?.label.length).toBeGreaterThan(0);
      expect(
        definition?.defaultBaseUrl === null || definition?.defaultBaseUrl?.startsWith("https://"),
      ).toBe(true);
    }
  });

  it("rejects a preset that belongs to another adapter or does not exist", () => {
    expect(() => providerPresetDefinition("anthropic-messages", "openai")).toThrow(
      ProviderProblemException,
    );
    expect(() => requireProviderAdapter("not-a-provider")).toThrow(ProviderProblemException);
  });

  it("uses the two supported model discovery strategies and keeps manual fallback honest", () => {
    expect(providerPresetDefinition("openai-chat", "openai")?.modelDiscovery).toBe("openai-models");
    expect(providerPresetDefinition("anthropic-messages", "anthropic")?.modelDiscovery).toBe(
      "anthropic-models",
    );
    expect(providerPresetDefinition("openai-chat", "custom-openai-compatible")).toMatchObject({
      modelDiscovery: "openai-models",
      manualModelAllowed: true,
    });
  });

  it("validates adapter config and rejects unknown fields", () => {
    expect(
      parseProviderConfig("openai-chat", {
        baseUrl: "https://api.openai.com/v1",
      }),
    ).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 60_000,
      maxOutputTokens: 4_096,
    });

    expect(() =>
      parseProviderConfig("openai-chat", {
        baseUrl: "https://api.openai.com/v1",
        unexpected: true,
      }),
    ).toThrow(ProviderProblemException);
  });

  it("requires map keys only for Tencent and Geoapify", () => {
    expect(
      providerAdapterDefinition("tencent")?.secretFields.find((field) => field.key === "apiKey"),
    ).toMatchObject({ required: true });
    expect(
      providerAdapterDefinition("geoapify")?.secretFields.find((field) => field.key === "apiKey"),
    ).toMatchObject({ required: true });
    expect(providerAdapterDefinition("photon")?.secretFields).toEqual([]);
  });

  it("keeps the legacy display-name sender syntax valid for mail providers", () => {
    expect(
      parseProviderConfig("resend", {
        from: "Roamlog <no-reply@example.com>",
      }),
    ).toMatchObject({ from: "Roamlog <no-reply@example.com>" });
    expect(
      parseProviderConfig("smtp", {
        from: "Roamlog <no-reply@example.com>",
        host: "smtp.example.com",
      }),
    ).toMatchObject({ from: "Roamlog <no-reply@example.com>" });
  });

  it("returns a catalog covering all groups with immutable copies", () => {
    const catalog = providerCatalogResponse();
    expect(() => ProviderCatalogSchema.parse(catalog)).not.toThrow();
    expect(catalog.version).toBe(PROVIDER_CATALOG_VERSION);
    expect(catalog.groups.map((group) => group.group)).toEqual(["ai", "places", "mail", "storage"]);
    expect(catalog.groups.find((group) => group.group === "ai")?.adapters).toHaveLength(3);
    expect(catalog.groups.find((group) => group.group === "places")?.adapters).toHaveLength(3);
    expect(
      catalog.groups.find((group) => group.group === "mail")?.adapters.map((a) => a.adapter),
    ).toEqual(["resend", "smtp"]);
    expect(
      catalog.groups.find((group) => group.group === "storage")?.adapters.map((a) => a.adapter),
    ).toEqual(["s3"]);

    catalog.groups[0]!.label = "mutated";
    expect(providerCatalogResponse().groups[0]!.label).not.toBe("mutated");
  });

  it("maps arbitrary internal failures to a stable, non-leaking problem", () => {
    const internal = new Error(
      "request failed for https://provider.example/v1?apiKey=super-secret token=abc",
    );
    expect(safeProviderProblem(internal, "PROVIDER_PROBE_FAILED")).toEqual({
      code: "PROVIDER_PROBE_FAILED",
      message: "The provider request failed.",
    });

    const known = new ProviderProblemException("PROVIDER_CONFIG_INVALID");
    expect(known.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(known.getResponse()).toMatchObject({
      code: "PROVIDER_CONFIG_INVALID",
      message: "The provider configuration is invalid.",
    });
    expect(safeProviderProblem(known, "PROVIDER_PROBE_FAILED")).toEqual({
      code: "PROVIDER_CONFIG_INVALID",
      message: "The provider configuration is invalid.",
    });
    expect(JSON.stringify(safeProviderProblem(internal, "PROVIDER_PROBE_FAILED"))).not.toContain(
      "super-secret",
    );
  });

  it("keeps every catalog group on the frozen routing modes", () => {
    const modes = new Map<ProviderGroup, string[]>(
      providerCatalogResponse().groups.map((group) => [group.group, group.routingModes]),
    );
    expect(modes.get("ai")).toEqual(["priority"]);
    expect(modes.get("places")).toEqual(["merge", "priority_failover"]);
    expect(modes.get("mail")).toEqual(["single"]);
    expect(modes.get("storage")).toEqual(["single"]);
  });

  it("never exposes a plaintext secret through the catalog response type", () => {
    const catalog: ProviderCatalog = providerCatalogResponse();
    expect(JSON.stringify(catalog)).not.toContain("apiKey=");
    expect(JSON.stringify(catalog)).not.toContain("super-secret");
  });
});
