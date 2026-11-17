import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ExportsService } from "../src/modules/exports/exports.service.js";
import type { ExportRecord } from "../src/modules/exports/export-records.js";
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
  region: process.env.ROAMLOG_STAGING_S3_REGION ?? "us-east-1",
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

describe.skipIf(!enabled)("staging export download URL with real MinIO", () => {
  const exportId = "01942f30-1200-7000-8000-000000000901";
  const workspaceId = "01942f30-1200-7000-8000-000000000902";
  const userId = "01942f30-1200-7000-8000-000000000903";
  const storageKey = `_staging/${randomUUID()}/export.zip`;
  const expiredStorageKey = `_staging/${randomUUID()}/expired-export.zip`;
  const zipBytes = Buffer.from("PK\u0005\u0006".padEnd(22, "\u0000"), "binary");

  beforeAll(async () => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: zipBytes,
        ContentType: "application/zip",
      }),
    );
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: expiredStorageKey,
        Body: zipBytes,
        ContentType: "application/zip",
      }),
    );
  });

  afterAll(async () => {
    await Promise.all(
      [storageKey, expiredStorageKey].map((key) =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined),
      ),
    );
    client.destroy();
  });

  it("returns a short-lived signed URL only while the export is ready and unexpired", async () => {
    const now = new Date();
    const record: ExportRecord = {
      id: exportId,
      workspaceId,
      tripId: null,
      requestedById: userId,
      scope: "workspace",
      format: "zip",
      includeComments: false,
      includeExpenses: true,
      includeMedia: true,
      status: "ready",
      storageKey,
      error: null,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
      createdAt: now,
      completedAt: now,
    };
    const storage = new StorageService(settings, logger());
    const repository = {
      findExport: vi.fn().mockResolvedValue(record),
    };
    const service = new ExportsService(
      repository as never,
      {} as never,
      {} as never,
      storage,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    const detail = await service.get(
      { user: { id: userId }, ip: "127.0.0.1", userAgent: "vitest" } as never,
      exportId,
    );
    expect(detail.status).toBe("ready");
    expect(detail.downloadUrl).toContain("X-Amz-Signature=");
    const response = await fetch(detail.downloadUrl ?? "");
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(zipBytes)).toBe(true);
  });

  it("withholds the download URL after the seven-day expiry and marks the export expired", async () => {
    const now = new Date();
    const expiredRecord: ExportRecord = {
      id: "01942f30-1200-7000-8000-000000000904",
      workspaceId,
      tripId: null,
      requestedById: userId,
      scope: "workspace",
      format: "zip",
      includeComments: false,
      includeExpenses: true,
      includeMedia: true,
      status: "ready",
      storageKey: expiredStorageKey,
      error: null,
      expiresAt: new Date(now.getTime() - 1),
      createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000),
      completedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000),
    };
    const storage = new StorageService(settings, logger());
    const markExpired = vi.fn().mockResolvedValue(undefined);
    const repository = {
      findExport: vi.fn().mockResolvedValue(expiredRecord),
      markExpired,
    };
    const service = new ExportsService(
      repository as never,
      {} as never,
      {} as never,
      storage,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    const detail = await service.get(
      { user: { id: userId }, ip: "127.0.0.1", userAgent: "vitest" } as never,
      expiredRecord.id,
    );

    expect(detail.status).toBe("expired");
    expect(detail.downloadUrl).toBeNull();
    expect(markExpired).toHaveBeenCalledWith(expiredRecord.id);
    const anonymousRead = await fetch(
      `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/${expiredStorageKey}`,
    );
    expect([403, 404]).toContain(anonymousRead.status);
  });
});
