import { Inject, Injectable, Optional } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  ProviderGroupPolicySchema,
  ProviderGroupSchema,
  ProviderHealthSchema,
  type ProviderGroup,
  type ProviderGroupPolicy,
  type ProviderHealth,
  type ProviderProblemCode,
  type ProviderRoutingMode,
} from "@roamlog/contracts";
import type Redis from "ioredis";

import { AppConfigService } from "../../config/app-config.service.js";
import { resolveAiSettingsFromStored } from "../ai/ai.settings.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { resolvePlacesSettingsFromStored, type PlacesSource } from "../places/places.settings.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { SETTINGS_BY_KEY } from "../settings/settings.registry.js";
import { SettingsService } from "../settings/settings.service.js";
import { parseProviderConfig, providerAdapterDefinition } from "./provider-catalog.js";
import type { ProviderAdapter } from "./provider-contracts.js";
import { ProviderProblemException, safeProviderProblem } from "./provider-errors.js";
import {
  PROVIDER_CONFIG_MODE_ENV,
  resolveProviderConfigMode,
  type ProviderConfigMode,
} from "./provider-config-mode.js";
import { ProviderSecretService } from "./provider-secret.service.js";

export { PROVIDER_CONFIG_MODE_ENV, resolveProviderConfigMode };
export type { ProviderConfigMode };

export const PROVIDER_RUNTIME_CACHE_TTL_MS = 5_000;
export const PROVIDER_RUNTIME_INVALIDATION_CHANNEL = "providers.invalidated";
export const PROVIDER_RUNTIME_GENERATION_PREFIX = "provider-runtime:generation:";

export interface ProviderRuntime {
  readonly id: string;
  readonly group: ProviderGroup;
  readonly adapter: ProviderAdapter;
  readonly preset: string | null;
  readonly label: string;
  readonly priority: number;
  readonly config: Readonly<Record<string, unknown>>;
  /** Plaintext is never logged or returned by an HTTP response. */
  readonly secrets: Readonly<Record<string, string>>;
  readonly health: ProviderHealth;
}

export interface ProviderGroupRuntime {
  readonly policy: ProviderGroupPolicy;
  readonly providers: readonly ProviderRuntime[];
}

