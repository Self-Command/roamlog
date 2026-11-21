import type { PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { buildSeedDataset } from "../../seed-data.js";
import { seedDemoData } from "../../../seed.js";
import {
  SeedAssetUploadError,
  uploadSeedAssets,
  type SeedAssetS3Client,
} from "../upload-assets.js";

const s3Environment = {
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_ACCESS_KEY: "test-access-key",
  S3_SECRET_KEY: "test-secret-key",
  S3_BUCKET: "test-bucket",
} as const;

function stubS3Environment(): void {
  for (const [name, value] of Object.entries(s3Environment)) {
    vi.stubEnv(name, value);
  }
}

function clearS3Environment(): void {
  for (const name of Object.keys(s3Environment)) {
    vi.stubEnv(name, "");
  }
}

function reachableFetch() {
  return vi.fn(async () => new Response(null, { status: 200 }));
}

function createFakeClient(
  sendImplementation: (command: PutObjectCommand) => Promise<unknown> = async () => ({}),
) {
  const send = vi.fn(sendImplementation);
  const destroy = vi.fn();
  const client = { send, destroy } as unknown as SeedAssetS3Client;
  return { client, send, destroy };
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the operation to reject");
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_SEED_ENABLED", "true");
  vi.stubEnv("ROAMLOG_SEED_S3_UPLOAD", "false");
  stubS3Environment();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("uploadSeedAssets", () => {
  it("uploads every seed object and returns the completed count", async () => {
    const data = buildSeedDataset();
    const { client, send, destroy } = createFakeClient();
    const fetch = reachableFetch();

    const uploaded = await uploadSeedAssets(data, false, { client, fetch });

    expect(uploaded).toBe(data.media.length);
    expect(send).toHaveBeenCalledTimes(data.media.length);
    expect(destroy).toHaveBeenCalledTimes(1);

    const firstCommand = send.mock.calls[0]?.[0];
    expect(firstCommand?.input).toMatchObject({
      Bucket: s3Environment.S3_BUCKET,
      Key: data.media[0]?.key,
      ContentType: data.media[0]?.mimeType,
    });
    expect(Buffer.isBuffer(firstCommand?.input.Body)).toBe(true);
  });

  it("throws a configuration error when S3 settings are missing", async () => {
    clearS3Environment();
    const data = buildSeedDataset();
    const { client, send } = createFakeClient();
    const fetch = reachableFetch();

    const error = await captureError(uploadSeedAssets(data, false, { client, fetch }));

    expect(error).toBeInstanceOf(SeedAssetUploadError);
    expect(error).toMatchObject({
      phase: "configuration",
      uploaded: 0,
      total: data.media.length,
    });
    expect(error.message).toContain("configuration");
    expect(error.message).toContain("S3_ENDPOINT");
    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("throws a file error before uploading when a seed asset is missing", async () => {
    const data = buildSeedDataset();
    const missingData = structuredClone(data);
    const firstMedia = missingData.media[0];
    if (!firstMedia) {
      throw new Error("Seed dataset has no media");
    }
    firstMedia.assetFileName = "missing-seed-asset.jpg";
    const { client, send } = createFakeClient();
    const fetch = reachableFetch();

    const error = await captureError(uploadSeedAssets(missingData, false, { client, fetch }));

    expect(error).toBeInstanceOf(SeedAssetUploadError);
    expect(error).toMatchObject({
      phase: "file",
      fileName: "missing-seed-asset.jpg",
      key: firstMedia.key,
      uploaded: 0,
      total: data.media.length,
    });
    expect(error.message).toContain("missing-seed-asset.jpg");
    expect(error.message).toContain(`0/${data.media.length}`);
    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("throws an endpoint error and preserves the network cause", async () => {
    const data = buildSeedDataset();
    const cause = new Error("ECONNREFUSED 127.0.0.1:9000");
    const fetch = vi.fn(async () => {
      throw cause;
    });
    const { client, send } = createFakeClient();

    const error = await captureError(uploadSeedAssets(data, false, { client, fetch }));

    expect(error).toBeInstanceOf(SeedAssetUploadError);
    expect(error).toMatchObject({
      phase: "endpoint",
      uploaded: 0,
      total: data.media.length,
    });
    expect(error.cause).toBe(cause);
    expect(send).not.toHaveBeenCalled();
  });

  it("throws an upload error with the file, completed count, and original cause", async () => {
    const data = buildSeedDataset();
    const failedItem = data.media[1];
    if (!failedItem) {
      throw new Error("Seed dataset has too few media rows");
    }
    const cause = new Error("S3 PutObject failed");
    let attempts = 0;
    const { client, send, destroy } = createFakeClient(async () => {
      attempts += 1;
      if (attempts === 2) {
        throw cause;
      }
      return {};
    });
    const fetch = reachableFetch();

    const error = await captureError(uploadSeedAssets(data, false, { client, fetch }));

    expect(error).toBeInstanceOf(SeedAssetUploadError);
    expect(error).toMatchObject({
      phase: "upload",
      fileName: failedItem.assetFileName,
      key: failedItem.key,
      uploaded: 1,
      total: data.media.length,
    });
    expect(error.message).toContain(failedItem.assetFileName);
    expect(error.message).toContain(`1/${data.media.length}`);
    expect(error.message).not.toContain(s3Environment.S3_ACCESS_KEY);
    expect(error.message).not.toContain(s3Environment.S3_SECRET_KEY);
    expect(error.cause).toBe(cause);
    expect(send).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("seedDemoData upload orchestration", () => {
  it("does not start the database transaction when seed upload fails", async () => {
    clearS3Environment();
    const transaction = vi.fn();
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    const error = await captureError(seedDemoData(prisma, { quiet: true, uploadAssets: true }));

    expect(error).toBeInstanceOf(SeedAssetUploadError);
    expect(error).toMatchObject({ phase: "configuration" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("keeps the disabled upload path unchanged", async () => {
    clearS3Environment();
    const sentinel = new Error("transaction reached");
    const transaction = vi.fn(async () => {
      throw sentinel;
    });
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    const error = await captureError(seedDemoData(prisma, { quiet: true, uploadAssets: false }));

    expect(error).toBe(sentinel);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
