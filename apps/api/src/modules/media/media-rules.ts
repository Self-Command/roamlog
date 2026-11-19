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

/**
 * Server-side image ceiling. Deliberately **wider** than the limit we advertise.
 *
 * `settings.media.maxUploadBytes` — mirrored by the web `COVER_MAX_BYTES` — is
 * 25,000,000 bytes, i.e. `25 MB` decimal. This constant is 25 MiB = 26,214,400
 * bytes, roughly 1.2 MB of slack. The gap is intentional, not a typo: the
 * browser rejects at 25 MB so a user is never surprised by a server-only
 * failure, while the server keeps tolerating uploads sized against a slightly
 * larger ceiling (already-queued work, clients that rounded a size). Tightening
 * this to 25,000,000 would be a behaviour change for in-flight uploads.
 *
 * Because of that slack the user-facing copy must NOT be derived from this
 * constant: `formatMegabytes(MAX_MEDIA_BYTES)` would print `26.2 MB` and
 * contradict the `25 MB` the client advertises. The copy states the advertised
 * limit instead; `media-rules.spec.ts` pins that choice.
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
