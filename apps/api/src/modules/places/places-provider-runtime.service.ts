import { Inject, Injectable } from "@nestjs/common";

import {
  geoapifyProviderConfigSchema,
  photonProviderConfigSchema,
  tencentProviderConfigSchema,
  type ProviderAdapter,
} from "../providers/provider-contracts.js";
import { ProviderRuntimeService } from "../providers/provider-runtime.service.js";
import { HAN_SCRIPT } from "./ranking/query-variants.js";
import {
  PLACES_SETTINGS,
  type PlacesSettings,
  type PlacesSettingsSource,
} from "./places.settings.js";

export type PlacesRuntimeAdapter = "tencent" | "geoapify" | "photon";
export type PlacesRoutingMode = "merge" | "priority_failover";

export interface PlacesRuntimeProvider {
  readonly id: string;
  readonly adapter: PlacesRuntimeAdapter;
  readonly priority: number;
  readonly regions: readonly ("cn" | "global")[];
  readonly settings: PlacesSettings;
}

export interface PlacesRuntimeSnapshot {
  readonly routingMode: PlacesRoutingMode;
  readonly maxAttempts: number;
  readonly generation: string;
  readonly providers: readonly PlacesRuntimeProvider[];
}

export interface PlacesProviderRuntimeSource {
  resolveGroup(
    query: { readonly q: string; readonly country?: string | undefined },
    policyMode?: PlacesRoutingMode,
  ): Promise<PlacesRuntimeSnapshot>;
}

type PlacesRoute = "china" | "mixed" | "global";

const PLACES_ADAPTERS = new Set<PlacesRuntimeAdapter>(["tencent", "geoapify", "photon"]);

function isPlacesAdapter(adapter: ProviderAdapter): adapter is PlacesRuntimeAdapter {
  return PLACES_ADAPTERS.has(adapter as PlacesRuntimeAdapter);
}

function routeFor(query: {
  readonly q: string;
  readonly country?: string | undefined;
}): PlacesRoute {
  if (query.country === "CN") {
    return "china";
  }
  if (query.country === undefined && HAN_SCRIPT.test(query.q)) {
    return "mixed";
  }
  return "global";
}

function routingMode(value: string | undefined): PlacesRoutingMode {
  return value === "priority_failover" || value === "priority" || value === "single"
    ? "priority_failover"
    : "merge";
}

function eligibleForRoute(regions: readonly ("cn" | "global")[], route: PlacesRoute): boolean {
  // China and mixed requests preserve the existing recall quality: global
  // providers still participate alongside Tencent. A global-only request never
  // calls a provider that is explicitly scoped to China.
  return route === "global" ? regions.includes("global") : regions.length > 0;
}

function settingsForProvider(
  base: PlacesSettings,
  adapter: PlacesRuntimeAdapter,
  config: Record<string, unknown>,
  secrets: Readonly<Record<string, string>>,
): { settings: PlacesSettings; regions: readonly ("cn" | "global")[] } | null {
  if (adapter === "tencent") {
    const parsed = tencentProviderConfigSchema.safeParse(config);
    const apiKey = secrets.apiKey?.trim();
    if (!parsed.success || !apiKey) {
      return null;
    }
    return {
      regions: parsed.data.regions,
      settings: {
        ...base,
        tencentBaseUrl: parsed.data.baseUrl,
        tencentApiKey: apiKey,
        tencentTimeoutMs: parsed.data.timeoutMs,
        tencentCacheTtlSeconds: parsed.data.cacheTtlSeconds,
        tencentDailyLimit: parsed.data.dailyQuota,
        sources: ["tencent"],
        sourceOrder: ["tencent"],
      },
    };
  }

  if (adapter === "geoapify") {
    const parsed = geoapifyProviderConfigSchema.safeParse(config);
    const apiKey = secrets.apiKey?.trim();
    if (!parsed.success || !apiKey) {
      return null;
    }
    return {
      regions: parsed.data.regions,
      settings: {
        ...base,
        provider: "geoapify",
        geoapifyBaseUrl: parsed.data.baseUrl,
        geoapifyApiKey: apiKey,
        geoapifyTimeoutMs: parsed.data.timeoutMs,
        geoapifyDailyLimit: parsed.data.dailyQuota,
        cacheTtlSeconds: parsed.data.cacheTtlSeconds,
        sources: ["geoapify"],
        sourceOrder: ["geoapify"],
      },
    };
  }

  const parsed = photonProviderConfigSchema.safeParse(config);
  if (!parsed.success) {
    return null;
  }
  return {
    regions: parsed.data.regions,
    settings: {
      ...base,
      provider: "photon",
      baseUrl: parsed.data.baseUrl,
      timeoutMs: parsed.data.timeoutMs,
      cacheTtlSeconds: parsed.data.cacheTtlSeconds,
      sources: ["photon"],
      sourceOrder: ["photon"],
    },
  };
}

