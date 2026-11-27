import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { MEDIA_ERROR_CODES } from "@roamlog/contracts";

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export type MediaVariantName = "original" | "thumb" | "medium" | "large";

/**
 * Fallback server-side image ceiling, used only when no `limits` source is
 * wired (hand-built instances, tests). The effective ceiling is the operator
 * setting `limits.uploadMaxFileBytes`, resolved per request by
 * `media-upload-limits.ts`.
 *
 * At the default configuration the two are the same number: 25 MiB = 26,214,400
 * bytes, which is deliberately **wider** than the `25,000,000` bytes (25 MB
 * decimal) the web uploader advertises — roughly 1.2 MB of slack so a user is
 * never surprised by a server-only failure while already-queued work and clients
 * that rounded a size still pass. Tightening this to 25,000,000 would be a
 * behaviour change for in-flight uploads.
 *
 * Because of that slack the default user-facing copy must NOT be derived from
 * this constant: `formatMegabytes(MAX_MEDIA_BYTES)` would print `26.2 MB` and
 * contradict the `25 MB` the client advertises, so `assertSupportedImage` keeps
 * the pinned `25 MB` string for this value while a *configured* ceiling prints
 * its own size. `media-rules.spec.ts` pins that choice.
 */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/**
 * Limits and allow-list for the paired motion asset.
 *
 * These mirror `@roamlog/contracts` (`MEDIA_MOTION_MAX_BYTES`,
 * `MEDIA_MOTION_MAX_DURATION_MS`, `MEDIA_MOTION_MIME_TYPES`). The API cannot
 * import the web constants and the web cannot import this file, so the shared
 * truth is the contract; this module restates it for the server-side checks and
 * `media-rules.spec.ts` asserts the two stay equal.
 */
export const MAX_MOTION_BYTES = 50 * 1024 * 1024;
export const MAX_MOTION_DURATION_MS = 30_000;
export const ALLOWED_MOTION_MIME_TYPES = ["video/quicktime", "video/mp4"] as const;

export type AllowedMotionMime = (typeof ALLOWED_MOTION_MIME_TYPES)[number];

const MOTION_EXTENSION_BY_MIME: Record<AllowedMotionMime, string> = {
  "video/quicktime": "mov",
  "video/mp4": "mp4",
};

const EXTENSION_BY_MIME: Record<AllowedImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function normalizeImageMime(value: string): AllowedImageMime | null {
  const normalized = value.trim().toLowerCase();
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(normalized)
    ? (normalized as AllowedImageMime)
    : null;
}

export function extensionForMime(mime: AllowedImageMime): string {
  return EXTENSION_BY_MIME[mime];
}

/**
 * Decimal megabytes for user-facing copy (`52,428,800` → `"52.4 MB"`).
 *
 * `apps/web` formats the same numbers through `@/lib/format-bytes`; this is the
 * server's copy of those rules (MB keeps one decimal place, a trailing `.0` is
 * dropped) because the two apps share no runtime module — only
 * `@roamlog/contracts`. Removing the duplication means moving the helper into
 * that package, which is a wider change than this one.
 *
 * Display only: every threshold comparison stays in raw bytes.
 */
