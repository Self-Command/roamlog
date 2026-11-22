import type { AdminSettingItem, AdminSettingsResponse } from "@roamlog/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StorageSettings } from "../../config/storage-settings.js";
import type { ProviderRuntimeService } from "../providers/provider-runtime.service.js";
import type { SettingDefinition } from "../settings/settings.registry.js";
import { StorageSettingsConsumer } from "../settings/storage-settings.consumer.js";

function definition(
  key: string,
  defaultValue: string | boolean | null,
  options: { envLocked?: boolean; envVar?: string } = {},
): SettingDefinition {
  return {
    key,
    group: "storage",
    type: typeof defaultValue === "boolean" ? "boolean" : "string",
    defaultValue,
    schema: undefined,
    isPublic: false,
    isSecret: key === "storage.accessKey" || key === "storage.secretKey",
    envLocked: options.envLocked ?? false,
    ...(options.envVar ? { envVar: options.envVar } : {}),
    label: key,
    help: "",
  } as unknown as SettingDefinition;
}

const FAKE_REGISTRY: readonly SettingDefinition[] = [
  definition("storage.endpoint", "http://localhost:9000"),
  definition("storage.publicEndpoint", null),
  definition("storage.bucket", "roamlog"),
  definition("storage.region", "us-east-1"),
  definition("storage.accessKey", null),
  definition("storage.secretKey", null),
  definition("storage.forcePathStyle", true),
];

const ENV_SETTINGS: StorageSettings = {
  endpoint: "http://env-minio:9000",
  publicEndpoint: "https://env-media.example.com",
  bucket: "env-bucket",
  region: "env-region",
  accessKey: "env-access",
  secretKey: "env-secret",
  forcePathStyle: true,
  signedUrlTtlSeconds: 900,
  mediaSignedUrlTtlSeconds: 600,
};

function logger() {
  return { warn: vi.fn(), error: vi.fn(), log: vi.fn(), debug: vi.fn() };
}

function item(
  key: string,
  value: unknown,
  options: { updatedAt?: Date | null; envLocked?: boolean } = {},
): AdminSettingItem {
  const secret = key === "storage.accessKey" || key === "storage.secretKey";
  return {
    key,
    group: "storage",
    type: secret ? "secret" : typeof value === "boolean" ? "boolean" : "string",
    label: key,
    default: null,
    isSecret: secret,
    isPublic: false,
    envLocked: options.envLocked ?? false,
    ...(secret
      ? { secret: { hasValue: value !== null && value !== undefined, last4: null } }
      : { value: value as never }),
    updatedAt:
      options.updatedAt === null
        ? null
        : (options.updatedAt ?? new Date("2026-11-19T00:00:00.000Z")).toISOString(),
    updatedById: null,
  } as AdminSettingItem;
}

function adminResponse(items: AdminSettingItem[]): AdminSettingsResponse {
  return {
    groups: [{ group: "storage", label: "Storage", items }],
    generatedAt: "2026-11-19T00:00:00.000Z",
  };
}

function groupFrom(items: AdminSettingItem[], overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    "storage.endpoint": "http://db-minio:9000",
    "storage.publicEndpoint": "https://db-media.example.com",
    "storage.bucket": "db-bucket",
    "storage.region": "db-region",
    "storage.accessKey": "db-access",
    "storage.secretKey": "db-secret",
    "storage.forcePathStyle": true,
    ...overrides,
  };
  for (const entry of items) {
    const value = entry.isSecret ? entry.secret?.hasValue : entry.value;
    // The stored row stays the source of truth; secret plaintext never appears
    // in the admin projection, so take it from the test override map.
    if (entry.isSecret) {
      values[entry.key] = entry.secret?.hasValue
        ? (overrides[entry.key] ?? `db-${entry.key.split(".")[1]}`)
        : null;
    } else if (value !== null && value !== undefined) {
      values[entry.key] = value;
    }
  }
  return { ...values, ...overrides };
}

function setup(options: {
  items?: AdminSettingItem[];
  groupOverrides?: Record<string, unknown>;
  groupError?: Error;
  registry?: readonly SettingDefinition[];
  providers?: ProviderRuntimeService;
}) {
  const items = options.items ?? [];
  const settings = {
    getGroup: vi.fn(async () => {
      if (options.groupError) {
        throw options.groupError;
      }
      return groupFrom(items, options.groupOverrides);
    }),
    listAdminSettings: vi.fn(async () => {
      if (options.groupError) {
        throw options.groupError;
      }
      return adminResponse(items);
    }),
  };
  const log = logger();
  const consumer = new StorageSettingsConsumer(
    settings as never,
    ENV_SETTINGS,
    log as never,
    options.registry ?? FAKE_REGISTRY,
    options.providers,
  );
  return { consumer, settings, log };
}

