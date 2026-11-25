import type { MediaRead } from "@roamlog/contracts";

import { validateCoverFile } from "@/components/media/cover-upload-validation";
import {
  createCoverMediaClient,
  isSignedUrlUploadError,
  type CoverMediaClient,
} from "@/lib/api/media";
import { isApiError } from "@/lib/api/errors";
import {
  isImageCompressionError,
  toWebpFileName,
  type CompressionResult,
} from "@/lib/image/compress-image";
import { compressImage } from "@/lib/image/use-image-compression";

/** First polling delay after `complete`; backs off up to 4 s, like the cover flow. */
export const JOURNAL_IMAGE_POLL_INTERVAL_MS = 1_000;
const JOURNAL_IMAGE_MAX_POLL_INTERVAL_MS = 4_000;
/** Hard ceiling for server-side processing before the UI reports a retryable timeout. */
export const JOURNAL_IMAGE_PROCESS_TIMEOUT_MS = 60_000;

export class JournalImageUploadError extends Error {
  readonly code: "VALIDATION_FAILED" | "PROCESSING_FAILED" | "PROCESSING_TIMEOUT" | "NO_URL";

  constructor(
    code: JournalImageUploadError["code"],
    message: string,
  ) {
    super(message);
    this.name = "JournalImageUploadError";
    this.code = code;
  }
}

export interface UploadJournalImageOptions {
  workspaceId: string;
  tripId?: string | null;
  file: File;
  signal?: AbortSignal;
  /** Test seam; production uses the generated media client. */
  client?: CoverMediaClient;
  /** Test seam; production uses the shared Worker compression pipeline. */
  compressor?: (
    file: File,
    options?: { signal?: AbortSignal },
  ) => Promise<CompressionResult>;
  pollIntervalMs?: number;
  processTimeoutMs?: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("图片上传已取消。", "AbortError");
  }
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("图片上传已取消。", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("图片上传已取消。", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForReady(
  client: CoverMediaClient,
  mediaId: string,
  options: {
    signal?: AbortSignal;
    pollIntervalMs: number;
    processTimeoutMs: number;
  },
): Promise<MediaRead> {
  const startedAt = Date.now();
  let delay = Math.max(1, options.pollIntervalMs);

  for (;;) {
    throwIfAborted(options.signal);
    const media = await client.fetchMedia(mediaId, { signal: options.signal });
    if (media.status === "ready") {
      return media;
    }
    if (media.status === "failed") {
      throw new JournalImageUploadError(
        "PROCESSING_FAILED",
        media.error ?? "图片处理失败，请重试。",
      );
    }

    const remaining = options.processTimeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      throw new JournalImageUploadError("PROCESSING_TIMEOUT", "图片处理超时，请重试。");
    }
    await wait(Math.min(delay, remaining), options.signal);
    delay = Math.min(Math.round(delay * 1.5), JOURNAL_IMAGE_MAX_POLL_INTERVAL_MS);
  }
}

/**
 * Uploads one journal photo through the existing media pipeline:
 * validate/compress → `presign` → signed PUT → `complete` → poll the media read
 * endpoint until the signed display URL is available.
 *
 * The upload itself is not reimplemented here: every network call comes from the
 * same `CoverMediaClient` (`createCoverMediaClient`) the cover/photo uploader
 * uses, so workspace permissions, rate limits, size checks and object storage
 * signing all stay in one place.
 */
export async function uploadJournalImage(
  options: UploadJournalImageOptions,
): Promise<MediaRead> {
  const { file, workspaceId, tripId, signal } = options;
  throwIfAborted(signal);

  const validation = validateCoverFile(file);
  if (!validation.ok) {
    throw new JournalImageUploadError("VALIDATION_FAILED", validation.error.message);
  }

  const compressor = options.compressor ?? compressImage;
  const compression = await compressor(file, { signal });
  throwIfAborted(signal);

  const uploadBlob = compression.full;
  const uploadMimeType = compression.skipped ? validation.mimeType : "image/webp";
  const uploadFileName = compression.skipped ? file.name : toWebpFileName(file.name);
  const client = options.client ?? createCoverMediaClient();

  const presigned = await client.presign(workspaceId, {
    ...(tripId ? { tripId } : {}),
    fileName: uploadFileName,
    mimeType: uploadMimeType,
    size: uploadBlob.size,
    ...(compression.width > 0 ? { width: compression.width } : {}),
    ...(compression.height > 0 ? { height: compression.height } : {}),
  });

  await client.putObject({
    url: presigned.uploadUrl,
    headers: presigned.headers,
    file: uploadBlob,
    signal,
  });
  throwIfAborted(signal);

  const completed = await client.complete(presigned.mediaId, {
    size: uploadBlob.size,
    ...(compression.width > 0 ? { width: compression.width } : {}),
    ...(compression.height > 0 ? { height: compression.height } : {}),
    ...(compression.blurhash ? { blurhash: compression.blurhash } : {}),
  });
  if (completed.status === "failed") {
    throw new JournalImageUploadError(
      "PROCESSING_FAILED",
      completed.error ?? "图片处理失败，请重试。",
    );
  }

  const media = await waitForReady(client, presigned.mediaId, {
    signal,
    pollIntervalMs: options.pollIntervalMs ?? JOURNAL_IMAGE_POLL_INTERVAL_MS,
    processTimeoutMs: options.processTimeoutMs ?? JOURNAL_IMAGE_PROCESS_TIMEOUT_MS,
  });
  if (!media.url) {
    throw new JournalImageUploadError("NO_URL", "图片已上传，但暂时无法显示，请重试。");
  }
  return media;
}

/** Maps every failure the pipeline can throw to a readable, user-facing message. */
export function journalImageUploadErrorMessage(error: unknown): string {
  if (error instanceof JournalImageUploadError) {
    return error.message;
  }
  if (isImageCompressionError(error)) {
    return error.message;
  }
  if (isSignedUrlUploadError(error)) {
    return error.message;
  }
  if (isApiError(error)) {
    if (error.status === 401) {
      return "登录状态已失效，请重新登录后再试。";
    }
    if (error.status === 403) {
      return "当前角色没有上传图片的权限。";
    }
    if (error.status === 413) {
      return "图片超过了允许的大小上限。";
    }
    if (error.status === 415) {
      return "不支持这种图片格式。";
    }
    if (error.status === 429) {
      return "操作太频繁，请稍后再试。";
    }
    if (error.status >= 500) {
      return "图片上传失败，图片服务暂时不可用，请重试。";
    }
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "图片上传失败，请重试。";
}