interface ProviderRow {
  id: string;
  group: string;
  adapter: string;
  preset: string | null;
  label: string;
  enabled: boolean;
  priority: number;
  config: unknown;
  version: number;
  healthStatus: string;
  cooldownUntil: Date | null;
  lastCheckedAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

interface PolicyRow {
  group: string;
  routingMode: string;
  maxAttempts: number;
  cooldownSeconds: number;
  version: number;
}

interface CachedSnapshot {
  readonly mode: ProviderConfigMode;
  readonly expiresAt: number;
  readonly snapshot: ProviderGroupRuntime;
}

const GROUP_POLICY_DEFAULTS: Readonly<
  Record<
    ProviderGroup,
    {
      routingMode: ProviderRoutingMode;
      maxAttempts: number;
      cooldownSeconds: number;
    }
  >
> = Object.freeze({
  ai: { routingMode: "priority", maxAttempts: 3, cooldownSeconds: 30 },
  places: { routingMode: "merge", maxAttempts: 3, cooldownSeconds: 30 },
  mail: { routingMode: "single", maxAttempts: 1, cooldownSeconds: 0 },
  storage: { routingMode: "single", maxAttempts: 1, cooldownSeconds: 0 },
});

const LEGACY_UNKNOWN_HEALTH: ProviderHealth = Object.freeze({
  status: "unknown",
  lastCheckedAt: null,
  lastErrorCode: null,
  cooldownUntil: null,
});

const SOURCE_LABELS: Readonly<Record<PlacesSource, string>> = Object.freeze({
  tencent: "腾讯地图（环境变量）",
  geoapify: "Geoapify（环境变量）",
  photon: "Photon（环境变量）",
});

function safeCode(
  error: unknown,
  fallback: ProviderProblemCode = "PROVIDER_CONFIG_INVALID",
): ProviderProblemCode {
  return safeProviderProblem(error, fallback).code;
}

function runtimeSignature(snapshot: ProviderGroupRuntime): string {
  return JSON.stringify({
    policy: {
      routingMode: snapshot.policy.routingMode,
      maxAttempts: snapshot.policy.maxAttempts,
      cooldownSeconds: snapshot.policy.cooldownSeconds,
    },
    providers: snapshot.providers.map((provider) => ({
      adapter: provider.adapter,
      preset: provider.preset,
      priority: provider.priority,
      configKeys: Object.keys(provider.config).sort(),
      secretFields: Object.keys(provider.secrets).sort(),
    })),
  });
}

function legacyAiPreset(protocol: string): string {
  switch (protocol) {
    case "anthropic-messages":
      return "anthropic";
    case "openai-responses":
      return "openai-responses";
    default:
      return "custom-openai-compatible";
  }
}

function orderedPlacesSources(sources: readonly PlacesSource[], order: readonly PlacesSource[]) {
  const enabled = new Set(sources);
  const result: PlacesSource[] = [];
  for (const source of [...order, ...sources]) {
    if (enabled.has(source) && !result.includes(source)) {
      result.push(source);
    }
  }
  return result;
}

@Injectable()
export class ProviderRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly cache = new Map<ProviderGroup, CachedSnapshot>();
  private subscriber: Redis | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProviderSecretService) private readonly secrets: ProviderSecretService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Optional() @Inject(AppConfigService) private readonly config?: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log(
      {
        event: "provider.runtime.mode",
        mode: this.config?.providerConfigMode ?? resolveProviderConfigMode(),
        keyringConfigured: Boolean(
          this.config?.configEncryptionKey || this.config?.configEncryptionKeys,
        ),
      },
      "provider.runtime.mode",
    );
    try {
      const subscriber = this.redis.client.duplicate();
      subscriber.on("error", (error: Error) => this.warnRedis("subscriber_error", error));
      subscriber.on("message", (channel: string, message: string) => {
        if (channel === PROVIDER_RUNTIME_INVALIDATION_CHANNEL) {
          this.handleInvalidation(message);
        }
      });
      this.subscriber = subscriber;
      await subscriber.subscribe(PROVIDER_RUNTIME_INVALIDATION_CHANNEL);
    } catch (error) {
      this.warnRedis("subscribe_failed", error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = undefined;
    if (!subscriber) {
      return;
    }
    try {
      if (subscriber.status === "ready") {
        await subscriber.quit();
      } else {
        subscriber.disconnect();
      }
    } catch {
      subscriber.disconnect();
    }
  }

  async resolveGroup(
    group: ProviderGroup,
    options: { readonly bypassCache?: boolean } = {},
  ): Promise<ProviderGroupRuntime> {
    if (!ProviderGroupSchema.safeParse(group).success) {
      throw new Error(`Unknown provider group: ${group}`);
    }

    const mode = this.config?.providerConfigMode ?? resolveProviderConfigMode();
    const cached = this.cache.get(group);
    if (
      options.bypassCache !== true &&
      cached &&
      cached.mode === mode &&
      cached.expiresAt > Date.now()
    ) {
      return cached.snapshot;
    }

    let snapshot: ProviderGroupRuntime;
    if (mode === "v2") {
      snapshot = await this.resolveDatabaseSnapshot(group);
    } else {
      snapshot = await this.resolveLegacySnapshot(group);
      if (mode === "shadow") {
        await this.shadowCompare(group, snapshot);
      }
    }

    this.cache.set(group, {
      mode,
      expiresAt: Date.now() + PROVIDER_RUNTIME_CACHE_TTL_MS,
      snapshot,
    });
    return snapshot;
  }

  /**
   * Clears this process and asks peer API processes to clear their snapshot.
   *
   * Redis only receives a group generation marker and a redacted invalidation
   * message; provider secrets never enter Redis.
   */
  async invalidate(group: ProviderGroup, version?: number): Promise<void> {
    this.cache.delete(group);
    try {
      if (version !== undefined) {
        await this.redis.client.set(
          `${PROVIDER_RUNTIME_GENERATION_PREFIX}${group}`,
          String(version),
          "EX",
          3_600,
        );
      }
      await this.redis.client.publish(
        PROVIDER_RUNTIME_INVALIDATION_CHANNEL,
        JSON.stringify({ group, version: version ?? null }),
      );
    } catch (error) {
      this.warnRedis("publish_failed", error, group);
    }
  }

  private handleInvalidation(message: string): void {
    try {
      const payload = JSON.parse(message) as { group?: unknown };
      const group = ProviderGroupSchema.safeParse(payload.group);
      if (group.success) {
        this.cache.delete(group.data);
      }
    } catch {
      this.logger.debug(
        { event: "provider.runtime.invalidation_ignored" },
        "provider.runtime.invalidation_ignored",
      );
    }
  }

  private async resolveDatabaseSnapshot(group: ProviderGroup): Promise<ProviderGroupRuntime> {
    const [policyRow, rows] = await Promise.all([
      this.prismaPolicy(group),
      this.rowsForGroup(group),
    ]);
    const policy = this.policyFromRow(group, policyRow);
    const now = Date.now();
    const providers: ProviderRuntime[] = [];

    for (const row of rows) {
      if (!row.enabled || row.deletedAt !== null) {
        continue;
      }
      if (row.cooldownUntil !== null && row.cooldownUntil.getTime() > now) {
        this.logger.debug(
          { event: "provider.runtime.cooldown_skip", group, providerId: row.id },
          "provider.runtime.cooldown_skip",
        );
        continue;
      }

      const definition = providerAdapterDefinition(row.adapter);
      if (!definition || definition.group !== group) {
        this.warnProvider("adapter_unsupported", group, row.id);
        continue;
      }

      let config: Record<string, unknown>;
      try {
        config = parseProviderConfig(row.adapter, row.config);
      } catch (error) {
        this.warnProvider("config_invalid", group, row.id, safeCode(error));
        continue;
      }

      let secrets: Readonly<Record<string, string>>;
      try {
        secrets = await this.secrets.resolvePlaintext(row.id);
      } catch (error) {
        if (
          error instanceof ProviderProblemException &&
          error.code === "PROVIDER_SECRETS_UNAVAILABLE"
        ) {
          throw error;
        }
        this.warnProvider("secret_read_failed", group, row.id, safeCode(error));
        continue;
      }

      const health = this.healthFromRow(row);
      if (!health) {
        this.warnProvider("health_invalid", group, row.id);
        continue;
      }

      providers.push({
        id: row.id,
        group,
        adapter: definition.adapter,
        preset: row.preset,
        label: row.label,
        priority: row.priority,
        config: Object.freeze({ ...config }),
        secrets: Object.freeze({ ...secrets }),
        health,
      });
    }

    providers.sort(
      (left, right) => left.priority - right.priority || left.id.localeCompare(right.id),
    );
    return { policy, providers: Object.freeze(providers) };
  }

  private async resolveLegacySnapshot(group: ProviderGroup): Promise<ProviderGroupRuntime> {
    const policy = this.policyFromRow(group, null);
    if (group === "ai") {
      return { policy, providers: await this.legacyAiProviders() };
    }
    if (group === "places") {
      return { policy, providers: await this.legacyPlacesProviders() };
    }
    // Mail/storage are cut over through v2; legacy scalar readers remain in
    // their own consumers until the dedicated single-active rollout.
    return { policy, providers: [] };
  }

  private async legacyAiProviders(): Promise<readonly ProviderRuntime[]> {
    const stored = await this.readStoredGroup("ai");
    const env = process.env;
    const resolution = resolveAiSettingsFromStored({
      stored,
      env,
      envLockOf: (key) => {
        const definition = SETTINGS_BY_KEY.get(key);
        return definition
          ? {
              envLocked: definition.envLocked,
              ...(definition.envVar ? { envVar: definition.envVar } : {}),
            }
          : undefined;
      },
    });
    const ai = resolution.settings;
    if (!ai.configured || !ai.baseUrl) {
      return Object.freeze([]);
    }

    const adapter = ai.protocol as ProviderAdapter;
    const config: Record<string, unknown> = {
      baseUrl: ai.baseUrl,
      defaultModel: ai.model,
      timeoutMs: ai.timeoutMs,
      maxOutputTokens: ai.maxOutputTokens,
    };
    if (ai.reasoningEffort) {
      config.reasoningEffort = ai.reasoningEffort;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parseProviderConfig(adapter, config);
    } catch (error) {
      this.warnProvider("legacy_ai_config_invalid", "ai", "legacy:ai", safeCode(error));
      return Object.freeze([]);
    }

    const secrets: Record<string, string> = {};
    if (ai.apiKey) {
      secrets.apiKey = ai.apiKey;
    }

    return Object.freeze([
      {
        id: "legacy:ai",
        group: "ai",
        adapter,
        preset: legacyAiPreset(ai.protocol),
        label: "Legacy AI settings",
        priority: 10,
        config: Object.freeze(parsed),
        secrets: Object.freeze(secrets),
        health: LEGACY_UNKNOWN_HEALTH,
      },
    ]);
  }

  private async legacyPlacesProviders(): Promise<readonly ProviderRuntime[]> {
    const stored = await this.readStoredGroup("places");
    const env = process.env;
    const resolution = resolvePlacesSettingsFromStored({
      stored,
      env,
      envLockOf: (key) => {
        const definition = SETTINGS_BY_KEY.get(key);
        return definition
          ? {
              envLocked: definition.envLocked,
              ...(definition.envVar ? { envVar: definition.envVar } : {}),
            }
          : undefined;
      },
    });
    const places = resolution.settings;
    const providers: ProviderRuntime[] = [];
    const sources = orderedPlacesSources(places.sources, places.sourceOrder);

    for (const source of sources) {
      const configured = this.legacyPlacesProvider(source, places);
      if (!configured) {
        continue;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = parseProviderConfig(source, configured.config);
      } catch (error) {
        this.warnProvider(
          "legacy_places_config_invalid",
          "places",
          `legacy:${source}`,
          safeCode(error),
        );
        continue;
      }
      providers.push({
        id: `legacy:places:${source}`,
        group: "places",
        adapter: source,
        preset: source,
        label: SOURCE_LABELS[source],
        priority: (providers.length + 1) * 10,
        config: Object.freeze(parsed),
        secrets: Object.freeze(configured.secrets),
        health: LEGACY_UNKNOWN_HEALTH,
      });
    }
    return Object.freeze(providers);
  }

  private legacyPlacesProvider(
    source: PlacesSource,
    places: ReturnType<typeof resolvePlacesSettingsFromStored>["settings"],
  ): { config: Record<string, unknown>; secrets: Record<string, string> } | null {
    if (source === "tencent") {
      if (!places.tencentApiKey) return null;
      return {
        config: {
          baseUrl: places.tencentBaseUrl,
          timeoutMs: places.tencentTimeoutMs,
          regions: ["cn"],
          dailyQuota: places.tencentDailyLimit,
          cacheTtlSeconds: places.tencentCacheTtlSeconds,
        },
        secrets: { apiKey: places.tencentApiKey },
      };
    }
    if (source === "geoapify") {
      if (!places.geoapifyApiKey) return null;
      return {
        config: {
          baseUrl: places.geoapifyBaseUrl,
          timeoutMs: places.geoapifyTimeoutMs,
          regions: ["global"],
          dailyQuota: places.geoapifyDailyLimit,
          cacheTtlSeconds: places.cacheTtlSeconds,
        },
        secrets: { apiKey: places.geoapifyApiKey },
      };
    }
    return {
      config: {
        baseUrl: places.baseUrl,
        timeoutMs: places.timeoutMs,
        regions: ["global"],
        cacheTtlSeconds: places.cacheTtlSeconds,
      },
      secrets: {},
    };
  }

  private async readStoredGroup(group: ProviderGroup): Promise<Record<string, unknown> | null> {
    try {
      return await this.settings.getGroup(group);
    } catch (error) {
      this.logger.warn(
        {
          event: "provider.runtime.settings_fallback",
          group,
          code: error instanceof Error ? error.name : "unknown",
        },
        "provider.runtime.settings_fallback",
      );
      return null;
    }
  }

  private async shadowCompare(group: ProviderGroup, legacy: ProviderGroupRuntime): Promise<void> {
    try {
      const v2 = await this.resolveDatabaseSnapshot(group);
      if (runtimeSignature(legacy) !== runtimeSignature(v2)) {
        this.logger.warn(
          {
            event: "provider.runtime.shadow_mismatch",
            group,
            legacy: runtimeSignature(legacy),
            v2: runtimeSignature(v2),
          },
          "provider.runtime.shadow_mismatch",
        );
      }
    } catch (error) {
      this.logger.warn(
        {
          event: "provider.runtime.shadow_failed",
          group,
          code: safeCode(error),
        },
        "provider.runtime.shadow_failed",
      );
    }
  }

  private policyFromRow(group: ProviderGroup, row: PolicyRow | null): ProviderGroupPolicy {
    const defaults = GROUP_POLICY_DEFAULTS[group];
    const candidate = {
      group,
      routingMode: row?.routingMode ?? defaults.routingMode,
      maxAttempts: row?.maxAttempts ?? defaults.maxAttempts,
      cooldownSeconds: row?.cooldownSeconds ?? defaults.cooldownSeconds,
      version: row?.version ?? 1,
    };
    const parsed = ProviderGroupPolicySchema.safeParse(candidate);
    if (parsed.success) {
      return parsed.data;
    }
    this.logger.warn(
      {
        event: "provider.runtime.policy_invalid",
        group,
        version: row?.version ?? 1,
      },
      "provider.runtime.policy_invalid",
    );
    return ProviderGroupPolicySchema.parse({
      group,
      ...defaults,
      version: row?.version ?? 1,
    });
  }

  private healthFromRow(row: ProviderRow): ProviderHealth | null {
    const parsed = ProviderHealthSchema.safeParse({
      status: row.healthStatus,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastErrorCode: row.lastErrorCode,
      cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    });
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  }

  private async prismaPolicy(group: ProviderGroup): Promise<PolicyRow | null> {
    return this.prisma.client.providerGroupPolicy.findUnique({ where: { group } });
  }

  private async rowsForGroup(group: ProviderGroup): Promise<ProviderRow[]> {
    return this.prisma.client.providerConnection.findMany({
      where: { group, deletedAt: null },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  }

  private warnProvider(
    event: string,
    group: ProviderGroup,
    providerId: string,
    code?: string,
  ): void {
    this.logger.warn(
      {
        event: `provider.runtime.${event}`,
        group,
        providerId,
        ...(code ? { code } : {}),
      },
      `provider.runtime.${event}`,
    );
  }

  private warnRedis(event: string, error: unknown, group?: ProviderGroup): void {
    this.logger.warn(
      {
        event: `provider.runtime.redis_${event}`,
        ...(group ? { group } : {}),
        code: error instanceof Error ? error.name : "unknown",
      },
      `provider.runtime.redis_${event}`,
    );
  }
}
