"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  IMAGE_MAX_EDGE,
  IMAGE_QUALITY_STEPS,
  IMAGE_TARGET_BYTES,
  ImageCompressionError,
  isImageCompressionError,
  makeSourceOnlyResult,
  type CompressionResult,
  type ImageCompressionProgress,
} from "./compress-image";
import { compressImageOnMainThread } from "./compress-image-main-thread";
import type {
  CompressWorkerRequest,
  CompressWorkerResponse,
} from "./compress-image-protocol";

export interface CompressImageOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ImageCompressionProgress) => void;
  maxEdge?: number;
  targetBytes?: number;
  /** Starting WebP quality from the media policy; defaults to 0.82. */
  quality?: number;
}

export type ImageCompressor = (
  file: File,
  options?: CompressImageOptions,
) => Promise<CompressionResult>;

export interface UseImageCompressionResult {
  compress: ImageCompressor;
  cancel: () => void;
}

const WORKER_TIMEOUT_MS = 45_000;

class WorkerUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "WorkerUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

class AbortedCompressionError extends Error {
  constructor() {
    super("图片压缩已取消。");
    this.name = "AbortError";
  }
}

interface PendingCompression {
  id: number;
  file: File;
  maxEdge: number;
  targetBytes: number;
  quality: number;
  signal: AbortSignal | undefined;
  onProgress: ((progress: ImageCompressionProgress) => void) | undefined;
  resolve: (result: CompressionResult) => void;
  reject: (error: unknown) => void;
  onAbort: () => void;
  settled: boolean;
  cancelled: boolean;
}

/**
 * One Worker per tab, one active compression at a time. Extra selections wait
 * in FIFO order so two 25MB bitmaps cannot coexist on mobile.
 */