export function formatMegabytes(bytes: number): string {
  const megabytes = bytes / 1_000_000;
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

export function assertSupportedImage(
  mimeType: string,
  size: number,
  maxBytes: number = MAX_MEDIA_BYTES,
): AllowedImageMime {
  const mime = normalizeImageMime(mimeType);
  if (!mime) {
    throw new BadRequestException({
      code: "MEDIA_UNSUPPORTED_TYPE",
      message: "Only JPEG, PNG, WebP, AVIF, HEIC, and HEIF images are accepted.",
    });
  }
  if (!Number.isInteger(size) || size <= 0 || size > maxBytes) {
    throw new BadRequestException({
      code: "MEDIA_TOO_LARGE",
      message: `Images must be between 1 byte and ${
        maxBytes === MAX_MEDIA_BYTES ? "25 MB" : formatMegabytes(maxBytes)
      }.`,
    });
  }
  return mime;
}

/**
 * The business ceiling for one still, from `limits.uploadMaxFileBytes`.
 *
 * Distinct from {@link assertSupportedImage}'s `MEDIA_TOO_LARGE` (400, the
 * malformed-body range check): this is a *policy* answer and therefore a
 * `422 MEDIA_FILE_TOO_LARGE` with the field and the observed size in `errors[]`,
 * exactly like `AI_REWRITE_TEXT_TOO_LONG` in `ai-rewrite.service.ts`. The
 * contract's `size.max(...)` is only the loose wire cap, so an operator who
 * raises or lowers the setting changes the accepted range without a redeploy.
 */
export function assertUploadSizeAllowed(args: {
  readonly size: number;
  readonly maxBytes: number;
}): void {
  if (args.size <= args.maxBytes) {
    return;
  }
  throw new UnprocessableEntityException({
    code: MEDIA_ERROR_CODES.fileTooLarge,
    message: `A single image must be ${formatMegabytes(args.maxBytes)} or smaller.`,
    errors: [
      {
        field: "size",
        code: "TOO_LARGE",
        message: `The image is ${formatMegabytes(args.size)}; the limit is ${formatMegabytes(
          args.maxBytes,
        )}.`,
      },
    ],
  });
}

/** `limits.uploadMaxFilesPerBatch` violation: the whole batch is refused (422). */
export function assertBatchFileCountAllowed(args: {
  readonly fileCount: number;
  readonly maxFilesPerBatch: number;
}): void {
  if (args.fileCount <= args.maxFilesPerBatch) {
    return;
  }
  throw new UnprocessableEntityException({
    code: MEDIA_ERROR_CODES.batchTooManyFiles,
    message: `Upload at most ${args.maxFilesPerBatch} photos at a time.`,
    errors: [
      {
        field: "files",
        code: "TOO_MANY",
        message: `The batch has ${args.fileCount} files; the limit is ${args.maxFilesPerBatch}.`,
      },
    ],
  });
}

/** `limits.uploadMaxBatchBytes` violation: the whole batch is refused (422). */
export function assertBatchBytesAllowed(args: {
  readonly totalBytes: number;
  readonly maxBatchBytes: number;
}): void {
  if (args.totalBytes <= args.maxBatchBytes) {
    return;
  }
  throw new UnprocessableEntityException({
    code: MEDIA_ERROR_CODES.batchTooLarge,
    message: `A batch must total ${formatMegabytes(args.maxBatchBytes)} or less.`,
    errors: [
      {
        field: "files",
        code: "TOO_LARGE",
        message: `The batch totals ${formatMegabytes(
          args.totalBytes,
        )}; the limit is ${formatMegabytes(args.maxBatchBytes)}.`,
      },
    ],
  });
}

/**
 * Strips user-controlled path segments. The generated object key never uses
 * the original filename, so traversal attempts can only influence metadata.
 */
export function sanitizeFileName(fileName: string): string {
  const base = fileName
    .split(/[/\\]/)
    .pop()
    ?.replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
  const cleaned = base?.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "");
  return cleaned && cleaned.length > 0 ? cleaned.slice(0, 120) : "image";
}

/**
 * Metadata-only filename normalisation for Admin search and moderation.
 *
 * Unlike {@link sanitizeFileName}, this preserves Unicode and spaces because
 * the value is never used as an object key or filesystem path. Path segments,
 * control/format characters and Windows-reserved punctuation are removed; the
 * result is NFC-normalised and capped to the database/contract limit.
 */