function providerRuntime(
  providers: Array<{
    adapter: "s3";
    config: Record<string, unknown>;
    secrets?: Record<string, string>;
  }>,
) {
  const resolveGroup = vi.fn(async () => ({
    policy: {
      group: "storage",
      routingMode: "single",
      maxAttempts: 1,
      cooldownSeconds: 0,
      version: 1,
    },
    providers: providers.map((provider, index) => ({
      id: `storage-provider-${index + 1}`,
      group: "storage",
      adapter: provider.adapter,
      preset: provider.adapter,
      label: "S3",
      priority: (index + 1) * 10,
      config: provider.config,
      secrets: provider.secrets ?? {},
      health: {
        status: "unknown",
        lastCheckedAt: null,
        lastErrorCode: null,
        cooldownUntil: null,
      },
    })),
  }));
  return { resolveGroup } as unknown as ProviderRuntimeService & {
    resolveGroup: typeof resolveGroup;
  };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.S3_ENDPOINT = ENV_SETTINGS.endpoint;
  process.env.S3_PUBLIC_ENDPOINT = ENV_SETTINGS.publicEndpoint ?? "";
  process.env.S3_BUCKET = ENV_SETTINGS.bucket;
  process.env.S3_REGION = ENV_SETTINGS.region;
  process.env.S3_ACCESS_KEY = ENV_SETTINGS.accessKey;
  process.env.S3_SECRET_KEY = ENV_SETTINGS.secretKey;
  process.env.S3_FORCE_PATH_STYLE = "true";
});

describe("StorageSettingsConsumer precedence", () => {
  it("uses the stored database value over env when a row exists", async () => {
    const { consumer } = setup({
      items: [
        item("storage.endpoint", "http://db-minio:9000"),
        item("storage.bucket", "db-bucket"),
      ],
      groupOverrides: { "storage.endpoint": "http://db-minio:9000" },
    });

    const resolved = await consumer.resolve();

    expect(resolved.settings.endpoint).toBe("http://db-minio:9000");
    expect(resolved.settings.bucket).toBe("db-bucket");
    expect(resolved.sources.endpoint).toBe("database");
    expect(resolved.sources.bucket).toBe("database");
    expect(resolved.settings.accessKey).toBe(ENV_SETTINGS.accessKey);
  });

  it("lets an envLocked key win over the database", async () => {
    process.env.S3_BUCKET = "locked-env-bucket";
    const registry = FAKE_REGISTRY.map((entry) =>
      entry.key === "storage.bucket" ? { ...entry, envLocked: true, envVar: "S3_BUCKET" } : entry,
    );
    const { consumer } = setup({
      items: [item("storage.bucket", "db-bucket")],
      groupOverrides: { "storage.bucket": "db-bucket" },
      registry,
    });

    const resolved = await consumer.resolve();

    expect(resolved.settings.bucket).toBe("locked-env-bucket");
    expect(resolved.sources.bucket).toBe("environment");
    expect(resolved.envLockedKeys).toContain("storage.bucket");
  });

  it("falls back to env with a warning when the database is unavailable", async () => {
    const { consumer, log } = setup({ groupError: new Error("db down") });

    const resolved = await consumer.resolve();

    expect(resolved.settings.endpoint).toBe(ENV_SETTINGS.endpoint);
    expect(resolved.settings.bucket).toBe(ENV_SETTINGS.bucket);
    expect(resolved.settings.accessKey).toBe(ENV_SETTINGS.accessKey);
    expect(resolved.warnings).toContain("SETTINGS_UNAVAILABLE");
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fallback: "environment" }),
      "storage.settings_unavailable",
    );
  });

  it("falls back to env when a stored value is empty", async () => {
    const { consumer } = setup({
      items: [item("storage.publicEndpoint", null), item("storage.secretKey", null)],
    });

    const resolved = await consumer.resolve();

    expect(resolved.settings.publicEndpoint).toBe(ENV_SETTINGS.publicEndpoint);
    expect(resolved.settings.secretKey).toBe("env-secret");
    expect(resolved.sources.publicEndpoint).toBe("environment");
    expect(resolved.warnings).toContain("SETTING_EMPTY");
  });

  it("uses env when no row exists and the code default only when env is absent", async () => {
    const { consumer } = setup({
      items: [{ ...item("storage.bucket", "db-bucket"), updatedAt: null }],
    });

    const resolved = await consumer.resolve();

    expect(resolved.settings.bucket).toBe("env-bucket");
    expect(resolved.sources.bucket).toBe("environment");
  });

  it("caches the resolved settings until invalidated", async () => {
    const { consumer, settings } = setup({ items: [] });

    await consumer.resolve();
    await consumer.resolve();
    expect(settings.getGroup).toHaveBeenCalledTimes(1);

    consumer.invalidate();
    await consumer.resolve();
    expect(settings.getGroup).toHaveBeenCalledTimes(2);
  });

  it("changes the version only when a resolved value changes", async () => {
    const items = [item("storage.bucket", "one-bucket")];
    const { consumer } = setup({ items, groupOverrides: { "storage.bucket": "one-bucket" } });
    const first = await consumer.resolve();

    consumer.invalidate();
    const second = await consumer.resolve();
    expect(second.version).toBe(first.version);

    const changed = setup({
      items: [item("storage.bucket", "two-bucket")],
      groupOverrides: { "storage.bucket": "two-bucket" },
    });
    const third = await changed.consumer.resolve();
    expect(third.version).not.toBe(first.version);
  });
});

