import {
  completeMediaUpload as completeMediaUploadRequest,
  getMedia as getMediaRequest,
  presignMediaUpload as presignMediaUploadRequest,
  setTripCover as setTripCoverRequest,
  updateTrip as updateTripRequest,
} from "@roamlog/api-client";
import {
  GetMediaResponseSchema,
  MediaPresignResponseSchema,
  MediaSchema,
  TripSchema,
  type CompleteMediaRequest,
  type Media,
  type MediaPresignRequest,
  type MediaPresignResponse,
  type MediaRead,
  type Trip,
} from "@roamlog/contracts";

import { unwrap } from "./shared";

/**
 * Cover upload limits, restated from the server contract.
 *
 * `MediaPresignRequestSchema` hard-caps uploads at 25 MiB (26,214,400 bytes)
 * and accepts exactly these six image types;
 * `apps/api/src/modules/media/media-rules.ts` enforces the same values
 * (`MAX_MEDIA_BYTES`, `ALLOWED_IMAGE_MIME_TYPES`). The web app cannot import the
 * API package, so the constants live here and every selection is re-checked
 * against `MediaPresignRequestSchema` to prevent drift.
 *
 * 与后台设置 `media.maxUploadBytes` 的默认值一致（十进制 25,000,000 字节），
 * 改一处必须改另一处；后台设置会覆盖这个兜底值。
 */
export const COVER_MAX_BYTES = 25_000_000;

export const COVER_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;

/** `accept` attribute for the file picker: MIME types plus extensions so HEIC
 * (often reported with an empty MIME type by desktop browsers) stays selectable. */
export const COVER_ACCEPT_ATTRIBUTE = [
  ...COVER_MIME_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".heic",
  ".heif",
].join(",");

/**
 * The batch-upload limits the server actually enforces.
 *
 * The API owns these numbers (admin-configurable), so the web app must never
 * restate them as constants. `GET /v1/workspaces/:workspaceId/media/limits`
 * returns this shape; the UI feeds it straight into Uppy's restrictions and
 * into every limit sentence it renders. When the endpoint is unavailable the
 * caller gets `null` and must fall back to copy that mentions no numbers.
 */
export interface MediaUploadLimits {
  /** Maximum files in one batch (one presign call each). */
  maxFilesPerBatch: number;
  /** Per-file byte ceiling. */
  maxFileBytes: number;
  /** Total bytes accepted in one batch. */
  maxBatchBytes: number;
  /** Presign calls allowed per window, per caller. */
  presignPerMinute: number;
}

const MEDIA_UPLOAD_LIMIT_FIELDS = [
  "maxFilesPerBatch",
  "maxFileBytes",
  "maxBatchBytes",
  "presignPerMinute",
] as const;

/**
 * Validates the limits payload without a generated schema.
 *
 * The endpoint is newer than the generated client, so this module talks to it
 * with `fetch` and checks the exact four fields itself: a partial or malformed
 * body is treated as "unknown limits" rather than as a licence to show a wrong
 * number.
 */
export function parseMediaUploadLimits(value: unknown): MediaUploadLimits | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const parsed = {} as MediaUploadLimits;
  for (const field of MEDIA_UPLOAD_LIMIT_FIELDS) {
    const number = candidate[field];
    if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) return null;
    parsed[field] = number;
  }
  return parsed;
}

/**
 * Reads the workspace's upload limits.
 *
 * Resolves `null` on 404 (endpoint not deployed yet), any non-2xx or a network
 * failure; callers render number-free copy in that case instead of guessing.
 */
