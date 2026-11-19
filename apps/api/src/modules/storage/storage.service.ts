import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";

import { withTimeout } from "../../common/utils/with-timeout.js";
import type { StorageSettings } from "../../config/storage-settings.js";
import type { PinoLoggerService } from "../observability/pino-logger.service.js";
import {
  createS3Client,
  normalizedEndpoint,
  resolveSigningEndpoint,
} from "./storage-clients.js";
import type { StorageClientBundle } from "./storage-client.factory.js";

export { createS3Client } from "./storage-clients.js";
export type { StorageSettings } from "../../config/storage-settings.js";

export interface PresignedUpload {
  url: string;
  method: "PUT";
  key: string;
  headers: {
    "Content-Type": string;
  };
  expiresAt: string;
}

export interface SignedReadUrl {
  url: string;
  key: string;
  expiresAt: string;
}

export interface CompletedUpload {
  key: string;
  size: number;
  contentType: string;
  etag: string | undefined;
}

/** Hard ceiling for a presigned URL (AWS SigV4 limit is seven days). */
const MAX_SIGNED_URL_TTL_SECONDS = 604_800;

export { MAX_SIGNED_URL_TTL_SECONDS };

/** The minimal seam `StorageService` needs from {@link StorageClientFactory}. */
export interface StorageClientProvider {
  get(): Promise<StorageClientBundle>;
  readonly signingEndpoint: string;
}

interface ClientBundle {
  readonly internal: S3Client;
  readonly signing: S3Client;
  readonly bucket: string;
  readonly ttl: { signedUrlTtlSeconds: number; mediaSignedUrlTtlSeconds?: number };
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) {
      return true;
    }
  }
  return false;
}

function assertStorageKey(key: string): void {
  const hasInvalidSegment = key
    .split("/")
    .some((segment) => !segment || segment === "." || segment === "..");
  if (
    !key ||
    key.length > 1_024 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    hasInvalidSegment ||
    hasControlCharacter(key)
  ) {
    throw new BadRequestException("Storage keys must be relative object keys");
  }
}

function normalizedTtl(requested: number | undefined, fallback: number): number {
  const value = requested ?? fallback;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_SIGNED_URL_TTL_SECONDS);
}

/**
 * Thin wrapper over the S3 SDK with two clients on purpose.
 *
 * SigV4 presigned URLs sign the `Host` header, so an URL signed for
 * `http://minio:9000` is rejected by MinIO when a browser reaches it through
 * `https://media.example.com` (the signature no longer matches the canonical
 * request). The service therefore keeps:
 *
 * - `internal` — talks to `settings.endpoint` (container-internal) for every
 *   server-side call: HEAD, DELETE, bucket health.
 * - `signing` — builds presigned GET/PUT URLs against
 *   `settings.publicEndpoint` (the browser-facing origin). The reverse proxy in
 *   front of MinIO must forward the original `Host` header, or validation fails
 *   again.
 *
 * When a factory is injected (Nest runtime), both clients and the bucket come
 * from the current settings version on every operation, so an admin change to
 * `storage.*` takes effect without a restart. Direct construction keeps the
 * original static behaviour (tests, scripts).
 */
@Injectable()
export class StorageService {
  private readonly staticBundle: ClientBundle | null;

  constructor(
    private readonly settings: StorageSettings,
    private readonly logger: PinoLoggerService,
    client?: S3Client,
    signingClient?: S3Client,
    private readonly factory?: StorageClientProvider,
  ) {
    if (factory) {
      this.staticBundle = null;
    } else {
      const internal = client ?? createS3Client(settings);
      const signingEndpoint = resolveSigningEndpoint(settings);
      this.staticBundle = {
        internal,
        signing: signingClient ?? createS3Client(settings, signingEndpoint),
        bucket: settings.bucket,
        ttl: {
          signedUrlTtlSeconds: settings.signedUrlTtlSeconds,
          mediaSignedUrlTtlSeconds: settings.mediaSignedUrlTtlSeconds,
        },
      };
      this.logger.debug(
        {
          endpoint: normalizedEndpoint(settings.endpoint),
          signingEndpoint,
        },
        "storage.clients_ready",
      );
    }
  }