describe("StorageSettingsConsumer secret hygiene", () => {
  it("never includes credentials in warnings or the resolved object's metadata", async () => {
    process.env.S3_SECRET_KEY = "sentinel-secret-value";
    const { consumer, log } = setup({ groupError: new Error("db down") });

    const resolved = await consumer.resolve();
    const warnings = JSON.stringify(resolved.warnings);
    const logged = JSON.stringify(log.warn.mock.calls);

    expect(warnings).not.toContain("sentinel-secret-value");
    expect(logged).not.toContain("sentinel-secret-value");
    expect(logged).not.toContain(ENV_SETTINGS.accessKey);
  });
});

describe("StorageSettingsConsumer provider mode", () => {
  it("maps the single active S3 Provider and ignores scalar storage rows", async () => {
    process.env.PROVIDER_CONFIG_MODE = "v2";
    const providers = providerRuntime([
      {
        adapter: "s3",
        config: {
          endpoint: "http://provider-minio:9000",
          publicEndpoint: "https://provider-media.example.com",
          bucket: "provider-bucket",
          region: "provider-region",
          forcePathStyle: true,
        },
        secrets: { accessKey: "provider-access", secretKey: "provider-secret" },
      },
    ]);
    const { consumer, settings } = setup({ items: [], providers });

    const resolved = await consumer.resolve();

    expect(resolved.settings.endpoint).toBe("http://provider-minio:9000");
    expect(resolved.settings.publicEndpoint).toBe("https://provider-media.example.com");
    expect(resolved.settings.bucket).toBe("provider-bucket");
    expect(resolved.settings.region).toBe("provider-region");
    expect(resolved.settings.accessKey).toBe("provider-access");
    expect(resolved.settings.secretKey).toBe("provider-secret");
    expect(resolved.sources.endpoint).toBe("database");
    expect(resolved.sources.accessKey).toBe("database");
    expect(resolved.warnings).toEqual([]);
    expect(settings.getGroup).not.toHaveBeenCalled();
  });

  it("returns empty credentials with a warning when the Provider secret is missing", async () => {
    process.env.PROVIDER_CONFIG_MODE = "v2";
    const { consumer } = setup({
      items: [],
      providers: providerRuntime([
        {
          adapter: "s3",
          config: {
            endpoint: "http://provider-minio:9000",
            bucket: "provider-bucket",
            region: "us-east-1",
            forcePathStyle: true,
          },
        },
      ]),
    });

    const resolved = await consumer.resolve();

    expect(resolved.settings.accessKey).toBe("");
    expect(resolved.settings.secretKey).toBe("");
    expect(resolved.warnings).toContain("PROVIDER_SECRET_MISSING");
  });

  it("does not fall back to env credentials when no Provider is active", async () => {
    process.env.PROVIDER_CONFIG_MODE = "v2";
    const { consumer } = setup({ items: [], providers: providerRuntime([]) });

    const resolved = await consumer.resolve();

    expect(resolved.settings.accessKey).toBe("");
    expect(resolved.settings.secretKey).toBe("");
    expect(resolved.warnings).toContain("PROVIDER_NOT_CONFIGURED");
  });

  it("keeps the legacy scalar resolver when the mode is not v2", async () => {
    const providers = providerRuntime([
      {
        adapter: "s3",
        config: {
          endpoint: "http://provider-minio:9000",
          bucket: "provider-bucket",
          region: "us-east-1",
          forcePathStyle: true,
        },
        secrets: { accessKey: "provider-access", secretKey: "provider-secret" },
      },
    ]);
    const { consumer, settings } = setup({ items: [], providers });

    const resolved = await consumer.resolve();

    expect(resolved.settings.bucket).toBe(ENV_SETTINGS.bucket);
    expect(settings.getGroup).toHaveBeenCalled();
    expect(providers.resolveGroup).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});
