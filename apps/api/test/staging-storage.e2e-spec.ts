import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketPolicyCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PinoLoggerService } from "../src/modules/observability/pino-logger.service.js";
import { StorageService, type StorageSettings } from "../src/modules/storage/storage.service.js";

const enabled = process.env.ROAMLOG_STAGING_SERVICES === "1";
const endpoint = process.env.ROAMLOG_STAGING_S3_ENDPOINT ?? "http://127.0.0.1:9000";
const bucket = process.env.ROAMLOG_STAGING_S3_BUCKET ?? "roamlog-test";
const accessKey = process.env.ROAMLOG_STAGING_S3_ACCESS_KEY ?? "roamlog";
const secretKey = process.env.ROAMLOG_STAGING_S3_SECRET_KEY ?? "roamlog-local-secret";
const settings: StorageSettings = {
  endpoint,
  bucket,
  accessKey,
  secretKey,
  region: env("ROAMLOG_STAGING_S3_REGION", "us-east-1"),
  forcePathStyle: true,
  signedUrlTtlSeconds: 60,
};
const client = new S3Client({
  endpoint,
  region: settings.region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  },
});
const uploadedKeys = new Set<string>();

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function logger(): PinoLoggerService {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  } as unknown as PinoLoggerService;
}

function anonymousUrl(key: string): string {
  return `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/${key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) {
      throw error;
    }
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

describe.skipIf(!enabled)("staging StorageService with real MinIO", () => {
  const service = new StorageService(settings, logger());

  beforeAll(async () => {
    await ensureBucket();
    await service.checkHealth();
  });

  afterAll(async () => {
    for (const key of uploadedKeys) {
      await client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        .catch(() => undefined);
    }
    client.destroy();
  });

  it("presigns, completes, signs reads, blocks anonymous access, and deletes a private object", async () => {
    const key = `_staging/${randomUUID()}/original.png`;
    uploadedKeys.add(key);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    );

    const upload = await service.createPresignedUpload(key, "image/png", 60);
    expect(upload).toMatchObject({
      method: "PUT",
      key,
      headers: { "Content-Type": "image/png" },
    });
    expect(upload.url).toContain("X-Amz-Signature=");

    const put = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: png,
    });
    expect(put.ok).toBe(true);

    const completed = await service.completeUpload(key);
    expect(completed).toMatchObject({
      key,
      size: png.byteLength,
      contentType: "image/png",
    });
    expect(completed.etag).toBeTruthy();

    const signed = await service.createSignedReadUrl(key, 60);
    expect(signed.expiresAt).toBeTruthy();
    const read = await fetch(signed.url);
    expect(read.status).toBe(200);
    expect(Buffer.from(await read.arrayBuffer()).equals(png)).toBe(true);

    const anonymous = await fetch(anonymousUrl(key));
    expect([403, 404]).toContain(anonymous.status);

    await service.deleteObject(key);
    uploadedKeys.delete(key);
    await expect(service.completeUpload(key)).rejects.toMatchObject({
      $metadata: expect.objectContaining({ httpStatusCode: 404 }),
    });
  });

  it("keeps the staging bucket private", async () => {
    await expect(client.send(new GetBucketPolicyCommand({ Bucket: bucket }))).rejects.toMatchObject(
      {
        name: "NoSuchBucketPolicy",
      },
    );
  });
});
