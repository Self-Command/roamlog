"use client";

import {
  BasePlugin,
  EventManager,
  type Body,
  type DefinePluginOpts,
  type Meta,
  type PluginOpts,
  type Uppy,
  type UppyFile,
} from "@uppy/core";
import {
  filterFilesToEmitUploadStarted,
  filterFilesToUpload,
  isAbortError,
  TaskQueue,
  toError,
} from "@uppy/core/utils";

import { isApiError } from "@/lib/api";
import {
  createCoverMediaClient,
  isSignedUrlUploadError,
  type CoverMediaClient,
} from "@/lib/api/media";
import {
  IMAGE_MAX_EDGE,
  IMAGE_QUALITY_STEPS,
  IMAGE_TARGET_BYTES,
  isImageCompressionError,
  toWebpFileName,
} from "@/lib/image/compress-image";
import {
  readPhotoExif,
  readPhotoExifSafely,
  type PhotoExifRead,
  type PhotoExifReader,
} from "@/lib/image/read-photo-exif";
import { compressImage } from "@/lib/image/use-image-compression";
import { formatBytes } from "@/lib/format-bytes";
import type { CompleteMediaRequest, Media } from "@roamlog/contracts";

import {
  PHOTO_UPLOAD_CONCURRENCY,
  presignRateLimitMessage,
} from "./photo-upload-limits";

/**
 * Uppy uploader plugin for the three-step Roamlog media pipeline.
 *
 * Transcribed from `@uppy/xhr-upload/src/index.ts`
 * (transloadit/uppy @ 4c7fed69a67c6112c7e2134cd372a25140a8ca12, MIT):
 * the plugin type (`type = 'uploader'`, `:181`), the `addUploader` registration
 * (`:569`/`:583`), the `TaskQueue` concurrency (`:188`), the event contract
 * (`upload-start` `:533-535`, `upload-progress` `:238`, `upload-success`
 * `:267`, `upload-error` `:285-292`) and the per-file `EventManager` abort wiring
 * (`:394-398`).
 *
 * What could not be transcribed: XHRUpload sends one multipart request. This
 * pipeline is `presign → signed PUT → complete`, with a browser canvas re-encode
 * and a pre-compression EXIF read in front of it, so `#uploadLocalFile` is
 * rewritten around `CoverMediaClient` while keeping every branch and event of
 * the upstream skeleton.
 *
 * Guarantees that matter to the UI:
 * - one photo failing never rejects the batch (`Promise.allSettled` + a handled
 *   per-file catch, exactly like upstream `:488-514`);
 * - `upload-start` always precedes progress so Uppy stamps `uploadStarted`;
 * - removal / cancel-all aborts the in-flight presign/PUT/complete.
 */

export interface RoamlogUploaderOptions extends PluginOpts {
  /** Workspace that owns the media asset; presign is workspace-scoped. */
  workspaceId: string;
  /** Trip the photos belong to. `null` uploads to the workspace library. */
  tripId?: string | null;
  /** Network seam; production uses the generated API client. */
  client?: CoverMediaClient;
  /** Parallel uploads. Three keeps the canvas decode peak ~36 MB. */
  concurrency?: number;
  /** Source-file ceiling from the server's limits; omitted when unknown. */
  maxBytes?: number;
  /** Presign quota from the server, used only for the `429` copy. */
  presignPerMinute?: number;
  /** Long edge kept by the browser compressor. */
  maxEdge?: number;
  /** Byte budget the compressor aims for. */
  targetBytes?: number;
  /** Starting WebP quality. */
  quality?: number;
  /** Test/embedding seam for the pre-compression EXIF read. */
  exifReader?: PhotoExifReader;
  /** Called once per completed photo with the server's read model. */
  onMediaUploaded?: (media: Media) => void;
}

const defaultOptions = {
  concurrency: PHOTO_UPLOAD_CONCURRENCY,
  maxEdge: IMAGE_MAX_EDGE,
  targetBytes: IMAGE_TARGET_BYTES,
  quality: IMAGE_QUALITY_STEPS[0],
} satisfies Partial<RoamlogUploaderOptions>;

type Opts = DefinePluginOpts<RoamlogUploaderOptions, keyof typeof defaultOptions>;

/** One signed PUT may take this long on a slow mobile network, then retries. */
const PUT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

class UploadTimeout extends Error {
  constructor() {
    super("上传对象存储超时（60 秒）。");
    this.name = "UploadTimeout";
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** A signed PUT aborts itself at `PUT_TIMEOUT_MS`; user cancels still win. */
function withPutTimeout(signal: AbortSignal): {
  signal: AbortSignal;
  didTimeOut: () => boolean;
  dispose: () => void;
} {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new UploadTimeout()), PUT_TIMEOUT_MS);
  return {
    signal: AbortSignal.any([signal, timeout.signal]),
    didTimeOut: () => timeout.signal.aborted && !signal.aborted,
    dispose: () => clearTimeout(timer),
  };
}