export function normalizeOriginalFileName(fileName: string): string {
  const basename = fileName.split(/[/\\]/u).pop() ?? "";
  const cleaned = basename
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[<>:"/\\|?*]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^\.+/u, "")
    .replace(/[.\s]+$/u, "")
    .trim();
  return (cleaned.length > 0 ? cleaned : "image").slice(0, 255);
}

export function assertSafeMediaKey(key: string): void {
  const segments = key.split("/");
  if (
    !key ||
    key.length > 500 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("..") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new BadRequestException({
      code: "MEDIA_INVALID_KEY",
      message: "Media object keys must stay inside the Workspace namespace.",
    });
  }
}

export function buildMediaKey(args: {
  workspaceId: string;
  mediaId: string;
  mimeType: AllowedImageMime;
  variant: MediaVariantName;
  capturedAt?: Date;
}): string {
  const date = args.capturedAt ?? new Date();
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const key = `${args.workspaceId}/${year}/${month}/${args.mediaId}/${args.variant}.${extensionForMime(args.mimeType)}`;
  assertSafeMediaKey(key);
  return key;
}

export function assertVariantKey(mediaKey: string, variantKey: string): void {
  assertSafeMediaKey(variantKey);
  if (!variantKey.startsWith(`${mediaKey.split("/").slice(0, 4).join("/")}/`)) {
    throw new BadRequestException({
      code: "MEDIA_INVALID_KEY",
      message: "Variant keys must stay inside the owning media folder.",
    });
  }
}

export function normalizeMotionMime(value: string): AllowedMotionMime | null {
  const normalized = value.trim().toLowerCase();
  return (ALLOWED_MOTION_MIME_TYPES as readonly string[]).includes(normalized)
    ? (normalized as AllowedMotionMime)
    : null;
}

export function extensionForMotionMime(mime: AllowedMotionMime): string {
  return MOTION_EXTENSION_BY_MIME[mime];
}

/**
 * Validates the motion asset before (presign) and after (completion) upload.
 *
 * The browser does not re-encode the movie — a second pass risks the `moov`
 * atom and the Apple `still-image-time` metadata — so byte size and duration are
 * the only guards in front of the object store. The same numbers gate the
 * presign request and the completion callback, so an oversized file cannot be
 * registered by skipping the first step.
 */
export function assertSupportedMotion(args: {
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
}): AllowedMotionMime {
  const mime = normalizeMotionMime(args.mimeType);
  if (!mime) {
    throw new BadRequestException({
      code: "MEDIA_MOTION_UNSUPPORTED_TYPE",
      message: "Live Photo motion clips must be video/quicktime (MOV) or video/mp4.",
    });
  }
  if (
    !Number.isInteger(args.sizeBytes) ||
    args.sizeBytes <= 0 ||
    args.sizeBytes > MAX_MOTION_BYTES
  ) {
    throw new BadRequestException({
      code: "MEDIA_MOTION_TOO_LARGE",
      message: `Live Photo motion clips must be between 1 byte and ${formatMegabytes(MAX_MOTION_BYTES)}.`,
    });
  }
  if (
    args.durationMs !== undefined &&
    args.durationMs !== null &&
    (!Number.isInteger(args.durationMs) ||
      args.durationMs < 0 ||
      args.durationMs > MAX_MOTION_DURATION_MS)
  ) {
    throw new BadRequestException({
      code: "MEDIA_MOTION_TOO_LONG",
      message: "Live Photo motion clips must be 30 seconds or shorter.",
    });
  }
  return mime;
}

/**
 * Motion objects live beside the still, inside the media folder:
 * `<workspace>/<year>/<month>/<mediaId>/motion.mov` (or `.mp4`).
 *
 * Deriving the key from the media row — instead of trusting the client — is what
 * makes the completion callback safe: a client that echoes a different key is
 * rejected with `MEDIA_INVALID_KEY`.
 */
export function buildMotionKey(args: {
  mediaKey: string;
  mimeType: AllowedMotionMime;
  variant?: "motion" | "motion-thumb";
}): string {
  const folder = args.mediaKey.split("/").slice(0, 4).join("/");
  const variant = args.variant ?? "motion";
  const extension = variant === "motion-thumb" ? "webp" : extensionForMotionMime(args.mimeType);
  const key = `${folder}/${variant}.${extension}`;
  assertSafeMediaKey(key);
  return key;
}
