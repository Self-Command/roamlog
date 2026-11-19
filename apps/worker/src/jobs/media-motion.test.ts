import { describe, expect, it, vi } from "vitest";

import {
  handleMediaJob,
  motionThumbnailKey,
  type MediaJobData,
  type MotionThumbnailExtractor,
} from "./media.js";
import type { ProcessorContext } from "../processor.js";
import type { WorkerDependencies } from "./types.js";

const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const MEDIA_KEY = `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/original.jpg`;
const MOTION_KEY = `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/motion.mov`;

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function context(): ProcessorContext & { warnings: unknown[]; errors: unknown[] } {
  const warnings: unknown[] = [];
  const errors: unknown[] = [];
  const sink = (bucket: unknown[]) => (payload: unknown, message: string) => {
    bucket.push({ payload, message });
  };
  return {
    jobId: "job-1",
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: sink(warnings) as never,
      error: sink(errors) as never,
    },
    warnings,
    errors,
  } as unknown as ProcessorContext & { warnings: unknown[]; errors: unknown[] };
}

interface FakeOptions {
  motion?: Record<string, unknown> | null;
  extractor?: MotionThumbnailExtractor;
}

function fakeDeps(options: FakeOptions = {}) {
  const mediaRows = [
    {
      id: MEDIA_ID,
      workspaceId: WORKSPACE_ID,
      key: MEDIA_KEY,
      mimeType: "image/jpeg",
      status: "processing",
      variants: {},
      deletedAt: null,
    },
  ];
  const motionRows = options.motion === undefined ? [] : options.motion ? [options.motion] : [];
  const mediaUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const motionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const putObject = vi.fn().mockResolvedValue(undefined);

  const deps = {
    db: {
      media: {
        findFirst: vi.fn(async () => mediaRows[0]),
        updateMany: mediaUpdateMany,
      },
      mediaMotion: {
        findFirst: vi.fn(async () => motionRows[0] ?? null),
        updateMany: motionUpdateMany,
      },
    },
    storage: {
      getObject: vi.fn(async (key: string) =>
        key === MOTION_KEY
          ? { bytes: new Uint8Array([0, 0, 0, 1]), contentType: "video/quicktime" }
          : { bytes: JPEG_BYTES, contentType: "image/jpeg" },
      ),
      putObject,
      deleteObject: vi.fn().mockResolvedValue(undefined),
    },
    images: {
      process: vi.fn(async () => ({ width: 800, height: 600, blurhash: "LEHV6n", variants: [] })),
    },
    email: { send: vi.fn(), render: vi.fn() },
    now: () => new Date("2026-11-19T08:00:00.000Z"),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...(options.extractor ? { video: options.extractor } : {}),
  } as unknown as WorkerDependencies;

  return { deps, mediaUpdateMany, motionUpdateMany, putObject };
}

const data: MediaJobData = { mediaId: MEDIA_ID, workspaceId: WORKSPACE_ID };

describe("media job — Live Photo motion", () => {
  it("keeps the still ready and skips the thumbnail when ffmpeg is unavailable", async () => {
    const extractor: MotionThumbnailExtractor = {
      available: () => false,
      extract: vi.fn(),
    };
    const { deps, mediaUpdateMany, motionUpdateMany, putObject } = fakeDeps({
      motion: { id: "m-1", mediaId: MEDIA_ID, storageKey: MOTION_KEY, thumbKey: null, mimeType: "video/quicktime", durationMs: 2400, deletedAt: null },
      extractor,
    });
    const ctx = context();

    await expect(handleMediaJob("media.process", data, ctx, deps)).resolves.toEqual({
      status: "ready",
      mediaId: MEDIA_ID,
    });

    // The still reached `ready`; the missing binary did not fail the job.
    expect(mediaUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ready" }) }),
    );
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(motionUpdateMany).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
    expect(ctx.warnings).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ reason: "ffmpeg-unavailable", mediaId: MEDIA_ID }),
      }),
    ]);
    expect(ctx.errors).toEqual([]);
  });

  it("writes the extracted first frame and records thumbKey", async () => {
    const bytes = new Uint8Array([82, 73, 70, 70]);
    const extractor: MotionThumbnailExtractor = {
      available: () => true,
      extract: vi.fn(() => ({ bytes, width: 640, height: 360 })),
    };
    const { deps, motionUpdateMany, putObject } = fakeDeps({
      motion: { id: "m-1", mediaId: MEDIA_ID, storageKey: MOTION_KEY, thumbKey: null, mimeType: "video/quicktime", durationMs: 2400, deletedAt: null },
      extractor,
    });
    const ctx = context();

    await expect(handleMediaJob("media.process", data, ctx, deps)).resolves.toEqual({
      status: "ready",
      mediaId: MEDIA_ID,
    });

    const thumbKey = motionThumbnailKey(MOTION_KEY);
    expect(thumbKey).toBe(`${WORKSPACE_ID}/2026/11/${MEDIA_ID}/motion-thumb.webp`);
    expect(putObject).toHaveBeenCalledWith(thumbKey, bytes, "image/webp");
    expect(motionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ thumbKey }) }),
    );
    expect(ctx.warnings).toEqual([]);
  });

  it("leaves an ordinary image untouched when no motion row exists", async () => {
    const extractor: MotionThumbnailExtractor = {
      available: () => true,
      extract: vi.fn(),
    };
    const { deps, motionUpdateMany, putObject } = fakeDeps({ motion: null, extractor });
    const ctx = context();

    await expect(handleMediaJob("media.process", data, ctx, deps)).resolves.toEqual({
      status: "ready",
      mediaId: MEDIA_ID,
    });
    expect(extractor.available).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(motionUpdateMany).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it("never blocks the still when the motion object cannot be read", async () => {
    const extractor: MotionThumbnailExtractor = {
      available: () => true,
      extract: vi.fn(),
    };
    const { deps } = fakeDeps({
      motion: { id: "m-1", mediaId: MEDIA_ID, storageKey: MOTION_KEY, thumbKey: null, mimeType: "video/quicktime", durationMs: 2400, deletedAt: null },
      extractor,
    });
    (deps.storage.getObject as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("S3 unavailable"),
    );
    const ctx = context();

    await expect(handleMediaJob("media.process", data, ctx, deps)).resolves.toEqual({
      status: "ready",
      mediaId: MEDIA_ID,
    });
    expect(ctx.warnings).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ error: "S3 unavailable" }) }),
    ]);
  });
});