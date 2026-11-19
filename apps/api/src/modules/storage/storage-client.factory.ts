import { Inject, Injectable, Optional } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";

import type { StorageSettings } from "../../config/storage-settings.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import {
  STORAGE_ENV_SETTINGS,
  StorageSettingsConsumer,
  storageConfigVersion,
  type ResolvedStorageConfig,
} from "../settings/storage-settings.consumer.js";
import {
  buildStorageClients,
  resolveSigningEndpoint,
  type BuiltStorageClients,
  type StorageClientBuilder,
} from "./storage-clients.js";

/** How long a replaced client keeps serving in-flight requests. */
export const STORAGE_CLIENT_RETIRE_DELAY_MS = 60_000;

/** DI token so tests (and future plugins) can swap the S3 client builder. */
export const STORAGE_CLIENT_BUILDER = Symbol("roamlog:storage-client-builder");

export type StorageConfigurationErrorCode =
  | "STORAGE_ENDPOINT_INVALID"
  | "STORAGE_PUBLIC_ENDPOINT_INVALID"
  | "STORAGE_BUCKET_MISSING"
  | "STORAGE_REGION_MISSING"
  | "STORAGE_CREDENTIALS_MISSING"
  | "STORAGE_CLIENT_BUILD_FAILED";

export class StorageConfigurationError extends Error {
  constructor(
    readonly code: StorageConfigurationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StorageConfigurationError";
  }
}

export interface StorageClientBundle extends BuiltStorageClients {
  readonly version: string;
  readonly settings: StorageSettings;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
  readonly signingEndpoint: string;
}

interface RetiredBundle {
  readonly bundle: StorageClientBundle;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Holds the currently active pair of S3 clients (internal + browser-facing).
 *
 * A settings change produces a new version and therefore a new pair. The swap
 * is atomic (the field only changes after both clients are built), so a request
 * never observes a half-configured client. The previous pair is kept alive for
 * 60s so requests that already grabbed it can finish, then destroyed.
 *
 * A version that fails validation is remembered and never retried until the
 * settings change again: the previous clients keep working and the deployment
 * is not switched to a configuration that cannot even build. If no client was
 * active yet (startup with bad DB values), the env baseline is built instead.
 */
@Injectable()
export class StorageClientFactory implements OnModuleDestroy {
  private active: StorageClientBundle | null = null;
  private baseline: StorageClientBundle | null = null;
  private pending: Promise<StorageClientBundle | null> | null = null;
  private failedVersion: string | null = null;
  private readonly retired = new Set<RetiredBundle>();
  private readonly builder: StorageClientBuilder;

  constructor(
    @Inject(StorageSettingsConsumer) private readonly consumer: StorageSettingsConsumer,
    @Inject(STORAGE_ENV_SETTINGS) private readonly environment: StorageSettings,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Optional() @Inject(STORAGE_CLIENT_BUILDER) builder?: StorageClientBuilder,
  ) {
    this.builder = builder ?? buildStorageClients;
  }

  /** Last resolved signing origin; sync so diagnostics/tests can read it. */
  get signingEndpoint(): string {
    return this.active?.signingEndpoint ?? resolveSigningEndpoint(this.environment);
  }

  get activeBundle(): StorageClientBundle | null {
    return this.active;
  }

  async get(): Promise<StorageClientBundle> {
    const resolved = await this.consumer.resolve();
    if (this.active && this.active.version === resolved.version) {
      return this.active;
    }
    if (this.failedVersion === resolved.version && this.active) {
      return this.active;
    }

    if (!this.pending) {
      this.pending = this.refresh(resolved).finally(() => {
        this.pending = null;
      });
    }
    const refreshed = await this.pending;
    if (refreshed) {
      return refreshed;
    }
    return this.fallbackToEnvironment();
  }

  async onModuleDestroy(): Promise<void> {
    for (const entry of this.retired) {
      clearTimeout(entry.timer);
      destroyBundle(entry.bundle);
    }
    this.retired.clear();
    if (this.active) {
      destroyBundle(this.active);
      this.active = null;
    }
  }