/**
 * Maps the pre-compression read onto the `complete` body.
 *
 * Same rule as the cover uploader: `lat`/`lng` are emitted as a pair or not at
 * all, because the contract rejects a half-position and the database CHECK
 * would surface one as a 500.
 */
function completionExif(read: PhotoExifRead | null): {
  exif?: PhotoExifRead["exif"];
  lat?: number;
  lng?: number;
} {
  if (!read) return {};
  return read.lat !== null && read.lng !== null
    ? { exif: read.exif, lat: read.lat, lng: read.lng }
    : { exif: read.exif };
}

/**
 * Errors a retry can plausibly fix.
 *
 * `429` is deliberately **not** retryable: the server's per-account presign
 * guard charges the requested links before it answers, so retrying inside the
 * same window spends more of the allowance and still fails. The UI surfaces the
 * server's `presignPerMinute` in the message and the user retries after the
 * window. `400/403/413/415` are never retryable either.
 */
function isRetryable(cause: unknown): boolean {
  if (isApiError(cause)) {
    return cause.status >= 500;
  }
  if (isSignedUrlUploadError(cause)) {
    if (cause.code === "network") return true;
    return cause.status !== null && cause.status >= 500;
  }
  return false;
}

/** One readable Chinese sentence per failure; the Dashboard item shows it. */
function describeFailure(cause: unknown, presignPerMinute?: number): string {
  if (isApiError(cause)) {
    switch (cause.status) {
      case 401:
        return "登录状态已失效，请刷新页面后重新上传。";
      case 403:
        return "当前角色不能上传照片。";
      case 413:
        return "照片超过允许的大小，没有上传。";
      case 415:
        return "不支持这种图片格式。";
      case 429:
        return presignRateLimitMessage(presignPerMinute);
      default:
        if (cause.status >= 500) return "服务器暂时无法完成上传，请稍后重试。";
    }
    return cause.message;
  }
  if (isSignedUrlUploadError(cause)) {
    if (cause.code === "aborted") return "上传已取消。";
    if (cause.code === "network") return "网络中断，照片没有上传。";
    return cause.message;
  }
  if (isImageCompressionError(cause)) {
    return `这张照片无法压缩：${cause.message}`;
  }
  if (cause instanceof UploadTimeout) return cause.message;
  return cause instanceof Error ? cause.message : "上传失败。";
}

export class RoamlogUploader<M extends Meta, B extends Body> extends BasePlugin<
  Opts,
  M,
  B
