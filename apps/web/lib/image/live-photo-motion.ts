/**
 * Motion-asset validation for Live Photo uploads.
 *
 * The still goes through the D1 browser compression pipeline; the movie is
 * uploaded as-is on purpose. Re-encoding a `.mov` in the browser (even with
 * `MediaRecorder`) rewrites the `moov` atom and drops the Apple
 * `still-image-time` metadata, so the only things checked here are the ones that
 * can be checked without touching the container: size, container type and
 * duration. The server re-validates all three.
 */

export const LIVE_PHOTO_MOTION_MAX_BYTES = 50 * 1024 * 1024;
export const LIVE_PHOTO_MOTION_MAX_DURATION_MS = 30_000;

export type MotionMimeType = "video/quicktime" | "video/mp4";

export type MotionValidationFailure =
  | { code: "UNSUPPORTED_TYPE"; message: string }
  | { code: "TOO_LARGE"; message: string }
  | { code: "TOO_LONG"; message: string };

export type MotionValidation =
  | { ok: true; mimeType: MotionMimeType; durationMs: number | null }
  | { ok: false; error: MotionValidationFailure };

export interface ValidateMotionOptions {
  /** Duration read from the decoded video, when the browser could decode it. */
  durationMs?: number | null;
  maxBytes?: number;
  maxDurationMs?: number;
}

function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

export function resolveMotionMimeType(
  file: Pick<File, "name" | "type">,
): MotionMimeType | null {
  const type = file.type.trim().toLowerCase();
  if (type === "video/quicktime" || type === "video/mp4") {
    return type;
  }
  const name = file.name.trim().toLowerCase();
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".mp4")) return "video/mp4";
  return null;
}

/**
 * Validates a motion clip. Never throws and never touches the file system, so it
 * is safe to call from the file picker and from tests; the duration is supplied
 * by {@link probeMotionDuration}.
 */
export function validateMotionFile(
  file: Pick<File, "name" | "type" | "size">,
  options: ValidateMotionOptions = {},
): MotionValidation {
  const mimeType = resolveMotionMimeType(file);
  if (!mimeType) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_TYPE",
        message: "动图需为 .MOV 或 .MP4 视频，请从「文件」App 中同时选择照片与视频。",
      },
    };
  }

  const maxBytes = options.maxBytes ?? LIVE_PHOTO_MOTION_MAX_BYTES;
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
    return {
      ok: false,
      error: {
        code: "TOO_LARGE",
        message: `动图需小于 ${formatMegabytes(maxBytes)}，当前文件为 ${formatMegabytes(file.size)}。`,
      },
    };
  }

  const maxDurationMs = options.maxDurationMs ?? LIVE_PHOTO_MOTION_MAX_DURATION_MS;
  const durationMs = options.durationMs ?? null;
  if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs > maxDurationMs)) {
    return {
      ok: false,
      error: {
        code: "TOO_LONG",
        message: `实况照片动图需在 ${Math.round(maxDurationMs / 1000)} 秒以内，当前为 ${Math.round(durationMs / 1000)} 秒。`,
      },
    };
  }

  return { ok: true, mimeType, durationMs: durationMs === null ? null : Math.round(durationMs) };
}

/**
 * Reads the clip duration through a hidden `<video>`.
 *
 * Returns `null` when the browser cannot decode the container (HEVC MOV in
 * Firefox, for example) — the upload still proceeds, because the server and the
 * `<video>` element of a Safari/Chrome visitor may well be able to play it and a
 * duration is metadata, not a requirement.
 */
export function probeMotionDuration(file: Blob): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(value === null || !Number.isFinite(value) ? null : Math.round(value * 1000));
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(null);
    // A codec the browser cannot open never fires either callback on some
    // platforms; the timer keeps the picker responsive.
    setTimeout(() => finish(null), 4_000);
    video.src = url;
  });
}