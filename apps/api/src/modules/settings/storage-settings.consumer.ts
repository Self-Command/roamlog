import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AdminSettingItem, SettingValue } from "@roamlog/contracts";

import type { StorageSettings } from "../../config/storage-settings.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { s3ProviderConfigSchema } from "../providers/provider-contracts.js";
import {
  ProviderRuntimeService,
  resolveProviderConfigMode,
} from "../providers/provider-runtime.service.js";
import type { SettingDefinition } from "./settings.registry.js";
import type { SettingsService } from "./settings.service.js";

/** DI token for the env-resolved baseline (`AppConfigService.storageSettings`). */
export const STORAGE_ENV_SETTINGS = Symbol("roamlog:storage-env-settings");

/** Narrow read port; the real provider aliases `SettingsService`. */
export const STORAGE_SETTINGS_READER = Symbol("roamlog:storage-settings-reader");

/** Registry used to read defaults and env locks for the seven storage keys. */
export const STORAGE_SETTINGS_REGISTRY = Symbol("roamlog:storage-settings-registry");

/** The seven operator-editable `storage.*` keys. */
export const STORAGE_SETTING_KEYS = [
  "storage.endpoint",
  "storage.publicEndpoint",
  "storage.bucket",
  "storage.region",
  "storage.accessKey",
  "storage.secretKey",
  "storage.forcePathStyle",
] as const;

export type StorageSettingKey = (typeof STORAGE_SETTING_KEYS)[number];
export type StorageConfigField =
  | "endpoint"
  | "publicEndpoint"
  | "bucket"
  | "region"
  | "accessKey"
  | "secretKey"
  | "forcePathStyle";
export type StorageConfigSource = "database" | "environment" | "default";

type StorageSettingsReader = Pick<SettingsService, "getGroup" | "listAdminSettings">;

interface StorageFieldDescriptor {
  readonly field: StorageConfigField;
  readonly key: StorageSettingKey;
  /** Used when the registry does not declare `envVar` for the key. */
  readonly envVar: string;
  readonly kind: "string" | "boolean";
}

const FIELDS: readonly StorageFieldDescriptor[] = [
  { field: "endpoint", key: "storage.endpoint", envVar: "S3_ENDPOINT", kind: "string" },
  {
    field: "publicEndpoint",
    key: "storage.publicEndpoint",
    envVar: "S3_PUBLIC_ENDPOINT",
    kind: "string",
  },
  { field: "bucket", key: "storage.bucket", envVar: "S3_BUCKET", kind: "string" },
  { field: "region", key: "storage.region", envVar: "S3_REGION", kind: "string" },
  { field: "accessKey", key: "storage.accessKey", envVar: "S3_ACCESS_KEY", kind: "string" },
  { field: "secretKey", key: "storage.secretKey", envVar: "S3_SECRET_KEY", kind: "string" },
  {
    field: "forcePathStyle",
    key: "storage.forcePathStyle",
    envVar: "S3_FORCE_PATH_STYLE",
    kind: "boolean",
  },
];

/** Mirrors `DEFAULT_SETTINGS`; only reached when the registry is unavailable. */
const FALLBACK_DEFAULTS: Record<StorageConfigField, string | boolean | null> = {
  endpoint: "http://localhost:9000",
  publicEndpoint: null,
  bucket: "roamlog",
  region: "us-east-1",
  accessKey: null,
  secretKey: null,
  forcePathStyle: true,
};

const DEFAULT_SIGNED_URL_TTL_SECONDS = 900;
/** Matches `SettingsService`'s 5s process cache; bounds extra DB reads. */
const RESOLVE_CACHE_TTL_MS = 5_000;

export interface ResolvedStorageConfig {
  /** Runtime settings, including the env-only TTLs. */
  readonly settings: StorageSettings;
  /** Content-derived settings version; clients are rebuilt only when it changes. */
  readonly version: string;
  readonly sources: Record<StorageConfigField, StorageConfigSource>;
  readonly envLockedKeys: readonly StorageSettingKey[];
  /** Safe diagnostic codes only; never values or credentials. */
  readonly warnings: readonly string[];
}