export async function getMediaUploadLimits(
  workspaceId: string,
): Promise<MediaUploadLimits | null> {
  try {
    const response = await fetch(`/v1/workspaces/${workspaceId}/media/limits`, {
      credentials: "include",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return parseMediaUploadLimits(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

export interface PutObjectRequest {
  /** Signed URL returned by the presign endpoint. Never constructed client-side. */
  url: string;
  /** Headers from the presign response, sent verbatim. */
  headers: Record<string, string>;
  file: Blob;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export type SignedUrlUploadFailure = "network" | "http" | "aborted";

export class SignedUrlUploadError extends Error {
  readonly code: SignedUrlUploadFailure;
  readonly status: number | null;

  constructor(code: SignedUrlUploadFailure, message: string, status: number | null = null) {
    super(message);
    this.name = "SignedUrlUploadError";
    this.code = code;
    this.status = status;
  }
}

export function isSignedUrlUploadError(value: unknown): value is SignedUrlUploadError {
  return value instanceof SignedUrlUploadError;
}

/**
 * Uploads the file to the signed object-storage URL with real progress events.
 *
 * Uses `XMLHttpRequest` because `fetch` cannot report upload progress. The
 * presigned URL already encodes bucket, key, signature and expiry, so no client
 * code derives them.
 */
export function putObjectToSignedUrl(request: PutObjectRequest): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (request.signal?.aborted) {
      reject(new SignedUrlUploadError("aborted", "上传已取消。"));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", request.url, true);
    for (const [name, value] of Object.entries(request.headers)) {
      xhr.setRequestHeader(name, value);
    }

    let settled = false;
    const onAbort = () => {
      xhr.abort();
      settle(() => reject(new SignedUrlUploadError("aborted", "上传已取消。")));
    };
    const cleanup = () => {
      request.signal?.removeEventListener("abort", onAbort);
    };
    function settle(complete: () => void) {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    }

    if (request.signal) {
      request.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        const total = event.lengthComputable ? event.total : request.file.size;
        request.onProgress?.(event.loaded, total);
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(() => {
          request.onProgress?.(request.file.size, request.file.size);
          resolve();
        });
        return;
      }
      settle(() =>
        reject(
          new SignedUrlUploadError(
            "http",
            `对象存储拒绝了上传（HTTP ${xhr.status}）。`,
            xhr.status,
          ),
        ),
      );
    };
    xhr.onerror = () => {
      settle(() => reject(new SignedUrlUploadError("network", "无法连接对象存储。")));
    };
    xhr.onabort = () => {
      settle(() => reject(new SignedUrlUploadError("aborted", "上传已取消。")));
    };
    xhr.ontimeout = () => {
      settle(() => reject(new SignedUrlUploadError("network", "上传对象存储超时。")));
    };

    xhr.send(request.file);
  });
}

/**
 * Everything the cover uploader needs from the network.
 *
 * Kept as an interface so components and the state machine never talk to the
 * generated client directly and tests can substitute a deterministic double.
 */
export interface CoverMediaClient {
  presign(workspaceId: string, input: MediaPresignRequest): Promise<MediaPresignResponse>;
  putObject(request: PutObjectRequest): Promise<void>;
  complete(mediaId: string, input: CompleteMediaRequest): Promise<Media>;
  fetchMedia(mediaId: string, options?: { signal?: AbortSignal }): Promise<MediaRead>;
  setCover(tripId: string, mediaId: string): Promise<Trip>;
  clearCover(tripId: string, version: number): Promise<Trip>;
}

/**
 * Real implementation over the project's generated API client and contract
 * schemas. Responses are validated before they reach the UI.
 */
export function createCoverMediaClient(): CoverMediaClient {
  return {
    async presign(workspaceId, input) {
      return unwrap(
        await presignMediaUploadRequest(workspaceId, input),
        MediaPresignResponseSchema,
        `/v1/workspaces/${workspaceId}/media/presign`,
      );
    },

    putObject: putObjectToSignedUrl,

    async complete(mediaId, input) {
      return unwrap(
        await completeMediaUploadRequest(mediaId, input),
        MediaSchema,
        `/v1/media/${mediaId}/complete`,
      );
    },

    async fetchMedia(mediaId, options) {
      return unwrap(
        await getMediaRequest(mediaId, options),
        GetMediaResponseSchema,
        `/v1/media/${mediaId}`,
      );
    },

    async setCover(tripId, mediaId) {
      return unwrap(
        await setTripCoverRequest(tripId, { mediaId }),
        TripSchema,
        `/v1/trips/${tripId}/cover`,
      );
    },

    async clearCover(tripId, version) {
      // Clearing is the documented update path: PATCH with `coverMediaId: null`
      // plus the optimistic version the caller read.
      return unwrap(
        await updateTripRequest(tripId, { version, coverMediaId: null }),
        TripSchema,
        `/v1/trips/${tripId}`,
      );
    },
  };
}