  private async refresh(resolved: ResolvedStorageConfig): Promise<StorageClientBundle | null> {
    try {
      const bundle = this.build(resolved);
      this.activate(bundle);
      return bundle;
    } catch (error) {
      this.failedVersion = resolved.version;
      this.logger.warn(
        {
          code: error instanceof StorageConfigurationError ? error.code : "STORAGE_CLIENT_BUILD_FAILED",
          version: resolved.version,
          bucket: resolved.settings.bucket,
          endpoint: resolved.settings.endpoint,
          hasPreviousClients: this.active !== null,
        },
        "storage.client_build_failed_keeping_previous",
      );
      return this.active;
    }
  }

  private fallbackToEnvironment(): StorageClientBundle {
    if (this.baseline) {
      if (!this.active) {
        this.activate(this.baseline);
      }
      return this.active ?? this.baseline;
    }

    const settings: StorageSettings = {
      ...this.environment,
      signedUrlTtlSeconds: this.environment.signedUrlTtlSeconds ?? 900,
    };
    const bundle = this.build({
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
      warnings: ["SETTINGS_INVALID"],
    });
    this.baseline = bundle;
    this.logger.warn(
      { version: bundle.version, bucket: bundle.bucket, endpoint: settings.endpoint },
      "storage.clients_fallback_to_environment",
    );
    if (!this.active) {
      this.activate(bundle);
    }
    return bundle;
  }

  private build(resolved: ResolvedStorageConfig): StorageClientBundle {
    assertBuildable(resolved.settings);
    const signingEndpoint = resolveSigningEndpoint(resolved.settings);
    let built: BuiltStorageClients;
    try {
      built = this.builder(resolved.settings, signingEndpoint);
    } catch {
      throw new StorageConfigurationError(
        "STORAGE_CLIENT_BUILD_FAILED",
        "The object-storage clients could not be created.",
      );
    }
    return {
      ...built,
      version: resolved.version,
      settings: resolved.settings,
      bucket: resolved.settings.bucket,
      forcePathStyle: resolved.settings.forcePathStyle,
      signingEndpoint,
    };
  }

  private activate(bundle: StorageClientBundle): void {
    const previous = this.active;
    this.active = bundle;
    this.failedVersion = null;
    if (!previous) {
      this.logger.log(
        {
          version: bundle.version,
          bucket: bundle.bucket,
          endpoint: bundle.settings.endpoint,
          signingEndpoint: bundle.signingEndpoint,
        },
        "storage.clients_ready",
      );
      return;
    }
    this.logger.log(
      {
        version: bundle.version,
        bucket: bundle.bucket,
        endpoint: bundle.settings.endpoint,
        signingEndpoint: bundle.signingEndpoint,
      },
      "storage.clients_reconfigured",
    );
    this.retire(previous);
  }

  private retire(previous: StorageClientBundle): void {
    const entry: RetiredBundle = {
      bundle: previous,
      timer: setTimeout(() => {
        this.retired.delete(entry);
        destroyBundle(previous);
      }, STORAGE_CLIENT_RETIRE_DELAY_MS),
    };
    // Do not keep the process alive only for a pending destroy.
    if (typeof entry.timer.unref === "function") {
      entry.timer.unref();
    }
    this.retired.add(entry);
  }
}

function destroyBundle(bundle: StorageClientBundle): void {
  bundle.internal.destroy();
  bundle.public.destroy();
}

function assertBuildable(settings: StorageSettings): void {
  assertHttpUrl(settings.endpoint, "STORAGE_ENDPOINT_INVALID", "The storage endpoint must be an http(s) URL.");
  if (settings.publicEndpoint !== undefined && settings.publicEndpoint.trim().length > 0) {
    assertHttpUrl(
      settings.publicEndpoint,
      "STORAGE_PUBLIC_ENDPOINT_INVALID",
      "The public storage endpoint must be an http(s) URL.",
    );
  }
  if (!settings.bucket.trim()) {
    throw new StorageConfigurationError("STORAGE_BUCKET_MISSING", "The storage bucket is not configured.");
  }
  if (!settings.region.trim()) {
    throw new StorageConfigurationError("STORAGE_REGION_MISSING", "The storage region is not configured.");
  }
  if (!settings.accessKey || !settings.secretKey) {
    throw new StorageConfigurationError(
      "STORAGE_CREDENTIALS_MISSING",
      "The storage access key and secret key are not configured.",
    );
  }
}

function assertHttpUrl(value: string, code: StorageConfigurationErrorCode, message: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new StorageConfigurationError(code, message);
  }
}
