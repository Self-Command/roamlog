import {
  deleteMyAccount as deleteMyAccountRequest,
  listMySessions as listMySessionsRequest,
  revokeMySession as revokeMySessionRequest,
} from "@roamlog/api-client";
import {
  SessionListResponseSchema,
  type MediaRead,
  type Session,
} from "@roamlog/contracts";

import { ApiError } from "./errors";
import { createCoverMediaClient, type CoverMediaClient } from "./media";
import { unwrap, unwrapMessage } from "./shared";

/**
 * Account-level API used by the settings IA (`/w/<slug>/settings/*`).
 *
 * Everything here is a thin adapter over endpoints that already exist:
 * - `PATCH /v1/me` for profile fields (`updateMe` lives in the shared data
 *   adapter, so this module never duplicates it);
 * - the media pipeline (`presign → PUT → complete → GET /v1/media/:id`) for the
 *   avatar, exactly the chain `components/media/use-cover-upload.ts` runs for a
 *   trip cover;
 * - `GET/DELETE /v1/me/sessions` for the device list.
 *
 * `User.image` is a URL in the contract (`UserSchema.image = z.url().nullable()`
 * in `packages/contracts/src/entities/user.ts`), but the API never persists the
 * *signed* URL: `PATCH /v1/me { image: <upload url> }` recovers the media id from
 * the object key and stores that
 * (`apps/api/src/modules/users/avatar-image.ts`), then re-signs it on every
 * `GET /v1/me`. The uploaded `mediaId` is therefore still returned here — it is
 * the stable identity the server keeps, and the URL is only a 15-minute view of
 * it (`apps/api/src/modules/users/users.service.ts:presentAccount`).
 */

/** Farthest the presign → complete → processing chain may take before failing. */
export const AVATAR_UPLOAD_TIMEOUT_MS = 60_000;
/** First poll delay after `complete`; backs off to this ceiling. */
export const AVATAR_POLL_INTERVAL_MS = 1_000;
const AVATAR_POLL_MAX_INTERVAL_MS = 4_000;
/** Upload progress owns 0–90%; server-side processing fills the rest. */
const UPLOAD_PROGRESS_END = 90;
const COMPLETED_PROGRESS = 92;
const PROCESSING_PROGRESS = 96;

export type AvatarUploadPhase =
  | "idle"
  | "validating"
  | "presigning"
  | "uploading"
  | "completing"
  | "processing"
  | "done";

export interface AvatarUploadFailure {
  code: "VALIDATION" | "PRESIGN" | "UPLOAD" | "COMPLETE" | "PROCESSING" | "ABORTED";
  message: string;
}

export class AvatarUploadError extends Error {
  readonly code: AvatarUploadFailure["code"];

  constructor(code: AvatarUploadFailure["code"], message: string) {
    super(message);
    this.name = "AvatarUploadError";
    this.code = code;
  }
}

export function isAvatarUploadError(value: unknown): value is AvatarUploadError {
  return value instanceof AvatarUploadError;
}

export interface AvatarUploadResult {
  mediaId: string;
  /**
   * Signed display URL of the upload. `PATCH /v1/me` sends it because the
   * contract's `image` field is a URL; the API converts it back to {@link mediaId}
   * before writing, so this URL never becomes the stored value. `thumbUrl` is
   * preferred because the avatar never renders larger than the settings preview.
   */
  url: string;
  /** Expiry of {@link url}; `null` only if the API omitted it. */
  expiresAt: string | null;
}

