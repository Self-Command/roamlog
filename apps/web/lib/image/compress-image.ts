import { formatBytes } from "../format-bytes";

/** Hard limits for the browser-side cover pipeline. Kept in one module so the
 * worker, the main-thread fallback, and the upload state machine cannot drift. */
export const IMAGE_MAX_EDGE = 2000;
export const IMAGE_TARGET_BYTES = 1_500_000;
export const IMAGE_QUALITY_STEPS = [0.82, 0.7, 0.6, 0.55] as const;
export const IMAGE_THUMB_EDGE = 320;
export const IMAGE_THUMB_QUALITY = 0.72;
export const IMAGE_BLURHASH_COMPONENTS = [4, 3] as const;
export const IMAGE_SKIP_MAX_BYTES = 200 * 1024;

/** Relative falloff of each ladder step against the 0.82 design baseline. */
const QUALITY_LADDER_RATIOS = IMAGE_QUALITY_STEPS.map(
  (quality) => quality / IMAGE_QUALITY_STEPS[0],
);

function roundQuality(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * Derives the four-step ladder from a configured start quality. The relative
 * falloff stays the historical one (1, 0.854, 0.732, 0.671), so the default
 * 0.82 reproduces `IMAGE_QUALITY_STEPS` exactly while a policy of 0.9 starts at
 * 0.9. The start is clamped to the WebP-safe 0.4–1 range.
 */
export function qualityLadderFrom(
  startQuality: number = IMAGE_QUALITY_STEPS[0],
): readonly number[] {
  const start = Number.isFinite(startQuality)
    ? Math.min(1, Math.max(0.4, startQuality))
    : IMAGE_QUALITY_STEPS[0];
  return QUALITY_LADDER_RATIOS.map((ratio) =>
    Math.max(0.4, roundQuality(start * ratio)),
  );
}

export type ImageCompressionFailureCode =
  | "DECODE_FAILED"
  | "ENCODE_FAILED"
  | "TOO_LARGE_AFTER_COMPRESSION";

export class ImageCompressionError extends Error {
  readonly code: ImageCompressionFailureCode;
  readonly detail: string | undefined;

  constructor(code: ImageCompressionFailureCode, message: string, detail?: string) {
    super(message);
    this.name = "ImageCompressionError";
    this.code = code;
    this.detail = detail;
  }
}

export function isImageCompressionError(value: unknown): value is ImageCompressionError {
  return value instanceof ImageCompressionError;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImageCompressionProgress {
  /** Overall progress of the compression step, 0–100. */
  percent: number;
  stage: "decoding" | "encoding" | "retrying" | "thumbnail" | "blurhash";
  iteration: number;
  quality: number | null;
}

export interface EncodedImage {
  blob: Blob;
  quality: number;
  iterations: number;
}

export interface CompressionResult {
  /** The full-size WebP (or the untouched source when `skipped` is true). */
  full: Blob;
  /** 320px WebP thumbnail. For a skipped source this equals `full`. */
  thumb: Blob;
  width: number;
  height: number;
  blurhash: string;
  quality: number;
  iterations: number;
  skipped: boolean;
  originalBytes: number;
  compressedBytes: number;
  elapsedMs: number;
}

/** Long-edge fit that never upscales. */
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge = IMAGE_MAX_EDGE,
): ImageDimensions {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const longest = Math.max(safeWidth, safeHeight);
  if (longest <= maxEdge) return { width: safeWidth, height: safeHeight };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

/** Thumbnail fit that never upscales. */
export function computeThumbnailSize(
  width: number,
  height: number,
  maxEdge = IMAGE_THUMB_EDGE,
): ImageDimensions {
  return computeTargetSize(width, height, maxEdge);
}

/**
 * Small images are uploaded untouched: re-encoding a file that is already below
 * the byte and edge budget would only add generation loss.
 */
export function shouldSkipCompression(
  byteLength: number,
  width: number,
  height: number,
  maxEdge = IMAGE_MAX_EDGE,
  maxBytes = IMAGE_SKIP_MAX_BYTES,
): boolean {
  return (
    byteLength > 0 &&
    byteLength < maxBytes &&
    Math.max(width, height) <= maxEdge
  );
}

/**
 * Tries WebP at 0.82, then walks the fixed ladder down to 0.55. Four attempts is
 * the hard cap; if the last result is still over target, the caller must decide
 * whether to reject the file rather than silently upload an oversized blob.
 */
export async function encodeQualityLadder(options: {
  encode: (quality: number, iteration: number) => Promise<Blob>;
  targetBytes?: number;
  qualities?: readonly number[];
}): Promise<EncodedImage> {
  const targetBytes = options.targetBytes ?? IMAGE_TARGET_BYTES;
  const qualities = options.qualities ?? IMAGE_QUALITY_STEPS;
  let lastBlob: Blob | null = null;
  let lastQuality = qualities[0] ?? IMAGE_QUALITY_STEPS[0];

  for (let iteration = 0; iteration < qualities.length; iteration += 1) {
    const quality = qualities[iteration] ?? IMAGE_QUALITY_STEPS[0];
    lastQuality = quality;
    const blob = await options.encode(quality, iteration);
    lastBlob = blob;
    if (blob.size <= targetBytes) {
      return { blob, quality, iterations: iteration + 1 };
    }
  }

  throw new ImageCompressionError(
    "TOO_LARGE_AFTER_COMPRESSION",
    `图片压缩到最低质量后仍超过 ${formatBytes(targetBytes)}，请换一张较小的图片。`,
    `lastSize=${lastBlob?.size ?? 0};quality=${lastQuality};iterations=${qualities.length}`,
  );
}

export function isHeicLike(file: Pick<File, "name" | "type">): boolean {
  return (
    /^image\/hei[cf]$/i.test(file.type.trim()) ||
    /\.(?:heic|heif)$/i.test(file.name)
  );
}

/** A decode failure that the UI can explain instead of showing a generic error. */
export function createDecodeError(
  file: Pick<File, "name" | "type">,
  detail?: string,
): ImageCompressionError {
  if (isHeicLike(file)) {
    return new ImageCompressionError(
      "DECODE_FAILED",
      "该格式浏览器无法解码（HEIC/HEIF）。请先转换为 JPEG 或 PNG 后重试。",
      detail,
    );
  }
  return new ImageCompressionError(
    "DECODE_FAILED",
    "浏览器无法解码这张图片，请换一张 JPEG、PNG 或 WebP 图片。",
    detail,
  );
}

/** Keeps the user-facing filename while switching the uploaded extension. */
export function toWebpFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const base = trimmed.replace(/\.[^.]+$/, "");
  return `${base || "image"}.webp`;
}

/**
 * Last-resort result for an environment with neither a Worker nor Canvas 2D.
 * Uploading the source is preferable to blocking the cover entirely.
 */
export function makeSourceOnlyResult(file: Blob): CompressionResult {
  return {
    full: file,
    thumb: file,
    width: 0,
    height: 0,
    blurhash: "",
    quality: 1,
    iterations: 0,
    skipped: true,
    originalBytes: file.size,
    compressedBytes: file.size,
    elapsedMs: 0,
  };
}