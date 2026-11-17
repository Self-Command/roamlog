import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BadRequestException, Injectable } from "@nestjs/common";

import { withTimeout } from "../../common/utils/with-timeout.js";
import type { StorageSettings } from "../../config/storage-settings.js";
import type { PinoLoggerService } from "../observability/pino-logger.service.js";

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

const MAX_SIGNED_URL_TTL_SECONDS = 604_800;

export function createS3Client(settings: StorageSettings): S3Client {
  const clientConfig: S3ClientConfig = {
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKey,
      secretAccessKey: settings.secretKey,
    },
  };

  return new S3Client(clientConfig);
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

@Injectable()
export class StorageService {
  private readonly client: S3Client;

  constructor(
    private readonly settings: StorageSettings,
    private readonly logger: PinoLoggerService,
    client?: S3Client,
  ) {
    this.client = client ?? createS3Client(settings);
  }

  async createPresignedUpload(
    key: string,
    contentType: string,
    expiresInSeconds?: number,
  ): Promise<PresignedUpload> {
    assertStorageKey(key);
    const expiresIn = normalizedTtl(expiresInSeconds, this.settings.signedUrlTtlSeconds);
    const command = new PutObjectCommand({
      Bucket: this.settings.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    this.logger.debug({ bucket: this.settings.bucket, key }, "storage.upload_url_created");

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
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.settings.bucket,
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
    const expiresIn = normalizedTtl(expiresInSeconds, this.settings.signedUrlTtlSeconds);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.settings.bucket,
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
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
      }),
    );
    this.logger.debug({ bucket: this.settings.bucket, key }, "storage.object_deleted");
  }

  async checkHealth(): Promise<void> {
    await withTimeout(
      this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket })),
      2_500,
      "Storage readiness check timed out",
    );
  }
}