class CompressionWorkerClient {
  private worker: Worker | null = null;
  private active: PendingCompression | null = null;
  private queue: PendingCompression[] = [];
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  compress(file: File, options: CompressImageOptions = {}): Promise<CompressionResult> {
    if (options.signal?.aborted) {
      return Promise.reject(new AbortedCompressionError());
    }
    return new Promise<CompressionResult>((resolve, reject) => {
      const id = ++this.sequence;
      const job: PendingCompression = {
        id,
        file,
        maxEdge: options.maxEdge ?? IMAGE_MAX_EDGE,
        targetBytes: options.targetBytes ?? IMAGE_TARGET_BYTES,
        quality: options.quality ?? IMAGE_QUALITY_STEPS[0],
        signal: options.signal,
        onProgress: options.onProgress,
        resolve,
        reject,
        onAbort: () => {
          if (job.settled) return;
          job.cancelled = true;
          if (this.active === job) {
            this.rejectActive(new AbortedCompressionError(), true);
          } else {
            this.settle(job, () => reject(new AbortedCompressionError()));
            this.pump();
          }
        },
        settled: false,
        cancelled: false,
      };
      options.signal?.addEventListener("abort", job.onAbort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (this.active) return;
    let job = this.queue.shift();
    while (job?.cancelled) {
      this.cleanup(job);
      job = this.queue.shift();
    }
    if (!job) return;

    this.active = job;
    try {
      this.ensureWorker();
    } catch (error) {
      this.active = null;
      this.cleanup(job);
      job.reject(new WorkerUnavailableError("图片压缩 Worker 无法启动。", error));
      this.pump();
      return;
    }

    this.timer = setTimeout(() => {
      if (this.active !== job) return;
      this.rejectActive(
        new ImageCompressionError(
          "ENCODE_FAILED",
          "图片压缩超时，请重试或换一张较小的图片。",
          `timeoutMs=${WORKER_TIMEOUT_MS}`,
        ),
        true,
      );
    }, WORKER_TIMEOUT_MS);

    const request: CompressWorkerRequest = {
      id: job.id,
      file: job.file,
      maxEdge: job.maxEdge,
      targetBytes: job.targetBytes,
      quality: job.quality,
    };
    try {
      this.worker?.postMessage(request);
    } catch (error) {
      this.active = null;
      this.cleanup(job);
      job.reject(new WorkerUnavailableError("图片无法发送给压缩 Worker。", error));
      this.resetWorker();
      this.pump();
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./compress-image.worker.ts", import.meta.url), {
      type: "module",
      name: "roamlog-image-compression",
    });
    worker.onmessage = (event: MessageEvent<CompressWorkerResponse>) => {
      this.handleMessage(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      // A load/parse failure means the Worker URL itself is unusable. Let the
      // public pipeline fall back to Canvas instead of failing the upload.
      this.failActive(
        new WorkerUnavailableError("图片压缩 Worker 加载失败。", event.message || "worker error"),
      );
    };
    worker.onmessageerror = () => {
      this.failActive(
        new WorkerUnavailableError("图片压缩结果无法读取，回退到主线程压缩。"),
      );
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(message: CompressWorkerResponse): void {
    const job = this.active;
    if (!job || !message || message.id !== job.id) return;

    if (message.type === "progress") {
      job.onProgress?.(message.progress);
      return;
    }
    if (message.type === "result") {
      this.settle(job, () => job.resolve(message.result));
      this.completeActive();
      return;
    }
    if (message.type === "error") {
      this.settle(job, () =>
        job.reject(
          new ImageCompressionError(
            message.error.code,
            message.error.message,
            message.error.detail,
          ),
        ),
      );
      this.completeActive();
    }
  }

  private failActive(error: Error): void {
    const job = this.active;
    if (!job) {
      this.resetWorker();
      return;
    }
    this.settle(job, () => job.reject(error));
    this.resetWorker();
    this.active = null;
    this.clearTimer();
    this.pump();
  }

  private rejectActive(error: Error, terminate: boolean): void {
    const job = this.active;
    if (!job) return;
    this.settle(job, () => job.reject(error));
    this.active = null;
    this.clearTimer();
    if (terminate) this.resetWorker();
    this.pump();
  }

  private completeActive(): void {
    const job = this.active;
    if (job) this.cleanup(job);
    this.active = null;
    this.clearTimer();
    this.pump();
  }

  private settle(job: PendingCompression, action: () => void): void {
    if (job.settled) return;
    job.settled = true;
    action();
  }

  private cleanup(job: PendingCompression): void {
    job.signal?.removeEventListener("abort", job.onAbort);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private resetWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
}

const singletonClient = new CompressionWorkerClient();

export function isWorkerCompressionSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function"
  );
}

/** jsdom (and very old browsers) expose the element but no 2D backend. */
export function isMainThreadCompressionSupported(): boolean {
  if (
    typeof document === "undefined" ||
    typeof HTMLCanvasElement === "undefined" ||
    typeof CanvasRenderingContext2D === "undefined"
  ) {
    return false;
  }
  try {
    return Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    return false;
  }
}

function sourceOnlyFallback(
  file: File,
  options: CompressImageOptions,
): CompressionResult {
  console.warn("[image-compression] 当前环境没有 Canvas 2D，跳过压缩并直接上传原图。");
  options.onProgress?.({
    percent: 100,
    stage: "blurhash",
    iteration: 0,
    quality: 1,
  });
  return makeSourceOnlyResult(file);
}

/** The public pipeline: Worker first, main-thread Canvas fallback otherwise. */
export async function compressImage(
  file: File,
  options: CompressImageOptions = {},
): Promise<CompressionResult> {
  if (options.signal?.aborted) throw new AbortedCompressionError();
  if (!isWorkerCompressionSupported()) {
    if (!isMainThreadCompressionSupported()) {
      return sourceOnlyFallback(file, options);
    }
    return compressImageOnMainThread(file, options);
  }
  try {
    return await singletonClient.compress(file, options);
  } catch (error) {
    if (
      error instanceof WorkerUnavailableError &&
      !options.signal?.aborted
    ) {
      console.warn(
        "[image-compression] 压缩 Worker 不可用，回退到主线程压缩。",
        error.message,
      );
      if (!isMainThreadCompressionSupported()) {
        return sourceOnlyFallback(file, options);
      }
      return compressImageOnMainThread(file, options);
    }
    throw error;
  }
}

/**
 * React wrapper around the singleton Worker client. Each hook call gets its own
 * cancellation scope; the underlying Worker is shared and serializes work.
 */
export function useImageCompression(): UseImageCompressionResult {
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const compress = useCallback<ImageCompressor>(async (file, options = {}) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const onExternalAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      return await compressImage(file, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      options.signal?.removeEventListener("abort", onExternalAbort);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  return { compress, cancel };
}

export { ImageCompressionError, isImageCompressionError };
export type { CompressionResult, ImageCompressionProgress };