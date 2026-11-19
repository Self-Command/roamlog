import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Job } from "bullmq";
import { defineProcessor, type JobProcessor, type ProcessorContext } from "../processor.js";
import type { ImageProcessingResult, WorkerDependencies } from "./types.js";
import { objectBucket } from "./storage-bucket.js";

export interface MediaJobData {
  mediaId: string;
  workspaceId: string;
  keys?: string[];
}

/**
 * Optional video-thumbnail seam.
 *
 * The default implementation shells out to `ffmpeg`; environments without the
 * binary (CI images, minimal servers) skip the thumbnail instead of failing the
 * whole media job. Tests inject their own extractor, so no test depends on the
 * binary being installed.
 */
export interface MotionThumbnailExtractor {
  available(): boolean;
  extract(input: {
    bytes: Uint8Array;
    mimeType: string;
    storageKey: string;
  }): { bytes: Uint8Array; width: number | null; height: number | null } | null;
}

/** `MediaJobDependencies` adds the optional extractor without changing the base interface. */
export type MediaJobDependencies = WorkerDependencies & {
  video?: MotionThumbnailExtractor;
};

const MOTION_THUMB_EDGE = 640;
const MOTION_THUMB_MIME = "image/webp";

const MEDIA_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function mediaVariantKey(mediaKey: string, name: string, mimeType: string): string {
  const directory = mediaKey.split("/").slice(0, -1).join("/");
  const extension = MEDIA_EXTENSIONS[mimeType] ?? "bin";
  return `${directory}/${name}.${extension}`;
}

/** `<folder>/motion.webp`-style key for the extracted first frame. */
export function motionThumbnailKey(storageKey: string): string {
  const directory = storageKey.split("/").slice(0, -1).join("/");
  return `${directory}/motion-thumb.webp`;
}

export const ffmpegMotionThumbnails: MotionThumbnailExtractor = {
  available() {
    const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 10_000 });
    return probe.status === 0;
  },

  extract(input) {
    const directory = mkdtempSync(join(tmpdir(), "roamlog-motion-"));
    const source = join(directory, `motion${input.mimeType === "video/quicktime" ? ".mov" : ".mp4"}`);
    const output = join(directory, "motion-thumb.webp");
    try {
      writeFileSync(source, input.bytes);
      const result = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-loglevel",
          "error",
          "-i",
          source,
          "-frames:v",
          "1",
          "-vf",
          `scale='min(${MOTION_THUMB_EDGE},iw)':-2`,
          "-f",
          "webp",
          output,
        ],
        { timeout: 60_000, stdio: "ignore" },
      );
      if (result.status !== 0) {
        return null;
      }
      const bytes = readFileSync(output);
      return bytes.byteLength > 0 ? { bytes: new Uint8Array(bytes), width: null, height: null } : null;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
};

export function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand.startsWith("avif")) {
      return "image/avif";
    }
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) {
      return "image/heic";
    }
  }
  return null;
}

export async function handleMediaJob(
  name: string,
  data: MediaJobData,
  context: ProcessorContext,
  deps: WorkerDependencies,
): Promise<{ status: string; mediaId: string }> {
  if (name === "media.cleanup") {
    return cleanupMedia(data, context, deps);
  }
  if (name !== "media.process") {
    throw new Error(`Unsupported media job "${name}"`);
  }
  return processMedia(data, context, deps);
}