@Injectable()
export class PlacesProviderRuntimeService implements PlacesProviderRuntimeSource {
  constructor(
    @Inject(ProviderRuntimeService) private readonly providers: ProviderRuntimeService,
    @Inject(PLACES_SETTINGS) private readonly baseSettings: PlacesSettingsSource,
  ) {}

  /**
   * Resolve the eligible place providers for one request. The provider runtime
   * already applies enabled/deleted/priority/cooldown filtering and the
   * legacy/shadow/v2 mode.
   */
  async resolveGroup(
    query: { readonly q: string; readonly country?: string | undefined },
    policyMode?: PlacesRoutingMode,
  ): Promise<PlacesRuntimeSnapshot> {
    const [base, snapshot] = await Promise.all([
      this.baseSettings.resolve(),
      this.providers.resolveGroup("places"),
    ]);
    const route = routeFor(query);
    const providers: PlacesRuntimeProvider[] = [];

    for (const provider of snapshot.providers) {
      if (!isPlacesAdapter(provider.adapter)) {
        continue;
      }
      const configured = settingsForProvider(
        base,
        provider.adapter,
        provider.config,
        provider.secrets,
      );
      if (!configured || !eligibleForRoute(configured.regions, route)) {
        continue;
      }
      providers.push({
        id: provider.id,
        adapter: provider.adapter,
        priority: provider.priority,
        regions: configured.regions,
        settings: configured.settings,
      });
    }

    return {
      routingMode: routingMode(policyMode ?? snapshot.policy.routingMode),
      maxAttempts: Math.max(1, snapshot.policy.maxAttempts),
      generation: `v${snapshot.policy.version}:${providers
        .map((provider) => `${provider.id}@${provider.priority}`)
        .join(",")}`,
      providers: Object.freeze(providers),
    };
  }

  async resolve(
    query: { readonly q: string; readonly country?: string | undefined },
    policyMode?: PlacesRoutingMode,
  ): Promise<readonly PlacesRuntimeProvider[]> {
    return (await this.resolveGroup(query, policyMode)).providers;
  }
}

/**
 * Test/acceptance helper for callers that have a resolved `PlacesSettings`
 * snapshot instead of a database-backed provider registry.
 */
export function staticPlacesProviderRuntimeSource(
  settings: PlacesSettings,
  mode: PlacesRoutingMode = "merge",
): PlacesProviderRuntimeSource {
  const providers: PlacesRuntimeProvider[] = [];
  for (const adapter of settings.sourceOrder) {
    if (!settings.sources.includes(adapter)) {
      continue;
    }
    if (adapter === "tencent" && settings.tencentApiKey === null) {
      continue;
    }
    if (adapter === "geoapify" && settings.geoapifyApiKey === null) {
      continue;
    }
    providers.push({
      id: `static:places:${adapter}`,
      adapter,
      priority: (providers.length + 1) * 10,
      regions: adapter === "tencent" ? ["cn"] : ["global"],
      settings: {
        ...settings,
        sources: [adapter],
        sourceOrder: [adapter],
      },
    });
  }

  return {
    async resolveGroup(query, policyMode) {
      const route = routeFor(query);
      const eligible = providers.filter((provider) => eligibleForRoute(provider.regions, route));
      return {
        routingMode: policyMode ?? mode,
        maxAttempts: 3,
        generation: `static:v1:${eligible.map((provider) => provider.id).join(",")}`,
        providers: Object.freeze(eligible),
      };
    },
  };
}

/** Test/acceptance helper that resolves the legacy settings source per call. */
export function settingsSourcePlacesProviderRuntimeSource(
  source: PlacesSettingsSource,
  mode: PlacesRoutingMode = "merge",
): PlacesProviderRuntimeSource {
  return {
    async resolveGroup(query, policyMode) {
      return staticPlacesProviderRuntimeSource(
        await source.resolve(),
        policyMode ?? mode,
      ).resolveGroup(query, policyMode);
    },
  };
}
