import { describe, expect, it, vi } from "vitest";

import type { ProviderRuntimeService } from "../providers/provider-runtime.service.js";
import { staticPlacesSettingsSource } from "./places.settings.js";
import { PlacesProviderRuntimeService } from "./places-provider-runtime.service.js";
import { testSettings } from "./__tests__/place-fixtures.js";

function provider(
  id: string,
  adapter: "tencent" | "geoapify" | "photon",
  priority: number,
  config: Record<string, unknown>,
  secrets: Record<string, string> = {},
) {
  return {
    id,
    group: "places",
    adapter,
    preset: adapter,
    label: id,
    priority,
    config,
    secrets,
    health: {
      status: "unknown",
      lastCheckedAt: null,
      lastErrorCode: null,
      cooldownUntil: null,
    },
  } as const;
}

function harness(
  providers: readonly ReturnType<typeof provider>[],
  version = 3,
  routingMode = "merge",
) {
  const resolveGroup = vi.fn(async () => ({
    policy: {
      group: "places",
      routingMode,
      maxAttempts: 3,
      cooldownSeconds: 30,
      version,
    },
    providers,
  }));
  const runtime = { resolveGroup } as unknown as ProviderRuntimeService;
  const base = staticPlacesSettingsSource(testSettings());
  return {
    service: new PlacesProviderRuntimeService(runtime, base),
    resolveGroup,
  };
}

describe("PlacesProviderRuntimeService", () => {
  it("keeps Tencent and Geoapify simultaneously eligible for China", async () => {
    const { service } = harness([
      provider(
        "t",
        "tencent",
        10,
        {
          baseUrl: "https://tencent.example.test/ws",
          regions: ["cn"],
        },
        { apiKey: "tencent-key" },
      ),
      provider(
        "g",
        "geoapify",
        20,
        {
          baseUrl: "https://geoapify.example.test/v1/geocode/autocomplete",
          regions: ["global"],
        },
        { apiKey: "geo-key" },
      ),
    ]);

    const snapshot = await service.resolveGroup({ q: "北京", country: "CN" });

    expect(snapshot.providers.map((entry) => entry.adapter)).toEqual(["tencent", "geoapify"]);
    expect(snapshot.providers[0]?.settings.tencentApiKey).toBe("tencent-key");
    expect(snapshot.providers[1]?.settings.geoapifyApiKey).toBe("geo-key");
  });

  it("excludes a China-only provider from a global query", async () => {
    const { service } = harness([
      provider(
        "t",
        "tencent",
        10,
        {
          baseUrl: "https://tencent.example.test/ws",
          regions: ["cn"],
        },
        { apiKey: "tencent-key" },
      ),
      provider(
        "g",
        "geoapify",
        20,
        {
          baseUrl: "https://geoapify.example.test/v1/geocode/autocomplete",
          regions: ["global"],
        },
        { apiKey: "geo-key" },
      ),
    ]);

    const snapshot = await service.resolveGroup({ q: "Paris" });

    expect(snapshot.providers.map((entry) => entry.adapter)).toEqual(["geoapify"]);
  });

  it("includes both regional scopes for a Han query without a country", async () => {
    const { service } = harness([
      provider(
        "t",
        "tencent",
        10,
        {
          baseUrl: "https://tencent.example.test/ws",
        },
        { apiKey: "tencent-key" },
      ),
      provider("p", "photon", 20, {
        baseUrl: "https://photon.example.test/api",
        regions: ["global"],
      }),
    ]);

    const snapshot = await service.resolveGroup({ q: "京都" });

    expect(snapshot.providers.map((entry) => entry.adapter)).toEqual(["tencent", "photon"]);
  });

  it("skips providers with missing required secrets or invalid config", async () => {
    const { service } = harness([
      provider("missing", "geoapify", 10, {
        baseUrl: "https://geoapify.example.test/v1/geocode/autocomplete",
      }),
      provider("invalid", "photon", 20, { timeoutMs: 100 }),
    ]);

    const snapshot = await service.resolveGroup({ q: "Paris" });

    expect(snapshot.providers).toEqual([]);
  });

  it("maps explicit policy modes and changes the cache generation with version", async () => {
    const first = harness(
      [
        provider(
          "g",
          "geoapify",
          10,
          {
            baseUrl: "https://geoapify.example.test/v1/geocode/autocomplete",
            regions: ["global"],
          },
          { apiKey: "geo-key" },
        ),
      ],
      4,
    );
    const second = harness(
      [
        provider(
          "g",
          "geoapify",
          10,
          {
            baseUrl: "https://geoapify.example.test/v1/geocode/autocomplete",
            regions: ["global"],
          },
          { apiKey: "geo-key" },
        ),
      ],
      5,
    );

    const one = await first.service.resolveGroup({ q: "Paris" }, "priority_failover");
    const two = await second.service.resolveGroup({ q: "Paris" });

    expect(one.routingMode).toBe("priority_failover");
    expect(one.generation).not.toBe(two.generation);
  });
});