  /** Origin used for presigning; always the *current* browser-facing origin. */
  get signingEndpoint(): string {
    if (this.factory) {
      return this.factory.signingEndpoint;
    }
    return resolveSigningEndpoint(this.settings);
  }

  /** Default lifetime for media URLs (`MEDIA_SIGNED_URL_TTL_SECONDS` first). */
  private get defaultTtlSeconds(): number {
    const settings = this.factory ? undefined : this.settings;
    return settings?.mediaSignedUrlTtlSeconds ?? settings?.signedUrlTtlSeconds ?? 900;
  }

  private async bundle(): Promise<ClientBundle> {
    if (this.factory) {
      const current = await this.factory.get();
      return {
        internal: current.internal,
        signing: current.public,
        bucket: current.bucket,
        ttl: {
          signedUrlTtlSeconds: current.settings.signedUrlTtlSeconds,
          ...(current.settings.mediaSignedUrlTtlSeconds !== undefined
            ? { mediaSignedUrlTtlSeconds: current.settings.mediaSignedUrlTtlSeconds }
            : {}),
        },
      };
    }
    if (!this.staticBundle) {
      throw new ServiceUnavailableException({
        code: "STORAGE_UNAVAILABLE",
        message: "Object storage is not configured.",
      });
    }
    return this.staticBundle;
  }

  private ttlFor(bundle: ClientBundle, requested: number | undefined): number {
    const fallback =
      bundle.ttl.mediaSignedUrlTtlSeconds ?? bundle.ttl.signedUrlTtlSeconds ?? this.defaultTtlSeconds;
    return normalizedTtl(requested, fallback);
  }

  async createPresignedUpload(
    key: string,
    contentType: string,
    expiresInSeconds?: number,
  ): Promise<PresignedUpload> {
    assertStorageKey(key);
    const bundle = await this.bundle();
    const expiresIn = this.ttlFor(bundle, expiresInSeconds);
    const command = new PutObjectCommand({
      Bucket: bundle.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(bundle.signing, command, { expiresIn });
    this.logger.debug(
      { bucket: bundle.bucket, key, signingEndpoint: this.signingEndpoint },
      "storage.upload_url_created",
    );

    return {
      url,
      method: "PUT",
      key,
      headers: {
        "Content-Type": contentType,
      },
      expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    };
  }

  async completeUpload(key: string): Promise<CompletedUpload> {
    assertStorageKey(key);
    const bundle = await this.bundle();
    const result = await bundle.internal.send(
      new HeadObjectCommand({
        Bucket: bundle.bucket,
        Key: key,
      }),
    );

    return {
      key,
      size: result.ContentLength ?? 0,
      contentType: result.ContentType ?? "application/octet-stream",
      etag: result.ETag,
    };
  }

  async createSignedReadUrl(key: string, expiresInSeconds?: number): Promise<SignedReadUrl> {
    assertStorageKey(key);
    const bundle = await this.bundle();
    const expiresIn = this.ttlFor(bundle, expiresInSeconds);
    const url = await getSignedUrl(
      bundle.signing,
      new GetObjectCommand({
        Bucket: bundle.bucket,
        Key: key,
      }),
      { expiresIn },
    );

    return {
      url,
      key,
      expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    };
  }

  async deleteObject(key: string): Promise<void> {
    assertStorageKey(key);
    const bundle = await this.bundle();
    await bundle.internal.send(
      new DeleteObjectCommand({
        Bucket: bundle.bucket,
        Key: key,
      }),
    );
    this.logger.debug({ bucket: bundle.bucket, key }, "storage.object_deleted");
  }

  async checkHealth(): Promise<void> {
    const bundle = await this.bundle();
    await withTimeout(
      bundle.internal.send(new HeadBucketCommand({ Bucket: bundle.bucket })),
      2_500,
      "Storage readiness check timed out",
    );
  }
}