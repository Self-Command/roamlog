import { encode as encodeBlurhash } from "blurhash";

import {
  IMAGE_BLURHASH_COMPONENTS,
  IMAGE_MAX_EDGE,
  IMAGE_QUALITY_STEPS,
  IMAGE_TARGET_BYTES,
  IMAGE_THUMB_QUALITY,
  ImageCompressionError,
  computeTargetSize,
  computeThumbnailSize,
  createDecodeError,
  encodeQualityLadder,
  isImageCompressionError,
  qualityLadderFrom,
  shouldSkipCompression,
  type CompressionResult,
  type ImageCompressionProgress,
} from "./compress-image";
import type {
  CompressWorkerRequest,
  CompressWorkerResponse,
} from "./compress-image-protocol";

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<CompressWorkerRequest>) => void,
  ): void;
  postMessage(message: CompressWorkerResponse): void;
}

const scope = self as unknown as WorkerScope;

function send(message: CompressWorkerResponse): void {
  scope.postMessage(message);
}

function progress(
  id: number,
  input: ImageCompressionProgress,
): void {
  send({ type: "progress", id, progress: input });
}

function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return undefined;
}

function asEncodeError(error: unknown): ImageCompressionError {
  if (isImageCompressionError(error)) return error;
  return new ImageCompressionError(
    "ENCODE_FAILED",
    "浏览器无法编码 WebP，图片压缩失败，请重试。",
    errorDetail(error),
  );
}

async function renderBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new ImageCompressionError("ENCODE_FAILED", "浏览器无法创建画布，图片压缩失败。");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

async function encodeCanvas(
  canvas: OffscreenCanvas,
  quality: number,
): Promise<Blob> {
  const blob = await canvas.convertToBlob({ type: "image/webp", quality });
  if (blob.type !== "image/webp") {
    throw new ImageCompressionError(
      "ENCODE_FAILED",
      "当前浏览器不支持 WebP 编码，无法压缩图片。",
      `encodedType=${blob.type || "unknown"}`,
    );
  }
  return blob;
}

async function blurhashFor(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<string> {
  const canvas = new OffscreenCanvas(32, 32);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return "";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, 32, 32).data;
  try {
    return encodeBlurhash(
      pixels,
      32,
      32,
      IMAGE_BLURHASH_COMPONENTS[0],
      IMAGE_BLURHASH_COMPONENTS[1],
    );
  } catch {
    // A missing blurhash must never block the actual cover upload.
    return "";
  }
}

async function compress(
  request: CompressWorkerRequest,
): Promise<CompressionResult> {
  const startedAt = performance.now();
  const { file, id } = request;
  const maxEdge = request.maxEdge > 0 ? request.maxEdge : IMAGE_MAX_EDGE;
  const targetBytes = request.targetBytes > 0 ? request.targetBytes : IMAGE_TARGET_BYTES;
  const qualities = qualityLadderFrom(
    request.quality > 0 ? request.quality : IMAGE_QUALITY_STEPS[0],
  );

  progress(id, {
    percent: 2,
    stage: "decoding",
    iteration: 0,
    quality: null,
  });

  let probe: ImageBitmap;
  try {
    probe = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    throw createDecodeError(file, errorDetail(error));
  }

  if (!probe.width || !probe.height) {
    probe.close();
    throw createDecodeError(file, "decoded bitmap has zero dimensions");
  }

  const originalWidth = probe.width;
  const originalHeight = probe.height;
  const target = computeTargetSize(originalWidth, originalHeight, maxEdge);

  if (shouldSkipCompression(file.size, originalWidth, originalHeight, maxEdge)) {
    probe.close();
    progress(id, {
      percent: 100,
      stage: "blurhash",
      iteration: 0,
      quality: 1,
    });
    return {
      full: file,
      thumb: file,
      width: originalWidth,
      height: originalHeight,
      blurhash: "",
      quality: 1,
      iterations: 0,
      skipped: true,
      originalBytes: file.size,
      compressedBytes: file.size,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }

  let bitmap = probe;
  const needsResize = target.width !== originalWidth || target.height !== originalHeight;
  if (needsResize) {
    try {
      bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: "high",
      });
      probe.close();
    } catch {
      // Some engines expose resize options but reject them. The worker still has
      // the correctly oriented full bitmap, so draw it scaled instead of failing.
      bitmap = probe;
    }
  }

  try {
    const canvas = await renderBitmap(bitmap, target.width, target.height);
    progress(id, {
      percent: 8,
      stage: "encoding",
      iteration: 0,
      quality: qualities[0] ?? IMAGE_QUALITY_STEPS[0],
    });

    const encoded = await encodeQualityLadder({
      targetBytes,
      qualities,
      encode: async (quality, iteration) => {
        progress(id, {
          percent: Math.min(42, 8 + iteration * 9),
          stage: iteration === 0 ? "encoding" : "retrying",
          iteration: iteration + 1,
          quality,
        });
        try {
          return await encodeCanvas(canvas, quality);
        } catch (error) {
          throw asEncodeError(error);
        }
      },
    });

    progress(id, {
      percent: 48,
      stage: "thumbnail",
      iteration: encoded.iterations,
      quality: encoded.quality,
    });
    const thumbSize = computeThumbnailSize(originalWidth, originalHeight);
    const thumbCanvas = await renderBitmap(bitmap, thumbSize.width, thumbSize.height);
    const thumb = await encodeCanvas(thumbCanvas, IMAGE_THUMB_QUALITY);

    progress(id, {
      percent: 72,
      stage: "blurhash",
      iteration: encoded.iterations,
      quality: encoded.quality,
    });
    const blurhash = await blurhashFor(bitmap, 32, 32);

    progress(id, {
      percent: 98,
      stage: "blurhash",
      iteration: encoded.iterations,
      quality: encoded.quality,
    });

    return {
      full: encoded.blob,
      thumb,
      width: target.width,
      height: target.height,
      blurhash,
      quality: encoded.quality,
      iterations: encoded.iterations,
      skipped: false,
      originalBytes: file.size,
      compressedBytes: encoded.blob.size,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    bitmap.close();
  }
}

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (!request || typeof request.id !== "number" || !(request.file instanceof File)) {
    return;
  }

  void compress(request)
    .then((result) => {
      send({ type: "result", id: request.id, result });
    })
    .catch((error: unknown) => {
      const failure = isImageCompressionError(error)
        ? error
        : new ImageCompressionError(
            "ENCODE_FAILED",
            "图片压缩失败，请重试。",
            errorDetail(error),
          );
      send({
        type: "error",
        id: request.id,
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.detail ? { detail: failure.detail } : {}),
        },
      });
    });
});