async function processMedia(
  data: MediaJobData,
  context: ProcessorContext,
  deps: MediaJobDependencies,
): Promise<{ status: string; mediaId: string }> {
  const media = await deps.db.media.findFirst({
    where: { id: data.mediaId, workspaceId: data.workspaceId, deletedAt: null },
  });
  if (!media) {
    context.logger.warn({ jobId: context.jobId, mediaId: data.mediaId }, "media not found; skipping");
    return { status: "missing", mediaId: data.mediaId };
  }
  if (media.status === "ready") {
    return { status: "ready", mediaId: data.mediaId };
  }

  await deps.db.media.updateMany({
    where: { id: data.mediaId, workspaceId: data.workspaceId, deletedAt: null },
    data: { status: "processing", error: null },
  });

  try {
    const object = await deps.storage.getObject(media.key);
    const detected = detectImageMime(object.bytes);
    if (!detected) {
      throw new Error("Uploaded object is not a supported image (magic bytes mismatch)");
    }
    if (media.mimeType && detected !== media.mimeType) {
      throw new Error(`Magic bytes ${detected} do not match declared ${media.mimeType}`);
    }

    const processed: ImageProcessingResult = await deps.images.process({
      bytes: object.bytes,
      mimeType: detected,
      mediaKey: media.key,
    });
    for (const variant of processed.variants) {
      await deps.storage.putObject(variant.key, variant.bytes, variant.mimeType);
    }

    const variants = {
      original: { key: media.key, mimeType: detected, size: object.bytes.byteLength },
      ...Object.fromEntries(
        processed.variants.map((variant) => [
          variant.name,
          {
            key: variant.key,
            mimeType: variant.mimeType,
            size: variant.size,
            width: variant.width,
          },
        ]),
      ),
    };
    await deps.db.media.updateMany({
      where: { id: data.mediaId, workspaceId: data.workspaceId, deletedAt: null },
      data: {
        status: "ready",
        width: processed.width,
        height: processed.height,
        blurhash: processed.blurhash,
        variants,
        error: null,
      },
    });
    // The still is ready at this point; a missing thumbnail extractor must not
    // undo that, so the motion step reports its own outcome instead of throwing.
    const motion = await processMotionThumbnail(data, context, deps, media.key);
    context.logger.info(
      {
        jobId: context.jobId,
        mediaId: data.mediaId,
        variants: processed.variants.length,
        motionThumb: motion.thumbKey,
        motionSkipped: motion.skipped,
      },
      "media processed",
    );
    return { status: "ready", mediaId: data.mediaId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media processing failed";
    await deps.db.media.updateMany({
      where: { id: data.mediaId, workspaceId: data.workspaceId, deletedAt: null },
      data: { status: "failed", error: message.slice(0, 1000) },
    });
    context.logger.error(
      { jobId: context.jobId, mediaId: data.mediaId, error: message },
      "media processing failed",
    );
    throw error;
  }
}

/**
 * Best-effort first-frame thumbnail for the paired motion asset.
 *
 * Never throws: a Live Photo whose `.mov` cannot be decoded is still a valid
 * photo with a playable video, so the job keeps succeeding and only the
 * thumbnail is missing. Every skip is logged with its reason so operators can
 * tell "no ffmpeg on this host" from "this particular movie is broken".
 */
async function processMotionThumbnail(
  data: MediaJobData,
  context: ProcessorContext,
  deps: MediaJobDependencies,
  mediaKey: string,
): Promise<{ skipped: string | null; thumbKey: string | null }> {
  const motionTable = deps.db.mediaMotion;
  if (!motionTable?.findFirst) {
    return { skipped: "no-motion-table", thumbKey: null };
  }

  const motion = await motionTable.findFirst({
    where: { mediaId: data.mediaId, deletedAt: null },
  });
  if (!motion) {
    return { skipped: "no-motion", thumbKey: null };
  }
  if (typeof motion.thumbKey === "string" && motion.thumbKey.length > 0) {
    return { skipped: "thumb-exists", thumbKey: motion.thumbKey };
  }

  const extractor = deps.video ?? ffmpegMotionThumbnails;
  if (!extractor.available()) {
    context.logger.warn(
      { jobId: context.jobId, mediaId: data.mediaId, mediaKey, reason: "ffmpeg-unavailable" },
      "live photo motion thumbnail skipped: no ffmpeg in this environment",
    );
    return { skipped: "ffmpeg-unavailable", thumbKey: null };
  }

  try {
    const object = await deps.storage.getObject(String(motion.storageKey));
    const thumbnail = extractor.extract({
      bytes: object.bytes,
      mimeType: String(motion.mimeType),
      storageKey: String(motion.storageKey),
    });
    if (!thumbnail) {
      context.logger.warn(
        { jobId: context.jobId, mediaId: data.mediaId, reason: "extract-failed" },
        "live photo motion thumbnail skipped: ffmpeg could not decode the movie",
      );
      return { skipped: "extract-failed", thumbKey: null };
    }
    const thumbKey = motionThumbnailKey(String(motion.storageKey));
    await deps.storage.putObject(thumbKey, thumbnail.bytes, MOTION_THUMB_MIME);
    await motionTable.updateMany({
      where: { mediaId: data.mediaId, deletedAt: null },
      data: {
        thumbKey,
        ...(thumbnail.width === null ? {} : { width: thumbnail.width }),
        ...(thumbnail.height === null ? {} : { height: thumbnail.height }),
      },
    });
    context.logger.info(
      { jobId: context.jobId, mediaId: data.mediaId, thumbKey, bytes: thumbnail.bytes.byteLength },
      "live photo motion thumbnail extracted",
    );
    return { skipped: null, thumbKey };
  } catch (error) {
    context.logger.warn(
      {
        jobId: context.jobId,
        mediaId: data.mediaId,
        error: error instanceof Error ? error.message : "unknown",
      },
      "live photo motion thumbnail failed; the still stays ready",
    );
    return { skipped: "error", thumbKey: null };
  }
}

async function cleanupMedia(
  data: MediaJobData,
  context: ProcessorContext,
  deps: WorkerDependencies,
): Promise<{ status: string; mediaId: string }> {
  const media = await deps.db.media.findFirst({
    where: { id: data.mediaId, workspaceId: data.workspaceId },
  });
  if (media && !media.deletedAt) {
    return { status: "retained", mediaId: data.mediaId };
  }
  const variants = isRecord(media?.variants) ? media.variants : {};
  const keys = new Set<string>([
    ...(data.keys ?? []),
    ...(typeof media?.key === "string" ? [media.key] : []),
  ]);
  for (const value of Object.values(variants)) {
    if (isRecord(value) && typeof value.key === "string") {
      keys.add(value.key);
    }
  }
  // The paired motion object and its thumbnail follow the still even when the
  // caller did not list them (older queued jobs carrying only still keys).
  const motion = await deps.db.mediaMotion?.findFirst?.({ where: { mediaId: data.mediaId } });
  if (motion) {
    for (const key of [motion.storageKey, motion.thumbKey]) {
      if (typeof key === "string" && key.length > 0) {
        keys.add(key);
      }
    }
  }
  // Every object this job removes was uploaded under the row's bucket. After a
  // bucket switch the current bucket is the wrong one; `undefined` only means
  // the row itself is gone or predates `Media.bucket`, and then the storage
  // layer falls back to the current bucket.
  const bucket = objectBucket(media?.bucket);
  if (!bucket) {
    context.logger.warn(
      {
        jobId: context.jobId,
        mediaId: data.mediaId,
        event: "media.bucket_missing",
        fallback: "current",
        keys: keys.size,
      },
      "media row has no bucket; deleting with the current bucket",
    );
  }
  for (const key of keys) {
    await deps.storage.deleteObject(key, bucket);
  }
  context.logger.info({ jobId: context.jobId, mediaId: data.mediaId, keys: keys.size }, "media cleaned");
  return { status: "cleaned", mediaId: data.mediaId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createMediaProcessor(deps: WorkerDependencies): JobProcessor<MediaJobData> {
  return defineProcessor<MediaJobData>({
    name: "media",
    handle(job: Job<MediaJobData>, context: ProcessorContext) {
      return handleMediaJob(job.name, job.data, context, deps);
    },
  });
}