export interface UploadAvatarOptions {
  workspaceId: string;
  file: File;
  /** Resolved MIME type, already checked against the media presign contract. */
  mimeType: string;
  signal?: AbortSignal;
  onPhase?: (phase: AvatarUploadPhase) => void;
  onProgress?: (percent: number) => void;
  /** Test/embedding seam; production uses the shared media client. */
  client?: CoverMediaClient;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

function abortError(): AvatarUploadError {
  return new AvatarUploadError("ABORTED", "上传已取消。");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(abortError());
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs the media upload chain and waits until the worker has produced the
 * display variants, so the caller never persists a `url` for a `pending` asset.
 */
export async function uploadAvatar(options: UploadAvatarOptions): Promise<AvatarUploadResult> {
  const {
    workspaceId,
    file,
    mimeType,
    signal,
    onPhase,
    onProgress,
    pollIntervalMs = AVATAR_POLL_INTERVAL_MS,
    timeoutMs = AVATAR_UPLOAD_TIMEOUT_MS,
  } = options;
  const client = options.client ?? createCoverMediaClient();
  const report = (phase: AvatarUploadPhase) => onPhase?.(phase);

  if (signal?.aborted) throw abortError();

  report("presigning");
  let presign;
  try {
    presign = await client.presign(workspaceId, {
      fileName: file.name || "avatar",
      mimeType,
      size: file.size,
    });
  } catch (cause) {
    throw new AvatarUploadError("PRESIGN", errorMessage(cause, "无法开始上传，请稍后重试。"));
  }

  report("uploading");
  try {
    await client.putObject({
      url: presign.uploadUrl,
      headers: presign.headers,
      file,
      signal,
      onProgress: (loaded, total) => {
        const ratio = total > 0 ? loaded / total : 1;
        onProgress?.(Math.min(UPLOAD_PROGRESS_END, Math.round(ratio * UPLOAD_PROGRESS_END)));
      },
    });
  } catch (cause) {
    if (isAvatarUploadError(cause)) throw cause;
    throw new AvatarUploadError("UPLOAD", errorMessage(cause, "图片上传失败，请检查网络后重试。"));
  }

  report("completing");
  onProgress?.(COMPLETED_PROGRESS);
  try {
    await client.complete(presign.mediaId, { size: file.size });
  } catch (cause) {
    throw new AvatarUploadError("COMPLETE", errorMessage(cause, "上传已完成但登记失败，请重试。"));
  }

  report("processing");
  onProgress?.(PROCESSING_PROGRESS);

  const startedAt = Date.now();
  let interval = pollIntervalMs;
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw abortError();
    let media: MediaRead;
    try {
      media = await client.fetchMedia(presign.mediaId, signal ? { signal } : undefined);
    } catch (cause) {
      if (signal?.aborted || isAvatarUploadError(cause)) {
        if (signal?.aborted) throw abortError();
      }
      throw new AvatarUploadError("PROCESSING", errorMessage(cause, "无法读取上传结果，请重试。"));
    }

    if (media.status === "failed") {
      throw new AvatarUploadError("PROCESSING", "图片处理失败，请换一张图片重试。");
    }
    const url = media.thumbUrl ?? media.url;
    if (media.status === "ready" && url) {
      report("done");
      onProgress?.(100);
      return { mediaId: media.id, url, expiresAt: media.expiresAt };
    }

    await sleep(interval, signal);
    interval = Math.min(AVATAR_POLL_MAX_INTERVAL_MS, Math.round(interval * 1.5));
  }

  throw new AvatarUploadError("PROCESSING", "图片处理超时，请稍后在头像处重试。");
}

/** Query key for `GET /v1/me/sessions`; exported so callers stay consistent. */
export const MY_SESSIONS_QUERY_KEY = ["v1", "me", "sessions"] as const;

export async function listMySessions(options?: { signal?: AbortSignal }): Promise<Session[]> {
  return unwrap(
    await listMySessionsRequest(options),
    SessionListResponseSchema,
    "/v1/me/sessions",
  );
}

/** `DELETE /v1/me/sessions/:id` — revokes exactly one device. */
export async function revokeMySession(sessionId: string): Promise<void> {
  unwrapMessage(await revokeMySessionRequest(sessionId), `/v1/me/sessions/${sessionId}`);
}

/**
 * `DELETE /v1/me` — anonymizes the account and deletes its sessions.
 *
 * The API refuses with `OWNER_MUST_TRANSFER_OR_DELETE_WORKSPACE` while the user
 * still owns an active Workspace, so the UI surfaces that as a readable error
 * instead of pretending the deletion happened.
 */
export async function deleteMyAccount(): Promise<void> {
  unwrapMessage(
    await deleteMyAccountRequest({ confirmation: "DELETE" }),
    "/v1/me",
  );
}

/**
 * Extracts the media id from a stored `User.image` URL.
 *
 * The signed URL keeps the object key the API built in `buildMediaKey`
 * (`<workspaceId>/<yyyy>/<mm>/<mediaId>/<variant>.<ext>`), so the id stays
 * recoverable without adding a column to the user row.
 */
export function mediaIdFromImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[a-z0-9-]+\.(?:webp|jpe?g|png|avif|heic|heif)(?:\?|$)/i,
  );
  return match?.[1] ?? null;
}

/**
 * Expiry of an S3 SigV4 signed URL, read from its own query string.
 *
 * `null` means "not a signed media URL" (or it carries no expiry), which is the
 * normal result for avatars that were never uploaded through the media
 * pipeline.
 */
export function signedUrlExpiresAt(url: string | null | undefined): Date | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const expires = Number(parsed.searchParams.get("X-Amz-Expires"));
  const date = parsed.searchParams.get("X-Amz-Date");
  if (!Number.isFinite(expires) || expires <= 0 || !date) return null;
  const issued = parseAmzDate(date);
  if (issued === null) return null;
  return new Date(issued + expires * 1_000);
}

/** `20261120T105918Z` → epoch ms. */
function parseAmzDate(value: string): number | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

/**
 * True when a stored avatar URL has already expired or expires within the next
 * minute, so the settings page can say so instead of silently rendering initials.
 */
export function isImageUrlExpired(url: string | null | undefined, now = Date.now()): boolean {
  const expiresAt = signedUrlExpiresAt(url);
  if (!expiresAt) return false;
  return expiresAt.getTime() - now <= 60_000;
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return cause.message || fallback;
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}