import { formatBytes } from "@/lib/format-bytes";
import { COVER_MIME_TYPES, type MediaUploadLimits } from "@/lib/api/media";

/**
 * Client rules for a batch photo upload.
 *
 * **No limit value is defined here.** The server owns every number — how many
 * files one batch may contain, the per-file ceiling, the batch byte ceiling and
 * the presign quota — and exposes them through
 * `GET /v1/workspaces/:workspaceId/media/limits`. Reading them back means an
 * operator can change the settings without a web deploy, and the UI can never
 * contradict the API that will reject the upload.
 *
 * When that endpoint is unavailable (still being rolled out, or a transient
 * failure) the UI deliberately shows **no numbers at all**: it keeps the
 * picker usable, lets the server answer, and renders the rejection reason with
 * whatever values the server did return.
 */

/**
 * The browser-side concurrency used while a batch is in flight.
 *
 * This is not a product limit and is not configured server-side: decoding a
 * 2000px source costs ~12 MB of RGBA, so three in-flight photos (~36 MB) keep a
 * mobile Safari tab below its memory ceiling. It never rejects a file.
 */
export const PHOTO_UPLOAD_CONCURRENCY = 3;

/** The six image types the presign contract accepts. */
export const PHOTO_UPLOAD_ALLOWED_TYPES: readonly string[] = COVER_MIME_TYPES;

/** Space-separated `accept` attribute for the picker. */
export const PHOTO_UPLOAD_ACCEPT = PHOTO_UPLOAD_ALLOWED_TYPES.join(",");

/** Shown while the limits request is in flight or failed: no digits. */
export const PHOTO_UPLOAD_GENERIC_HINT =
  "一次可以选择多张照片；上传时会按当前账号的上限校验，超出上限的文件会被跳过，并在队列里说明原因。";

/** "一次最多 N 张，单张不超过 X，单批合计不超过 Y。" — values only. */
export function uploadLimitHint(limits: MediaUploadLimits | null): string {
  if (!limits) return PHOTO_UPLOAD_GENERIC_HINT;
  return `一次最多 ${limits.maxFilesPerBatch} 张，单张不超过 ${formatBytes(limits.maxFileBytes)}，单批合计不超过 ${formatBytes(limits.maxBatchBytes)}；每分钟最多上传 ${limits.presignPerMinute} 次。`;
}

/**
 * The rejection copy for one file over the batch count.
 *
 * Built from the server's value, never from a client constant: the same
 * sentence stays correct after an operator raises or lowers the setting.
 */
export function overBatchLimitMessage(
  fileName: string | undefined,
  limits: MediaUploadLimits,
): string {
  const named = fileName ? `「${fileName}」以及后续照片` : "超出的照片";
  return `${named}没有加入上传队列：一次最多上传 ${limits.maxFilesPerBatch} 张，每分钟最多上传 ${limits.presignPerMinute} 次。请先上传这批照片，再继续选择剩下的。`;
}

/** Per-file / per-batch rejection copy, again using the server's numbers. */
export function restrictionMessage(message: string, limits: MediaUploadLimits | null): string {
  if (!limits) return `${message} 上传时会按当前账号的上限校验。`;
  return `${message} 上限：单次 ${limits.maxFilesPerBatch} 张，单张 ${formatBytes(limits.maxFileBytes)}，单批合计 ${formatBytes(limits.maxBatchBytes)}。`;
}

/** `429` copy for the presign guard, with the server's quota when known. */
export function presignRateLimitMessage(presignPerMinute: number | null | undefined): string {
  return typeof presignPerMinute === "number" && presignPerMinute > 0
    ? `上传太频繁：每分钟最多上传 ${presignPerMinute} 次，请稍后再试。`
    : "上传太频繁：每分钟可上传的次数有限，请稍后再试。";
}
