import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageSettings } from "../../config/storage-settings.js";
import type { ResolvedStorageConfig } from "../settings/storage-settings.consumer.js";
import { StorageProbeService, STORAGE_PROBE_BODY } from "./storage-probe.service.js";

const SETTINGS: StorageSettings = {
  endpoint: "http://127.0.0.1:19999",
  publicEndpoint: "https://media.example.com",
  bucket: "roamlog-probe",
  region: "us-east-1",
  accessKey: "AKIA_SENTINEL_ACCESS",
  secretKey: "SENTINEL_SECRET_VALUE",
  forcePathStyle: true,
  signedUrlTtlSeconds: 900,
};

function resolution(overrides: Partial<StorageSettings> = {}): ResolvedStorageConfig {
  return {
    settings: { ...SETTINGS, ...overrides },
    version: "v-probe",
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
    warnings: [],
  };
}

function logger() {
  return { warn: vi.fn(), error: vi.fn(), log: vi.fn(), debug: vi.fn() };
}

function sdkError(name: string, status: number): Error {
  const error = new Error(name) as Error & { $metadata: { httpStatusCode: number } };
  error.name = name;
  error.$metadata = { httpStatusCode: status };
  return error;
}

function setup(options: { resolved?: ResolvedStorageConfig } = {}) {
  const internal = new S3Client({
    region: SETTINGS.region,
    endpoint: SETTINGS.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: SETTINGS.accessKey, secretAccessKey: SETTINGS.secretKey },
  });
  const publicClient = new S3Client({
    region: SETTINGS.region,
    endpoint: SETTINGS.publicEndpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: SETTINGS.accessKey, secretAccessKey: SETTINGS.secretKey },
  });
  const send = vi.fn(async (_command: unknown): Promise<unknown> => ({}));
  vi.spyOn(internal, "send").mockImplementation(send as never);
  const consumer = {
    resolve: vi.fn(async () => options.resolved ?? resolution()),
    invalidate: vi.fn(),
    environmentSettings: SETTINGS,
  };
  const log = logger();
  const probe = new StorageProbeService(
    consumer as never,
    log as never,
    (() => ({ internal, public: publicClient })) as never,
  );
  return { probe, send, log, consumer };
}

function happyPath(send: ReturnType<typeof vi.fn>): void {
  send.mockImplementation(async (command: unknown) => {
    if (command instanceof HeadBucketCommand) return {};
    if (command instanceof PutObjectCommand) return { ETag: '"etag"' };
    if (command instanceof GetObjectCommand) {
      return { Body: { transformToByteArray: async () => new TextEncoder().encode(STORAGE_PROBE_BODY) } };
    }
    return {};
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StorageProbeService success path", () => {
  it("runs all five checks and returns the bucket coordinates", async () => {
    const { probe, send } = setup();
    happyPath(send);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(STORAGE_PROBE_BODY, { status: 200 })));

    const result = await probe.run();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a successful probe");
    expect(result.checks.map((check) => check.name)).toEqual([
      "HeadBucket",
      "PutObject",
      "GetObject",
      "PresignedGet",
      "DeleteObject",
    ]);
    expect(result.checks.every((check) => check.ok && check.ms >= 0)).toBe(true);
    expect(result.bucket).toBe("roamlog-probe");
    expect(result.endpoint).toBe("http://127.0.0.1:19999");
    expect(result.publicEndpoint).toBe("https://media.example.com");
  });

  it("signs the presigned URL for the configured public endpoint", async () => {
    const { probe, send } = setup();
    happyPath(send);
    const fetchMock = vi.fn(async (_url: string) => new Response(STORAGE_PROBE_BODY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await probe.run();

    const requested = new URL(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(requested.host).toBe("media.example.com");
    expect(requested.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});

describe("StorageProbeService failure paths", () => {
  it("stops at HeadBucket and maps credentials rejections", async () => {
    const { probe, send } = setup();
    send.mockRejectedValueOnce(sdkError("AccessDenied", 403));

    const result = await probe.run();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed probe");
    expect(result.failedAt).toBe("HeadBucket");
    expect(result.code).toBe("STORAGE_CREDENTIALS_REJECTED");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ name: "HeadBucket", ok: false });
  });

  it("stops at PutObject and keeps the successful HeadBucket check", async () => {
    const { probe, send } = setup();
    send.mockResolvedValueOnce({});
    send.mockRejectedValueOnce(sdkError("AccessDenied", 403));

    const result = await probe.run();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed probe");
    expect(result.failedAt).toBe("PutObject");
    expect(result.code).toBe("STORAGE_WRITE_DENIED");
    expect(result.checks.map((check) => check.name)).toEqual(["HeadBucket", "PutObject"]);
  });

  it("reports a read-back mismatch without leaking the object key", async () => {
    const { probe, send } = setup();
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof PutObjectCommand) return {};
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => new TextEncoder().encode("tampered") } };
      }
      return {};
    });

    const result = await probe.run();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed probe");
    expect(result.failedAt).toBe("GetObject");
    expect(result.code).toBe("STORAGE_READ_MISMATCH");
    expect(JSON.stringify(result)).not.toContain("_probe/");
  });

  it("marks the public endpoint unreachable when the presigned fetch fails", async () => {
    const { probe, send } = setup();
    happyPath(send);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));

    const result = await probe.run();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed probe");
    expect(result.failedAt).toBe("PresignedGet");
    expect(result.code).toBe("STORAGE_PUBLIC_ENDPOINT_UNREACHABLE");
    expect(result.publicEndpointUnreachable).toBe(true);
    // The probe object is still cleaned up after the signed URL fails.
    expect(send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    expect(
      send.mock.calls.some(
        ([command]) =>
          (command as { constructor?: { name?: string } }).constructor?.name === "DeleteObjectCommand",
      ),
    ).toBe(true);
  });

  it("reports a 403 from the presigned URL as a signature failure, not unreachable", async () => {
    const { probe, send } = setup();
    happyPath(send);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("AccessDenied", { status: 403 })));

    const result = await probe.run();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed probe");
    expect(result.failedAt).toBe("PresignedGet");
    expect(result.code).toBe("STORAGE_SIGNED_READ_FAILED");
    expect(result.publicEndpointUnreachable).toBeUndefined();
  });
});

describe("StorageProbeService secret hygiene", () => {
  it("never returns or logs the access/secret keys, or the presigned URL", async () => {
    const { probe, send, log } = setup();
    happyPath(send);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(STORAGE_PROBE_BODY, { status: 200 })));

    const result = await probe.run();
    const serialized = JSON.stringify(result);
    const logged = JSON.stringify(log.warn.mock.calls) + JSON.stringify(log.log.mock.calls);

    expect(serialized).not.toContain(SETTINGS.accessKey);
    expect(serialized).not.toContain(SETTINGS.secretKey);
    expect(logged).not.toContain(SETTINGS.accessKey);
    expect(logged).not.toContain(SETTINGS.secretKey);
    expect(serialized).not.toContain("X-Amz-Signature");
  });

  it("does not echo credentials through failing-endpoint errors", async () => {
    const { probe, send, log } = setup();
    send.mockRejectedValue(sdkError("AccessDenied", 403));
    vi.stubGlobal("fetch", vi.fn());

    const result = await probe.run();
    const serialized = JSON.stringify(result);
    const logged = JSON.stringify(log.warn.mock.calls);

    expect(serialized).not.toContain(SETTINGS.accessKey);
    expect(serialized).not.toContain(SETTINGS.secretKey);
    expect(logged).not.toContain(SETTINGS.accessKey);
    expect(logged).not.toContain(SETTINGS.secretKey);
  });
});