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
