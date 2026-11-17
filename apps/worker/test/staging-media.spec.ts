import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createImageProcessor, createStorage } from "../src/dependencies.js";
import { handleMediaJob } from "../src/jobs/media.js";
import type { WorkerDependencies } from "../src/jobs/types.js";
import {
  configureWorkerStorageEnvironment,
  createStagingS3Client,
  deleteStagingObject,
  ensureStagingBucket,
  stagingContext,
  stagingEnabled,
} from "./staging-helpers.js";

describe.skipIf(!stagingEnabled)("staging media worker: real MinIO and sharp", () => {
  const config = configureWorkerStorageEnvironment();
  const client = createStagingS3Client(config);
  const objects = new Set<string>();

  beforeAll(async () => {
    await ensureStagingBucket(client, config.bucket);
  });

  afterAll(async () => {
    for (const key of objects) {
      await deleteStagingObject(client, config.bucket, key);
    }
    client.destroy();
  });

  it("processes an uploaded image into WebP and JPEG variants with blurhash", async () => {
    const mediaId = randomUUID();
    const workspaceId = randomUUID();
    const key = `${workspaceId}/2026/11/${mediaId}/original.jpg`;
    objects.add(key);
    const source = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: { r: 25, g: 45, b: 70 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    const storage = createStorage();
    await storage.putObject(key, source, "image/jpeg");

    let record: Record<string, unknown> = {
      id: mediaId,
      workspaceId,
      key,
      mimeType: "image/jpeg",
      size: source.byteLength,
      status: "processing",
      deletedAt: null,
    };
    const updates: Array<{ data: Record<string, unknown> }> = [];
    const db = {
      media: {
        findFirst: vi.fn(async () => record),
        updateMany: vi.fn(
          async ({ data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            updates.push({ data });
            record = { ...record, ...data };
            return { count: 1 };
          },
        ),
      },
    };
    const deps = {
      db,
      storage,
      images: createImageProcessor(),
      email: {
        send: vi.fn(),
        render: vi.fn(),
      },
      now: () => new Date(),
      logger: stagingContext("staging-media").logger,
    } satisfies WorkerDependencies;

    const result = await handleMediaJob(
      "media.process",
      { mediaId, workspaceId },
      stagingContext(`staging-media-${mediaId}`),
      deps,
    );

    expect(result).toEqual({ status: "ready", mediaId });
    expect(record.status).toBe("ready");
    expect(record.width).toBe(1600);
    expect(record.height).toBe(900);
    expect(typeof record.blurhash).toBe("string");
    expect(String(record.blurhash).length).toBeGreaterThan(10);

    const variants = record.variants as Record<
      string,
      { key: string; mimeType: string; size: number; width: number }
    >;
    expect(Object.keys(variants).sort()).toEqual([
      "large",
      "largeJpeg",
      "medium",
      "mediumJpeg",
      "original",
      "thumb",
      "thumbJpeg",
    ]);

    for (const [name, variant] of Object.entries(variants)) {
      objects.add(variant.key);
      const object = await storage.getObject(variant.key);
      expect(object.bytes.byteLength).toBe(variant.size);
      const metadata = await sharp(Buffer.from(object.bytes)).metadata();
      if (variant.mimeType === "image/webp") {
        expect(metadata.format).toBe("webp");
      } else if (variant.mimeType === "image/jpeg") {
        expect(metadata.format).toBe("jpeg");
      }
      if (name !== "original") {
        expect(metadata.width).toBeLessThanOrEqual(variant.width);
      }
    }

    const finalUpdate = updates.at(-1)?.data;
    expect(finalUpdate).toMatchObject({
      status: "ready",
      width: 1600,
      height: 900,
      error: null,
    });
  });
});
