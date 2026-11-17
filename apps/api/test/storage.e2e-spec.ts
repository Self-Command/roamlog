import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { StorageService, type StorageSettings } from "../src/modules/storage/storage.service.js";
import type { PinoLoggerService } from "../src/modules/observability/pino-logger.service.js";

const settings: StorageSettings = {
  endpoint: "http://localhost:9000",
  bucket: "roamlog-test",
  accessKey: "test-access-key",
  secretKey: "test-secret-key",
  region: "us-east-1",
  forcePathStyle: true,
  signedUrlTtlSeconds: 900,
};

function createLogger(): PinoLoggerService {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  } as unknown as PinoLoggerService;
}

describe("StorageService", () => {
  it("completes an upload by reading the stored object metadata", async () => {
    const send = vi.fn().mockResolvedValue({
      ContentLength: 2048,
      ContentType: "image/jpeg",
      ETag: '"etag-1"',
    });
    const client = { send } as unknown as S3Client;
    const service = new StorageService(settings, createLogger(), client);

    await expect(service.completeUpload("media/trip/photo.jpg")).resolves.toEqual({
      key: "media/trip/photo.jpg",
      size: 2048,
      contentType: "image/jpeg",
      etag: '"etag-1"',
    });

    const command = send.mock.calls[0]?.[0] as HeadObjectCommand;
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "roamlog-test",
      Key: "media/trip/photo.jpg",
    });
  });

  it("creates a presigned upload URL without a network round-trip", async () => {
    const client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.accessKey,
        secretAccessKey: settings.secretKey,
      },
    });
    const service = new StorageService(settings, createLogger(), client);

    const result = await service.createPresignedUpload("media/trip/photo.jpg", "image/jpeg", 60);

    expect(result.method).toBe("PUT");
    expect(result.key).toBe("media/trip/photo.jpg");
    expect(result.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(result.url).toContain("X-Amz-Signature=");
  });

  it("rejects keys that could escape their storage namespace", async () => {
    const service = new StorageService(settings, createLogger(), {
      send: vi.fn(),
    } as unknown as S3Client);

    await expect(service.deleteObject("../private/secret")).rejects.toThrow(
      "Storage keys must be relative object keys",
    );
  });
});
