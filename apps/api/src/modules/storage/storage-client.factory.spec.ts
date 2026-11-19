import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageSettings } from "../../config/storage-settings.js";
import type { StorageClientFactory as FactoryType } from "./storage-client.factory.js";
import { StorageClientFactory, STORAGE_CLIENT_RETIRE_DELAY_MS } from "./storage-client.factory.js";
import type { ResolvedStorageConfig } from "../settings/storage-settings.consumer.js";

const ENV_SETTINGS: StorageSettings = {
  endpoint: "http://env-minio:9000",
  publicEndpoint: "https://env-media.example.com",
  bucket: "env-bucket",
  region: "us-east-1",
  accessKey: "env-access",
  secretKey: "env-secret",
  forcePathStyle: true,
  signedUrlTtlSeconds: 900,
};

function resolution(overrides: Partial<StorageSettings> = {}): ResolvedStorageConfig {
  const settings: StorageSettings = {
    ...ENV_SETTINGS,
    bucket: "db-bucket",
    ...overrides,
  };
  return {
    settings,
    version: `version-${settings.bucket}-${settings.endpoint}`,
    sources: {
      endpoint: "database",
      publicEndpoint: "database",
      bucket: "database",
      region: "database",
      accessKey: "database",
      secretKey: "database",
      forcePathStyle: "database",
    },
    envLockedKeys: [],
    warnings: [],
  };
}

function logger() {
  return { warn: vi.fn(), error: vi.fn(), log: vi.fn(), debug: vi.fn() };
}

function fakeClient() {
  return { destroy: vi.fn() } as unknown as S3Client;
}

interface Harness {
  factory: FactoryType;
  resolve: ReturnType<typeof vi.fn>;
  builder: ReturnType<typeof vi.fn>;
  clients: ReturnType<typeof fakeClient>[];
  log: ReturnType<typeof logger>;
  setCurrent(next: ResolvedStorageConfig): void;
}

function setup(initial = resolution()): Harness {
  let current = initial;
  const resolve = vi.fn(async () => current);
  const clients: ReturnType<typeof fakeClient>[] = [];
  const builder = vi.fn(() => {
    const internal = fakeClient();
    const signing = fakeClient();
    clients.push(internal, signing);
    return { internal, public: signing };
  });
  const log = logger();
  const consumer = {
    resolve,
    invalidate: vi.fn(),
    environmentSettings: ENV_SETTINGS,
  };
  const factory = new StorageClientFactory(
    consumer as never,
    ENV_SETTINGS,
    log as never,
    builder as never,
  );
  return {
    factory,
    resolve,
    builder,
    clients,
    log,
    setCurrent(next: ResolvedStorageConfig) {
      current = next;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("StorageClientFactory versioning", () => {
  it("reuses the clients while the settings version is unchanged", async () => {
    const harness = setup();

    const first = await harness.factory.get();
    const second = await harness.factory.get();

    expect(second).toBe(first);
    expect(harness.builder).toHaveBeenCalledTimes(1);
    expect(harness.factory.signingEndpoint).toBe("https://env-media.example.com");
  });

  it("builds new clients and retires the old pair 60s later", async () => {
    vi.useFakeTimers();
    const harness = setup();
    const first = await harness.factory.get();
    const oldInternal = first.internal;
    const destroy = vi.mocked(oldInternal.destroy);

    harness.setCurrent(resolution({ bucket: "next-bucket" }));
    const second = await harness.factory.get();

    expect(second).not.toBe(first);
    expect(second.bucket).toBe("next-bucket");
    expect(harness.builder).toHaveBeenCalledTimes(2);
    expect(destroy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STORAGE_CLIENT_RETIRE_DELAY_MS - 1);
    expect(destroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous clients when the new configuration cannot build", async () => {
    const harness = setup();
    const first = await harness.factory.get();
    harness.builder.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    harness.setCurrent(resolution({ bucket: "broken-bucket" }));
    const second = await harness.factory.get();

    expect(second).toBe(first);
    expect(second.bucket).toBe("db-bucket");
    expect(harness.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ hasPreviousClients: true }),
      "storage.client_build_failed_keeping_previous",
    );
    // Same broken version: no rebuild storm until the settings change again.
    harness.setCurrent(resolution({ bucket: "broken-bucket" }));
    await harness.factory.get();
    expect(harness.builder).toHaveBeenCalledTimes(2);
  });

  it("falls back to the env baseline when no previous client exists", async () => {
    // An invalid endpoint is rejected before the builder is invoked.
    const harness = setup(resolution({ endpoint: "not-a-url" }));

    const bundle = await harness.factory.get();

    expect(bundle.bucket).toBe("env-bucket");
    expect(bundle.settings.endpoint).toBe("http://env-minio:9000");
    expect(harness.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "STORAGE_ENDPOINT_INVALID" }),
      "storage.client_build_failed_keeping_previous",
    );
  });

  it("destroys active and retired clients on module destroy", async () => {
    vi.useFakeTimers();
    const harness = setup();
    const first = await harness.factory.get();
    harness.setCurrent(resolution({ bucket: "next-bucket" }));
    const second = await harness.factory.get();

    await harness.factory.onModuleDestroy();

    expect(vi.mocked(first.internal.destroy)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(second.internal.destroy)).toHaveBeenCalledTimes(1);
  });
});