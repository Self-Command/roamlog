import type { Job } from "bullmq";
import { defineProcessor, type JobProcessor, type ProcessorContext } from "../processor.js";
import type { ImageProcessingResult, WorkerDependencies } from "./types.js";

export interface MediaJobData {
  mediaId: string;
  workspaceId: string;
  keys?: string[];
}

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
  deps: WorkerDependencies,
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
    context.logger.info(
      { jobId: context.jobId, mediaId: data.mediaId, variants: processed.variants.length },
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
  for (const key of keys) {
    await deps.storage.deleteObject(key);
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