/**
 * Resolves the effective object-storage configuration.
 *
 * Precedence, per key:
 *  1. an `envLocked` definition (or a DB row flagged `envLocked`) -> env wins;
 *  2. an explicitly stored DB row with a non-empty value -> DB;
 *  3. environment (`S3_*`) -> env;
 *  4. code default from the registry.
 *
 * A DB outage or an unreadable/empty stored value never throws: the consumer
 * logs a single warning and falls back to env, then to the default. Reads are
 * cached for 5s so signing a batch of media URLs does not hit PostgreSQL per
 * key. `SettingsService` has no public version accessor and is owned by another
 * change set here, so the version is derived from the resolved values: same
 * values -> same version (reuse), any credential/endpoint change -> new version
 * (rebuild). That is equivalent to the settings cache version for this purpose
 * and also works across instances without pub/sub.
 */
@Injectable()
export class StorageSettingsConsumer {
  private readonly definitions: Map<string, SettingDefinition>;
  private cached: { expiresAt: number; value: ResolvedStorageConfig } | null = null;
  private readonly warned = new Set<string>();

  constructor(
    @Inject(STORAGE_SETTINGS_READER) private readonly settings: StorageSettingsReader,
    @Inject(STORAGE_ENV_SETTINGS) private readonly environment: StorageSettings,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(STORAGE_SETTINGS_REGISTRY) registry: readonly SettingDefinition[],
    @Optional()
    @Inject(ProviderRuntimeService)
    private readonly providers?: ProviderRuntimeService,
  ) {
    this.definitions = new Map(
      registry.filter((entry) => entry.group === "storage").map((entry) => [entry.key, entry]),
    );
  }

  /** Read-through cache hook; tests and future pub/sub invalidation call this. */
  invalidate(): void {
    this.cached = null;
  }

  async resolve(): Promise<ResolvedStorageConfig> {
    if (resolveProviderConfigMode() === "v2") {
      if (this.providers) {
        return this.resolveProviderRuntime();
      }
      this.warnOnce("provider-runtime-unavailable", "storage.provider_runtime_unavailable", {
        fallback: "legacy",
      });
    }

    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }

    const value = await this.read();
    this.cached = { expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS, value };
    return value;
  }

  /**
   * Provider-mode storage is single-active in v1. The provider registry
   * enforces one enabled storage row; this mapper preserves the existing
   * ResolvedStorageConfig contract so the S3 client factory, health checks and
   * signed-url code do not need a second implementation.
   */
  private async resolveProviderRuntime(): Promise<ResolvedStorageConfig> {
    let group: Awaited<ReturnType<ProviderRuntimeService["resolveGroup"]>>;
    try {
      group = await this.providers!.resolveGroup("storage");
    } catch (error) {
      this.warnOnce("provider-runtime-unavailable", "storage.provider_runtime_unavailable", {
        reason: error instanceof Error ? error.name : "UnknownError",
      });
      return this.providerUnconfigured("PROVIDER_RUNTIME_UNAVAILABLE");
    }

    const active = group.providers[0];
    if (!active || active.adapter !== "s3") {
      return this.providerUnconfigured("PROVIDER_NOT_CONFIGURED");
    }

    const parsed = s3ProviderConfigSchema.safeParse(active.config);
    if (!parsed.success) {
      return this.providerUnconfigured("PROVIDER_CONFIG_INVALID");
    }

    const warnings: string[] = [];
    const accessKey = active.secrets.accessKey?.trim() ?? "";
    const secretKey = active.secrets.secretKey?.trim() ?? "";
    if (!accessKey || !secretKey) {
      warnings.push("PROVIDER_SECRET_MISSING");
    }

    const publicEndpoint = parsed.data.publicEndpoint?.trim();
    const settings: StorageSettings = {
      endpoint: parsed.data.endpoint,
      ...(publicEndpoint ? { publicEndpoint } : {}),
      bucket: parsed.data.bucket,
      region: parsed.data.region,
      accessKey,
      secretKey,
      forcePathStyle: parsed.data.forcePathStyle,
      signedUrlTtlSeconds: this.environment.signedUrlTtlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS,
      ...(this.environment.mediaSignedUrlTtlSeconds !== undefined
        ? { mediaSignedUrlTtlSeconds: this.environment.mediaSignedUrlTtlSeconds }
        : {}),
    };

    return {
      settings,
      version: storageConfigVersion(settings),
      sources: {
        endpoint: "database",
        publicEndpoint: publicEndpoint ? "database" : "default",
        bucket: "database",
        region: "database",
        accessKey: "database",
        secretKey: "database",
        forcePathStyle: "database",
      },
      envLockedKeys: [],
      warnings,
    };
  }

  private providerUnconfigured(warning: string): ResolvedStorageConfig {
    const settings: StorageSettings = {
      ...this.environment,
      accessKey: "",
      secretKey: "",
      signedUrlTtlSeconds: this.environment.signedUrlTtlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS,
    };
    return {
      settings,
      version: storageConfigVersion(settings),
      sources: {
        endpoint: "default",
        publicEndpoint: "default",
        bucket: "default",
        region: "default",
        accessKey: "database",
        secretKey: "database",
        forcePathStyle: "default",
      },
      envLockedKeys: [],
      warnings: [warning],
    };
  }

  /** Diagnostics: the env-only TTLs and the raw env baseline. */
  get environmentSettings(): StorageSettings {
    return this.environment;
  }

  private async read(): Promise<ResolvedStorageConfig> {
    let group: Record<string, SettingValue>;
    let items: Map<string, AdminSettingItem>;

    try {
      const [values, admin] = await Promise.all([
        this.settings.getGroup("storage"),
        this.settings.listAdminSettings(),
      ]);
      group = values;
      const storageGroup = admin.groups.find((entry) => entry.group === "storage");
      items = new Map((storageGroup?.items ?? []).map((item) => [item.key, item]));
    } catch {
      // No error object: a Prisma/SecretBox error must never reach logs with a
      // connection string or ciphertext payload.
      this.warnOnce("settings-unavailable", "storage.settings_unavailable", {
        fallback: "environment",
      });
      return this.environmentResolution(["SETTINGS_UNAVAILABLE"]);
    }

    const values: Partial<Record<StorageConfigField, unknown>> = {};
    const sources = {} as Record<StorageConfigField, StorageConfigSource>;
    const envLockedKeys: StorageSettingKey[] = [];
    const warnings: string[] = [];

    for (const descriptor of FIELDS) {
      const definition = this.definitions.get(descriptor.key);
      const item = items.get(descriptor.key);
      const env = this.environmentValue(descriptor, definition);
      const envLocked = Boolean(definition?.envLocked || item?.envLocked);

      if (envLocked && env.present) {
        values[descriptor.field] = env.value;
        sources[descriptor.field] = "environment";
        envLockedKeys.push(descriptor.key);
        continue;
      }

      const stored = item?.updatedAt ? storedValue(item, group) : undefined;
      if (item?.updatedAt && !isEmpty(stored)) {
        values[descriptor.field] = stored;
        sources[descriptor.field] = "database";
        continue;
      }

      if (item?.updatedAt) {
        warnings.push("SETTING_EMPTY");
        this.warnOnce(`${descriptor.key}:empty`, "storage.setting_empty_fallback", {
          key: descriptor.key,
          fallback: env.present ? "environment" : "default",
        });
      }

      if (env.present) {
        values[descriptor.field] = env.value;
        sources[descriptor.field] = "environment";
        continue;
      }

      values[descriptor.field] = this.defaultValue(descriptor);
      sources[descriptor.field] = "default";
    }

    const publicEndpoint = asOptionalString(values.publicEndpoint);
    const settings: StorageSettings = {
      endpoint: asString(values.endpoint) ?? this.environment.endpoint,
      ...(publicEndpoint ? { publicEndpoint } : {}),
      bucket: asString(values.bucket) ?? this.environment.bucket,
      region: asString(values.region) ?? this.environment.region,
      accessKey: asString(values.accessKey) ?? asString(this.environment.accessKey) ?? "",
      secretKey: asString(values.secretKey) ?? asString(this.environment.secretKey) ?? "",
      forcePathStyle:
        typeof values.forcePathStyle === "boolean"
          ? values.forcePathStyle
          : this.environment.forcePathStyle,
      signedUrlTtlSeconds: this.environment.signedUrlTtlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS,
      mediaSignedUrlTtlSeconds: this.environment.mediaSignedUrlTtlSeconds,
    };

    return {
      settings,
      version: storageConfigVersion(settings),
      sources,
      envLockedKeys,
      warnings,
    };
  }

  private environmentResolution(warnings: readonly string[]): ResolvedStorageConfig {
    const settings: StorageSettings = {
      ...this.environment,
      publicEndpoint: this.environment.publicEndpoint,
      signedUrlTtlSeconds: this.environment.signedUrlTtlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS,
    };
    return {
      settings,
      version: storageConfigVersion(settings),
      sources: {
        endpoint: "environment",
        publicEndpoint: "environment",
        bucket: "environment",
        region: "environment",
        accessKey: "environment",
        secretKey: "environment",
        forcePathStyle: "environment",
      },
      envLockedKeys: [],
      warnings,
    };
  }

  private environmentValue(
    descriptor: StorageFieldDescriptor,
    definition: SettingDefinition | undefined,
  ): { present: boolean; value?: unknown } {
    const envVar = definition?.envVar ?? descriptor.envVar;
    const raw = process.env[envVar];
    if (raw !== undefined && raw !== "") {
      return { present: true, value: parseEnvironmentValue(descriptor, raw) };
    }

    const baseline = this.environment[descriptor.field];
    if (baseline === undefined || baseline === null || baseline === "") {
      return { present: false };
    }
    return { present: true, value: baseline };
  }

  private defaultValue(descriptor: StorageFieldDescriptor): unknown {
    const definition = this.definitions.get(descriptor.key);
    const value = definition?.defaultValue;
    if (value !== undefined && value !== null) {
      return value;
    }
    const fallback = FALLBACK_DEFAULTS[descriptor.field];
    if (descriptor.field === "publicEndpoint") {
      return fallback;
    }
    return fallback ?? (descriptor.kind === "boolean" ? false : "");
  }

  private warnOnce(id: string, message: string, context: Record<string, unknown>): void {
    if (this.warned.has(id)) {
      return;
    }
    this.warned.add(id);
    this.logger.warn(context, message);
  }
}

function storedValue(item: AdminSettingItem, group: Record<string, SettingValue>): unknown {
  if (item.isSecret) {
    return group[item.key];
  }
  return item.value;
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return asString(value);
}

function parseEnvironmentValue(descriptor: StorageFieldDescriptor, raw: string): unknown {
  const value = raw.trim();
  if (descriptor.kind === "boolean") {
    return /^(1|true|yes|on)$/iu.test(value);
  }
  return value;
}

/**
 * Content-derived version. SHA-256 over the effective credentials is one-way,
 * so it is safe to log; it changes whenever any resolved value changes.
 */
export function storageConfigVersion(settings: StorageSettings): string {
  const material = JSON.stringify({
    endpoint: settings.endpoint,
    publicEndpoint: settings.publicEndpoint ?? null,
    bucket: settings.bucket,
    region: settings.region,
    accessKey: settings.accessKey,
    secretKey: settings.secretKey,
    forcePathStyle: settings.forcePathStyle,
    signedUrlTtlSeconds: settings.signedUrlTtlSeconds,
    mediaSignedUrlTtlSeconds: settings.mediaSignedUrlTtlSeconds ?? null,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}
