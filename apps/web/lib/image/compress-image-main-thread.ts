import { encode as encodeBlurhash } from "blurhash";

import {
  IMAGE_BLURHASH_COMPONENTS,
  IMAGE_MAX_EDGE,
  IMAGE_TARGET_BYTES,
  IMAGE_THUMB_QUALITY,
  ImageCompressionError,
  computeTargetSize,
  computeThumbnailSize,
  createDecodeError,
  encodeQualityLadder,
  isImageCompressionError,
  shouldSkipCompression,
  type CompressionResult,
  type ImageCompressionProgress,
} from "./compress-image";

interface DecodedSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

export interface MainThreadCompressionOptions {
  maxEdge?: number;
  targetBytes?: number;
  onProgress?: (progress: ImageCompressionProgress) => void;
  signal?: AbortSignal;
}

function detailOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("压缩已取消。", "AbortError");
}

function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(createDecodeError(file, "HTMLImageElement decode failed"));
    };
    image.src = url;
  });
}

async function decodeOnMainThread(file: File): Promise<DecodedSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch (error) {
      // Fall through to <img>, which can still decode formats createImageBitmap
      // rejects (and also applies EXIF orientation).
      if (typeof Image === "undefined") throw createDecodeError(file, detailOf(error));
    }
  }

  if (typeof Image === "undefined") {
    throw createDecodeError(file, "Image is unavailable");
  }
  try {
    const image = await loadHtmlImage(file);
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      close: () => undefined,
    };
  } catch (error) {
    if (isImageCompressionError(error)) throw error;
    throw createDecodeError(file, detailOf(error));
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new ImageCompressionError("ENCODE_FAILED", "浏览器无法创建画布，图片压缩失败。");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return canvas;
}

function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(
            new ImageCompressionError("ENCODE_FAILED", "浏览器无法编码 WebP，图片压缩失败。"),
          );
          return;
        }
        if (blob.type !== "image/webp") {
          reject(
            new ImageCompressionError(
              "ENCODE_FAILED",
              "当前浏览器不支持 WebP 编码，无法压缩图片。",
              `encodedType=${blob.type || "unknown"}`,
            ),
          );
          return;
        }
        resolve(blob);
      },
      "image/webp",
      quality,
    );
  });
}

function blurhashFor(
  source: CanvasImageSource,
  width: number,
  height: number,
): string {
  const canvas = createCanvas(32, 32);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return "";
  context.drawImage(source, 0, 0, width, height);
  try {
    return encodeBlurhash(
      context.getImageData(0, 0, 32, 32).data,
      32,
      32,
      IMAGE_BLURHASH_COMPONENTS[0],
      IMAGE_BLURHASH_COMPONENTS[1],
    );
  } catch {
    return "";
  }
}

/**
 * Main-thread fallback for browsers without OffscreenCanvas/Worker coverage.
 * It is intentionally the same ladder and thumbnail/blurhash pipeline, but it
 * does block the UI thread; callers should keep the user informed while it runs.
 */
export async function compressImageOnMainThread(
  file: File,
  options: MainThreadCompressionOptions = {},
): Promise<CompressionResult> {
  console.warn(
    "[image-compression] OffscreenCanvas 或 Worker 不可用，已降级到主线程压缩。",
  );
  const startedAt = performance.now();
  const maxEdge = options.maxEdge ?? IMAGE_MAX_EDGE;
  const targetBytes = options.targetBytes ?? IMAGE_TARGET_BYTES;
  const report = (
    percent: number,
    stage: ImageCompressionProgress["stage"],
    iteration = 0,
    quality: number | null = null,
  ) => options.onProgress?.({ percent, stage, iteration, quality });

  throwIfAborted(options.signal);
  report(2, "decoding");

  const decoded = await decodeOnMainThread(file);
  const { width: originalWidth, height: originalHeight } = decoded;
  if (!originalWidth || !originalHeight) {
    decoded.close();
    throw createDecodeError(file, "decoded image has zero dimensions");
  }

  if (shouldSkipCompression(file.size, originalWidth, originalHeight, maxEdge)) {
    decoded.close();
    report(100, "blurhash");
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

  try {
    const target = computeTargetSize(originalWidth, originalHeight, maxEdge);
    const canvas = createCanvas(target.width, target.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new ImageCompressionError("ENCODE_FAILED", "浏览器无法创建画布，图片压缩失败。");
    }
    context.drawImage(decoded.source, 0, 0, target.width, target.height);

    throwIfAborted(options.signal);
    report(8, "encoding", 0, 0.82);
    const encoded = await encodeQualityLadder({
      targetBytes,
      encode: async (quality, iteration) => {
        throwIfAborted(options.signal);
        report(
          Math.min(42, 8 + iteration * 9),
          iteration === 0 ? "encoding" : "retrying",
          iteration + 1,
          quality,
        );
        try {
          return await encodeCanvas(canvas, quality);
        } catch (error) {
          if (isImageCompressionError(error)) throw error;
          throw new ImageCompressionError(
            "ENCODE_FAILED",
            "浏览器无法编码 WebP，图片压缩失败，请重试。",
            detailOf(error),
          );
        }
      },
    });

    throwIfAborted(options.signal);
    report(48, "thumbnail", encoded.iterations, encoded.quality);
    const thumbSize = computeThumbnailSize(originalWidth, originalHeight);
    const thumbCanvas = createCanvas(thumbSize.width, thumbSize.height);
    const thumbContext = thumbCanvas.getContext("2d", { alpha: false });
    if (!thumbContext) {
      throw new ImageCompressionError("ENCODE_FAILED", "浏览器无法创建缩略图画布。");
    }
    thumbContext.drawImage(decoded.source, 0, 0, thumbSize.width, thumbSize.height);
    const thumb = await encodeCanvas(thumbCanvas, IMAGE_THUMB_QUALITY);

    throwIfAborted(options.signal);
    report(72, "blurhash", encoded.iterations, encoded.quality);
    const blurhash = blurhashFor(decoded.source, originalWidth, originalHeight);

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
    decoded.close();
  }
}