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
 * `MediaPresignRequestSchema` caps uploads at 25 MB and accepts exactly these
 * six image types; `apps/api/src/modules/media/media-rules.ts` enforces the same
 * values (`MAX_MEDIA_BYTES`, `ALLOWED_IMAGE_MIME_TYPES`). The web app cannot
 * import the API package, so the constants live here and every selection is
 * re-checked against `MediaPresignRequestSchema` to prevent drift.
 */
export const COVER_MAX_BYTES = 25 * 1024 * 1024;

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