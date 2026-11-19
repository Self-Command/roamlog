import { MediaPresignRequestSchema } from "@roamlog/contracts";

import { COVER_MAX_BYTES, COVER_MIME_TYPES } from "@/lib/api/media";

import {
  coverValidationError,
  type CoverUploadError,
} from "./cover-upload-error";

type AllowedCoverMime = (typeof COVER_MIME_TYPES)[number];
type ValidationCode = Parameters<typeof coverValidationError>[0];

const EXTENSION_MIME: Record<string, AllowedCoverMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

const MIME_LABEL = "JPEG、PNG、WebP、AVIF、HEIC、HEIF";

export type CoverValidationResult =
  | { ok: true; mimeType: string }
  | { ok: false; error: CoverUploadError };

export interface ValidateCoverFileOptions {
  maxBytes?: number;
}

/**
 * Resolves the MIME type the server will sign for.
 *
 * Browsers are trusted for `File.type`, but iOS/desktop HEIC files frequently
 * arrive with an empty type. In that case the extension is used; a non-empty but
 * unsupported type (for example `image/gif`) is rejected outright instead of
 * being guessed from the file name.
 */
export function resolveCoverMimeType(file: Pick<File, "name" | "type">): string | null {
  const declared = file.type.trim().toLowerCase();
  if (declared.length > 0) {
    return (COVER_MIME_TYPES as readonly string[]).includes(declared) ? declared : null;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension) return null;
  return EXTENSION_MIME[extension] ?? null;
}

/**
 * Formats upload sizes in decimal units, matching the admin setting
 * `media.maxUploadBytes` (25,000,000 bytes → `25 MB`). Binary units would show
 * the same limit as `23.8 MB` and make the UI contradict the setting.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    const megabytes = bytes / 1_000_000;
    return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
  }
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function invalid(code: ValidationCode, message: string): CoverValidationResult {
  return { ok: false, error: coverValidationError(code, message) };
}

/**
 * Client-side mirror of the server's presign validation.
 *
 * The final guard re-runs `MediaPresignRequestSchema`, so a client-side drift in
 * limits or allowed types fails here instead of as an opaque 400 later.
 */
export function validateCoverFile(
  file: Pick<File, "name" | "size" | "type">,
  options: ValidateCoverFileOptions = {},
): CoverValidationResult {
  const maxBytes = options.maxBytes ?? COVER_MAX_BYTES;

  if (file.size <= 0) {
    return invalid("COVER_EMPTY_FILE", "这张图片是空文件，请选择其他图片。");
  }
  if (file.size > maxBytes) {
    return invalid(
      "COVER_TOO_LARGE",
      `图片大小 ${formatBytes(file.size)}，超过 ${formatBytes(maxBytes)} 上限。`,
    );
  }

  const fileName = file.name.trim().length > 0 ? file.name : null;
  if (!fileName) {
    return invalid("COVER_FILE_NAME_INVALID", "无法读取文件名，请重新选择图片。");
  }

  const mimeType = resolveCoverMimeType(file);
  if (!mimeType) {
    return invalid("COVER_TYPE_UNSUPPORTED", `只支持 ${MIME_LABEL} 格式的图片。`);
  }

  const parsed = MediaPresignRequestSchema.safeParse({
    fileName,
    mimeType,
    size: file.size,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "size") {
      return invalid("COVER_TOO_LARGE", `图片超过 ${formatBytes(maxBytes)} 上限。`);
    }
    if (issue?.path[0] === "mimeType") {
      return invalid("COVER_TYPE_UNSUPPORTED", `只支持 ${MIME_LABEL} 格式的图片。`);
    }
    return invalid("COVER_FILE_NAME_INVALID", issue?.message ?? "文件名不符合上传要求。");
  }

  return { ok: true, mimeType: parsed.data.mimeType };
}