import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import type { PinoLoggerService } from "../observability/pino-logger.service.js";
import {
  MAX_SIGNED_URL_TTL_SECONDS,
  StorageService,
  type StorageSettings,
} from "./storage.service.js";

const INTERNAL_ENDPOINT = "http://minio:9000";
const PUBLIC_ENDPOINT = "https://media.example.com";

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

function settings(overrides: Partial<StorageSettings> = {}): StorageSettings {
  return {
    endpoint: INTERNAL_ENDPOINT,
    bucket: "roamlog-test",
    accessKey: "test-access-key",
    secretKey: "test-secret-key",
    region: "us-east-1",
    forcePathStyle: true,
    signedUrlTtlSeconds: 900,
    ...overrides,
  };
}

/**
 * The service builds its own clients from `settings` (static credentials), so
 * presigning stays offline and deterministic: no provider-chain lookup.
 */
function createService(overrides: Partial<StorageSettings> = {}): StorageService {
  return new StorageService(settings(overrides), createLogger());
}

function query(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

function expiresIn(url: string): number {
  return Number(query(url).get("X-Amz-Expires"));
}

describe("StorageService signed URL defaults", () => {
  it("prefers MEDIA_SIGNED_URL_TTL_SECONDS for reads and uploads", async () => {
    const service = createService({ signedUrlTtlSeconds: 900, mediaSignedUrlTtlSeconds: 120 });

    const read = await service.createSignedReadUrl("ws/2026/11/media/original.jpg");
    const upload = await service.createPresignedUpload(
      "ws/2026/11/media/original.jpg",
      "image/jpeg",
    );

    expect(expiresIn(read.url)).toBe(120);
    expect(expiresIn(upload.url)).toBe(120);
    expect(read.expiresAt).toBeTruthy();
    expect(upload.expiresAt).toBeTruthy();
  });

  it("falls back to signedUrlTtlSeconds when no media TTL is configured", async () => {
    const service = createService({ signedUrlTtlSeconds: 300 });

    const read = await service.createSignedReadUrl("ws/2026/11/media/original.jpg");

    expect(expiresIn(read.url)).toBe(300);
  });

  it("lets an explicit TTL win over the configured default", async () => {
    const service = createService({ mediaSignedUrlTtlSeconds: 900 });

    const read = await service.createSignedReadUrl("ws/2026/11/media/original.jpg", 60);

    expect(expiresIn(read.url)).toBe(60);
  });

  it("clamps TTLs to the SigV4 seven-day ceiling and a one-second floor", async () => {
    const service = createService();

    const tooLong = await service.createSignedReadUrl("ws/2026/11/media/original.jpg", 999_999);
    const ceiling = await service.createSignedReadUrl(
      "ws/2026/11/media/original.jpg",
      MAX_SIGNED_URL_TTL_SECONDS,
    );
    const zero = await service.createSignedReadUrl("ws/2026/11/media/original.jpg", 0);
    const negative = await service.createSignedReadUrl("ws/2026/11/media/original.jpg", -30);

    expect(MAX_SIGNED_URL_TTL_SECONDS).toBe(604_800);
    expect(expiresIn(tooLong.url)).toBe(MAX_SIGNED_URL_TTL_SECONDS);
    expect(expiresIn(ceiling.url)).toBe(MAX_SIGNED_URL_TTL_SECONDS);
    expect(expiresIn(zero.url)).toBe(1);
    expect(expiresIn(negative.url)).toBe(1);
  });

  it("reports an expiry consistent with the signed lifetime", async () => {
    const service = createService({ mediaSignedUrlTtlSeconds: 120 });

    const before = Date.now();
    const read = await service.createSignedReadUrl("ws/2026/11/media/original.jpg");
    const after = Date.now();

    const expiresAt = Date.parse(read.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 120_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 120_000);
  });
});

describe("StorageService signing endpoint selection", () => {
  it("signs reads and uploads against the public endpoint, not the internal one", async () => {
    const service = createService({ endpoint: INTERNAL_ENDPOINT, publicEndpoint: PUBLIC_ENDPOINT });

    const read = await service.createSignedReadUrl("ws/2026/11/media/original.jpg");
    const upload = await service.createPresignedUpload(
      "ws/2026/11/media/original.jpg",
      "image/jpeg",
    );

    expect(service.signingEndpoint).toBe(PUBLIC_ENDPOINT);
    // The whole point of the second client: the URL the browser opens must be
    // signed for the host it will actually request.
    expect(new URL(read.url).host).toBe("media.example.com");
    expect(new URL(upload.url).host).toBe("media.example.com");
    // Path-style addressing keeps the bucket in the path, so a single media
    // host (no wildcard DNS/certificate) is enough.
    expect(new URL(read.url).pathname.startsWith("/roamlog-test/")).toBe(true);
    expect(query(read.url).get("X-Amz-SignedHeaders")).toBe("host");
    expect(query(upload.url).get("X-Amz-SignedHeaders")).toContain("host");
  });

  it("falls back to the internal endpoint when the public endpoint is unset", async () => {
    const service = createService({ publicEndpoint: undefined });
    const read = await service.createSignedReadUrl("ws/2026/11/media/original.jpg");

    expect(service.signingEndpoint).toBe(INTERNAL_ENDPOINT);
    expect(new URL(read.url).host).toBe("minio:9000");
  });

  it("falls back to the internal endpoint when the public endpoint is blank", async () => {
    for (const publicEndpoint of ["", "   ", "\t"]) {
      const service = createService({ publicEndpoint });
      expect(service.signingEndpoint).toBe(INTERNAL_ENDPOINT);
    }
  });

  it("normalizes trailing slashes on both endpoints", async () => {
    const service = createService({
      endpoint: `${INTERNAL_ENDPOINT}/`,
      publicEndpoint: `${PUBLIC_ENDPOINT}/`,
    });

    const read = await service.createSignedReadUrl("ws/2026/11/media/original.jpg");

    expect(service.signingEndpoint).toBe(PUBLIC_ENDPOINT);
    expect(new URL(read.url).host).toBe("media.example.com");
    expect(new URL(read.url).pathname).not.toContain("//");
  });

  it("binds the signature to the host, so the same key signs differently per endpoint", async () => {
    const key = "ws/2026/11/media/original.jpg";
    const internal = createService({ publicEndpoint: undefined });
    const external = createService({ publicEndpoint: PUBLIC_ENDPOINT });

    const internalUrl = await internal.createSignedReadUrl(key, 900);
    const externalUrl = await external.createSignedReadUrl(key, 900);

    expect(query(internalUrl.url).get("X-Amz-Signature")).not.toBe(
      query(externalUrl.url).get("X-Amz-Signature"),
    );
  });
});

describe("StorageService internal operations", () => {
  it("uses the internal client for metadata, deletes and health checks", async () => {
    const send = vi.fn().mockResolvedValue({ ContentLength: 1, ContentType: "image/png" });
    const internal = { send } as unknown as S3Client;
    const service = new StorageService(
      settings({ publicEndpoint: PUBLIC_ENDPOINT }),
      createLogger(),
      internal,
    );

    await service.completeUpload("ws/2026/11/media/original.png");
    await service.deleteObject("ws/2026/11/media/original.png");
    await service.checkHealth();

    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not touch the internal client when only signing", async () => {
    const send = vi.fn();
    const service = new StorageService(
      settings({ publicEndpoint: PUBLIC_ENDPOINT }),
      createLogger(),
      { send } as unknown as S3Client,
    );

    await service.createSignedReadUrl("ws/2026/11/media/original.jpg");
    await service.createPresignedUpload("ws/2026/11/media/original.jpg", "image/jpeg");

    expect(send).not.toHaveBeenCalled();
  });
});

describe("StorageService key validation", () => {
  const invalidKeys = ["", "/absolute/key", "../escape", "ws//double", "ws/./dot", "back\\slash"];

  it("rejects keys that could escape their namespace before signing", async () => {
    const service = createService();

    for (const key of invalidKeys) {
      await expect(service.createSignedReadUrl(key)).rejects.toThrow(
        "Storage keys must be relative object keys",
      );
      await expect(service.createPresignedUpload(key, "image/jpeg")).rejects.toThrow(
        "Storage keys must be relative object keys",
      );
      await expect(service.deleteObject(key)).rejects.toThrow(
        "Storage keys must be relative object keys",
      );
    }
  });

  it("rejects keys containing control characters", async () => {
    const service = createService();

    await expect(service.createSignedReadUrl("ws/2026/media\u0000.jpg")).rejects.toThrow(
      "Storage keys must be relative object keys",
    );
  });
});
describe("StorageService settings-driven clients", () => {
  it("presigns against the factory's current public endpoint and bucket", async () => {
    const internal = { send: vi.fn() } as unknown as S3Client;
    const signing = new S3Client({
      region: "us-east-1",
      endpoint: "https://current-media.example.com",
      forcePathStyle: true,
      credentials: { accessKeyId: "access", secretAccessKey: "secret" },
    });
    const factory = {
      signingEndpoint: "https://current-media.example.com",
      get: vi.fn(async () => ({
        version: "v2",
        internal,
        public: signing,
        bucket: "factory-bucket",
        forcePathStyle: true,
        signingEndpoint: "https://current-media.example.com",
        settings: settings({ publicEndpoint: "https://current-media.example.com" }),
      })),
    };
    const service = new StorageService(settings(), createLogger(), undefined, undefined, factory);

    const read = await service.createSignedReadUrl("ws/2026/11/media/original.jpg");

    expect(service.signingEndpoint).toBe("https://current-media.example.com");
    expect(new URL(read.url).host).toBe("current-media.example.com");
    expect(new URL(read.url).pathname.startsWith("/factory-bucket/")).toBe(true);
    expect(factory.get).toHaveBeenCalledTimes(1);
  });
});

describe("StorageService per-object bucket", () => {
  it("signs a read URL against the explicit bucket override", async () => {
    const service = createService({ publicEndpoint: PUBLIC_ENDPOINT });

    const read = await service.createSignedReadUrl(
      "ws/2026/11/media/original.jpg",
      undefined,
      "roamlog-bucket-a",
    );

    expect(new URL(read.url).pathname.startsWith("/roamlog-bucket-a/")).toBe(true);
    expect(new URL(read.url).host).toBe("media.example.com");
  });

  it("presigns an upload against the explicit bucket override", async () => {
    const service = createService({ publicEndpoint: PUBLIC_ENDPOINT });

    const upload = await service.createPresignedUpload(
      "ws/2026/11/media/original.jpg",
      "image/jpeg",
      undefined,
      "roamlog-bucket-a",
    );

    expect(new URL(upload.url).pathname.startsWith("/roamlog-bucket-a/")).toBe(true);
    expect(new URL(upload.url).host).toBe("media.example.com");
  });

  it("HEADs the explicit bucket on completion", async () => {
    const send = vi.fn().mockResolvedValue({ ContentLength: 1, ContentType: "image/png" });
    const service = new StorageService(settings(), createLogger(), {
      send,
    } as unknown as S3Client);

    await service.completeUpload("ws/2026/11/media/original.png", "roamlog-bucket-a");

    const command = send.mock.calls[0]?.[0] as HeadObjectCommand;
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command.input.Bucket).toBe("roamlog-bucket-a");
  });

  it("falls back to the configured bucket for blank overrides", async () => {
    const service = createService({ bucket: "roamlog-current", publicEndpoint: PUBLIC_ENDPOINT });

    for (const bucket of [undefined, "", "   "]) {
      const read = await service.createSignedReadUrl("ws/2026/11/media/original.jpg", undefined, bucket);
      expect(new URL(read.url).pathname.startsWith("/roamlog-current/")).toBe(true);
    }
  });

  it("reports the current bucket from the injected provider", async () => {
    const factory = {
      signingEndpoint: "https://current-media.example.com",
      get: vi.fn(async () => ({
        version: "v2",
        internal: { send: vi.fn() } as unknown as S3Client,
        public: new S3Client({
          region: "us-east-1",
          endpoint: "https://current-media.example.com",
          forcePathStyle: true,
          credentials: { accessKeyId: "access", secretAccessKey: "secret" },
        }),
        bucket: "factory-bucket",
        forcePathStyle: true,
        signingEndpoint: "https://current-media.example.com",
        settings: settings({ publicEndpoint: "https://current-media.example.com" }),
      })),
    };

    const service = new StorageService(settings(), createLogger(), undefined, undefined, factory);

    await expect(service.currentBucket()).resolves.toBe("factory-bucket");
  });

  it("reports the static settings bucket without a provider", async () => {
    const service = createService({ bucket: "static-bucket" });
    await expect(service.currentBucket()).resolves.toBe("static-bucket");
  });
});