> {
  #queue: TaskQueue;
  #client: CoverMediaClient;

  constructor(uppy: Uppy<M, B>, opts: RoamlogUploaderOptions) {
    super(uppy, { ...defaultOptions, ...opts });
    this.type = "uploader";
    this.id = this.opts.id ?? "RoamlogUploader";
    this.#queue = new TaskQueue({ concurrency: this.opts.concurrency });
    this.#client = opts.client ?? createCoverMediaClient();
  }

  override install(): void {
    this.uppy.addUploader(this.#handleUpload);
  }

  override uninstall(): void {
    this.uppy.removeUploader(this.#handleUpload);
    this.#queue.clear("RoamlogUploader removed");
  }

  #handleUpload = async (fileIDs: string[], _uploadID: string): Promise<void> => {
    if (fileIDs.length === 0) {
      this.uppy.log("[RoamlogUploader] No files to upload!");
      return;
    }
    this.uppy.log("[RoamlogUploader] Uploading...");
    const files = this.uppy.getFilesByIds(fileIDs);

    const filesFiltered = filterFilesToUpload(files);
    const filesToEmit = filterFilesToEmitUploadStarted(filesFiltered);
    this.uppy.emit("upload-start", filesToEmit);

    await this.#uploadFiles(filesFiltered);
  };

  async #uploadFiles(files: UppyFile<M, B>[]): Promise<void> {
    // `allSettled` is upstream's rule (`:489`): one bad photo must not reject
    // the batch. `#uploadLocalFile` already converts failures into
    // `upload-error` events, so nothing below throws for a normal bad file.
    await Promise.allSettled(files.map((file) => this.#uploadLocalFile(file)));
  }

  async #uploadLocalFile(file: UppyFile<M, B>): Promise<void> {
    if (file.isRemote) {
      this.#emitUploadError(file, new Error("远程文件不支持批量照片上传。"));
      return;
    }

    const events = new EventManager(this.uppy);
    const controller = new AbortController();
    events.onFileRemove(file.id, () => controller.abort());
    events.onCancelAll(file.id, () => controller.abort());

    try {
      await this.#queue.add(async (queueSignal) => {
        const signal = AbortSignal.any([queueSignal, controller.signal]);
        try {
          await this.#uploadOne(file, signal);
        } catch (cause) {
          if (isAbortError(cause) || signal.aborted) return;
          this.#emitUploadError(file, cause);
        }
      });
    } catch (cause) {
      if (isAbortError(cause)) return;
      throw cause;
    } finally {
      events.remove();
    }
  }

  async #uploadOne(file: UppyFile<M, B>, signal: AbortSignal): Promise<void> {
    const data = file.data;
    if (!(data instanceof Blob) || data.size <= 0) {
      throw new Error("这个文件没有可供上传的内容。");
    }
    // The server limit is the only source of this number; Uppy's restriction is
    // the same value when the limits endpoint answered. This guard covers the
    // "limits unavailable" path without inventing a fallback threshold.
    if (this.opts.maxBytes !== undefined && data.size > this.opts.maxBytes) {
      throw new Error(
        `「${file.name}」超过单张 ${formatBytes(this.opts.maxBytes)} 的上限，没有上传。`,
      );
    }
    // EXIF is read from the source `File` **before** the canvas re-encode: the
    // re-encode carries none of the camera tags and the original is never
    // uploaded (see `read-photo-exif.ts`).
    const source =
      data instanceof File ? data : new File([data], file.name, { type: file.type });
    const exifReader = this.opts.exifReader ?? readPhotoExif;
    const photoExif = await readPhotoExifSafely(exifReader, source);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const current = this.uppy.getFile(file.id);
    this.uppy.emit("preprocess-progress", current, {
      mode: "determinate",
      message: "正在压缩图片",
      value: 0,
    });
    const compressed = await compressImage(source, {
      signal,
      maxEdge: this.opts.maxEdge,
      targetBytes: this.opts.targetBytes,
      quality: this.opts.quality,
      onProgress: (progress) => {
        const state = this.uppy.getFile(file.id);
        if (!state || signal.aborted) return;
        this.uppy.emit("preprocess-progress", state, {
          mode: "determinate",
          message: progress.stage === "decoding" ? "正在读取图片" : "正在压缩图片",
          value: progress.percent,
        });
      },
    });
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    this.uppy.emit("preprocess-complete", this.uppy.getFile(file.id));

    const uploadBlob = compressed.full;
    const mimeType = compressed.skipped ? (file.type || "image/jpeg") : "image/webp";
    const fileName = compressed.skipped ? file.name : toWebpFileName(file.name);

    const presigned = await this.#withRetry(
      () =>
        this.#client.presign(this.opts.workspaceId, {
          ...(this.opts.tripId ? { tripId: this.opts.tripId } : {}),
          fileName,
          mimeType,
          size: uploadBlob.size,
          ...(compressed.width > 0 ? { width: compressed.width } : {}),
          ...(compressed.height > 0 ? { height: compressed.height } : {}),
        }),
      signal,
    );

    const putTimeout = withPutTimeout(signal);
    try {
      await this.#withRetry(
        () =>
          this.#client.putObject({
            url: presigned.uploadUrl,
            headers: presigned.headers,
            file: uploadBlob,
            signal: putTimeout.signal,
            onProgress: (loaded, total) => {
              const state = this.uppy.getFile(file.id);
              if (!state) return;
              this.uppy.emit("upload-progress", state, {
                uploadStarted: state.progress.uploadStarted ?? Date.now(),
                bytesUploaded: loaded,
                bytesTotal: total > 0 ? total : uploadBlob.size,
              });
            },
          }),
        putTimeout.signal,
      );
    } catch (cause) {
      if (putTimeout.didTimeOut() && !signal.aborted) throw new UploadTimeout();
      throw cause;
    } finally {
      putTimeout.dispose();
    }

    const completion: CompleteMediaRequest = {
      size: uploadBlob.size,
      ...(compressed.width > 0 ? { width: compressed.width } : {}),
      ...(compressed.height > 0 ? { height: compressed.height } : {}),
      ...(compressed.blurhash ? { blurhash: compressed.blurhash } : {}),
      ...completionExif(photoExif),
    };
    const media = await this.#withRetry(
      () => this.#client.complete(presigned.mediaId, completion),
      signal,
    );
    if (signal.aborted) return;

    // Uppy only finishes the file card when it receives this event; skipping it
    // leaves the UI stuck in "uploading" forever (core's upload-success handler
    // sets `uploadComplete` / `percentage: 100`).
    this.uppy.setFileMeta(file.id, { mediaId: media.id } as unknown as M);
    this.uppy.emit("upload-success", this.uppy.getFile(file.id), {
      status: 201,
      body: media as unknown as B,
    });
    this.opts.onMediaUploaded?.(media);
  }

  async #withRetry<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await task();
      } catch (cause) {
        if (signal.aborted || attempt >= MAX_RETRIES || !isRetryable(cause)) {
          throw cause;
        }
        attempt += 1;
        await sleep(1_000 * 2 ** (attempt - 1), signal);
      }
    }
  }

  #emitUploadError(file: UppyFile<M, B>, cause: unknown): void {
    const error = toError(cause);
    error.message = describeFailure(cause, this.opts.presignPerMinute);
    this.uppy.emit("upload-error", this.uppy.getFile(file.id), error);
  }
}

export default RoamlogUploader;
