import { BadRequestException } from "@nestjs/common";

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

export function assertSupportedImage(mimeType: string, size: number): AllowedImageMime {
  const mime = normalizeImageMime(mimeType);
  if (!mime) {
    throw new BadRequestException({
      code: "MEDIA_UNSUPPORTED_TYPE",
      message: "Only JPEG, PNG, WebP, AVIF, HEIC, and HEIF images are accepted.",
    });
  }
  if (!Number.isInteger(size) || size <= 0 || size > MAX_MEDIA_BYTES) {
    throw new BadRequestException({
      code: "MEDIA_TOO_LARGE",
      message: "Images must be between 1 byte and 25 MB.",
    });
  }
  return mime;
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
  if (!Number.isInteger(args.sizeBytes) || args.sizeBytes <= 0 || args.sizeBytes > MAX_MOTION_BYTES) {
    throw new BadRequestException({
      code: "MEDIA_MOTION_TOO_LARGE",
      message: "Live Photo motion clips must be between 1 byte and 50 MB.",
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
