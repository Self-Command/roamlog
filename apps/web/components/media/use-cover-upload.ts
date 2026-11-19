"use client";

import type { MediaPresignResponse, MediaRead, Trip } from "@roamlog/contracts";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createCoverMediaClient, type CoverMediaClient } from "@/lib/api/media";
import {
  useMediaCompressionPolicy,
  type MediaCompressionPolicy,
} from "@/lib/settings";
import {
  isImageCompressionError,
  toWebpFileName,
  type CompressionResult,
} from "@/lib/image/compress-image";
import { useImageCompression, type ImageCompressor } from "@/lib/image/use-image-compression";
import { queryKeys } from "@/lib/query";

import {
  compressionFailure,
  mapCoverFailure,
  processingFailure,
  signatureExpiredError,
  type CoverUploadError,
  type CoverUploadOperation,
  type CoverUploadPhase,
} from "./cover-upload-error";
import { validateCoverFile } from "./cover-upload-validation";

/** First polling delay after `complete`; the delay backs off up to 4 s. */
export const COVER_POLL_INTERVAL_MS = 1_000;
/** Hard ceiling for "processing" before the UI reports a retryable timeout. */
export const COVER_PROCESS_TIMEOUT_MS = 60_000;
const MAX_COVER_POLL_INTERVAL_MS = 4_000;

const BUSY_PHASES: ReadonlySet<CoverUploadPhase> = new Set([
  "validating",
  "compressing",
  "presigning",
  "uploading",
  "completing",
  "processing",
  "applying",
]);

const STEP_INDEX: Readonly<Record<string, number>> = {
  validating: 0,
  compressing: 1,
  presigning: 2,
  uploading: 3,
  completing: 4,
  processing: 5,
  applying: 6,
};

/** Compression owns the first 20% of the combined progress bar. */
const COMPRESS_PROGRESS_END = 20;
/** Upload owns 20–90%, leaving the last 10% for server finalization. */
const UPLOAD_PROGRESS_START = 20;
const UPLOAD_PROGRESS_END = 90;
const COMPLETING_PROGRESS = 92;
const PROCESSING_PROGRESS = 96;
const APPLYING_PROGRESS = 98;

const KEEP_ORIGINAL_STORAGE_KEY = "roamlog.media.keepOriginal";

function resolveKeepOriginal(explicit: boolean | undefined): boolean {
  if (typeof explicit === "boolean") return explicit;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEEP_ORIGINAL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export interface CoverTransition {
  phase: CoverUploadPhase;
  previous: CoverUploadPhase;
  operation: CoverUploadOperation | null;
  attempt: number;
  at: string;
}

export interface UseCoverUploadOptions {
  workspaceId: string;
  /** Missing for the create-trip flow: upload only, the caller applies the cover later. */
  tripId?: string | null;
  /** Optimistic version of the trip handed in, required to clear a cover. */
  tripVersion?: number | null;
  client?: CoverMediaClient;
  onCoverChange?: (trip: Trip) => void;
  onMediaReady?: (media: MediaRead) => void;
  onError?: (error: CoverUploadError) => void;
  onTransition?: (transition: CoverTransition) => void;
  maxBytes?: number;
  pollIntervalMs?: number;
  processTimeoutMs?: number;
  /**
   * Media compression policy. Omitted on the normal path: the hook reads the
   * public `media.*` settings through the shared 30s cache. CoverUploader
   * passes an already-resolved policy so the console change reaches the very
   * next upload; tests inject one to stay off the network.
   */
  mediaPolicy?: MediaCompressionPolicy;
  /** Test/embedding seam; production uses the singleton Worker pipeline. */
  compressor?: ImageCompressor;
  /**
   * D2 will upload the untouched source as well. D1 only records this preference
   * so the switch can ship without changing the number of uploads.
   */
  keepOriginal?: boolean;
}

export interface CoverUploadState {
  phase: CoverUploadPhase;
  progress: number | null;
  error: CoverUploadError | null;
  file: File | null;
  previewUrl: string | null;
  mediaId: string | null;
  media: MediaRead | null;
  updatedTrip: Trip | null;
  lastOperation: CoverUploadOperation | null;
}

export interface UseCoverUploadResult extends CoverUploadState {
  isBusy: boolean;
  canRetry: boolean;
  selectFile(file: File): void;
  retry(): void;
  reset(): void;
  remove(): void;
}

interface UploadAttempt {
  operation: CoverUploadOperation;
  file: File | null;
  mimeType: string | null;
  mediaId: string | null;
  upload: MediaPresignResponse | null;
  /** Populated after compression (or points at the source when skipped). */
  uploadBlob: Blob | null;
  uploadMimeType: string | null;
  uploadFileName: string | null;
  compression: CompressionResult | null;
  keepOriginal: boolean;
  applyAfterReady: boolean;
  tripVersion: number | null;
}

const INITIAL_STATE: CoverUploadState = {
  phase: "idle",
  progress: null,
  error: null,
  file: null,
  previewUrl: null,
  mediaId: null,
  media: null,
  updatedTrip: null,
  lastOperation: null,
};

class UploadAborted extends Error {
  constructor() {
    super("Cover upload aborted.");
    this.name = "UploadAborted";
  }
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof UploadAborted ||
    (error instanceof Error && error.name === "AbortError")
  );
}

class ProcessingFailure extends Error {
  readonly code: "PROCESSING_FAILED" | "PROCESSING_TIMEOUT";
  readonly detail: string | undefined;

  constructor(code: "PROCESSING_FAILED" | "PROCESSING_TIMEOUT", detail?: string) {
    super(detail ?? code);
    this.name = "ProcessingFailure";
    this.code = code;
    this.detail = detail;
  }
}

function stepIndex(phase: CoverUploadPhase): number {
  return STEP_INDEX[phase] ?? 0;
}

function createPreviewUrl(file: File): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function revokeObjectUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Revoking an already-released URL must never break the upload flow.
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new UploadAborted());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadAborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface PollOptions {
  client: CoverMediaClient;
  mediaId: string;
  signal: AbortSignal;
  alive: () => boolean;
  timeoutMs: number;
  intervalMs: number;
}

/** Polls GET /v1/media/{id} with backoff until `ready`, `failed`, or timeout. */
async function pollForReady(options: PollOptions): Promise<MediaRead> {
  const startedAt = Date.now();
  let delay = Math.max(1, options.intervalMs);

  for (;;) {
    if (!options.alive()) throw new UploadAborted();
    const media = await options.client.fetchMedia(options.mediaId, { signal: options.signal });
    if (!options.alive()) throw new UploadAborted();
    if (media.status === "ready") return media;
    if (media.status === "failed") {
      throw new ProcessingFailure("PROCESSING_FAILED", media.error ?? undefined);
    }

    const remaining = options.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new ProcessingFailure("PROCESSING_TIMEOUT");
    await wait(Math.min(delay, remaining), options.signal);
    delay = Math.min(Math.round(delay * 1.5), MAX_COVER_POLL_INTERVAL_MS);
  }
}

function invalidateCoverQueries(
  queryClient: QueryClient,
  workspaceId: string,
  tripId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.trips(workspaceId).slice(0, 3) });
}

/**
 * Drives a real cover upload through the server pipeline:
 *
 * `idle → validating → compressing → presigning → uploading → completing → processing → applying → ready`
 *
 * Compression runs in the singleton Worker and produces the WebP that is
 * presigned and uploaded. Small sources skip re-encoding and upload untouched.
 *
 * Every network URL comes from the presign response; progress comes from the PUT
 * itself; `processing` is polled through the media read endpoint. Failures keep
 * the selected file and expose `error.resumeAt`, so a retry resumes at the exact
 * step that failed instead of restarting the upload.
 */
export function useCoverUpload(options: UseCoverUploadOptions): UseCoverUploadResult {
  const { client: providedClient } = options;
  const queryClient = useQueryClient();
  const client = useMemo(
    () => providedClient ?? createCoverMediaClient(),
    [providedClient],
  );
  const { compress: workerCompress } = useImageCompression();
  // `enabled` keeps the hook order stable while letting an injected policy
  // (CoverUploader, tests) skip the public-settings request entirely.
  const settingsPolicy = useMediaCompressionPolicy({
    enabled: options.mediaPolicy === undefined,
  });
  const mediaPolicy = options.mediaPolicy ?? settingsPolicy;

  const [state, setState] = useState<CoverUploadState>(INITIAL_STATE);
  const stateRef = useRef<CoverUploadState>(INITIAL_STATE);
  const optionsRef = useRef<UseCoverUploadOptions>(options);
  const phaseRef = useRef<CoverUploadPhase>("idle");
  const attemptRef = useRef<UploadAttempt | null>(null);
  const attemptNumberRef = useRef(0);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<string | null>(null);
  const lastProgressRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      const preview = previewRef.current;
      previewRef.current = null;
      if (preview) revokeObjectUrl(preview);
    };
  }, []);

  const enter = useCallback((phase: CoverUploadPhase) => {
    const previous = phaseRef.current;
    if (previous === phase) return;
    phaseRef.current = phase;
    setState((current) => ({ ...current, phase }));
    optionsRef.current.onTransition?.({
      phase,
      previous,
      operation: attemptRef.current?.operation ?? null,
      attempt: attemptNumberRef.current,
      at: new Date().toISOString(),
    });
  }, []);

  const reportProgress = useCallback((percent: number) => {
    const clamped = Math.min(99, Math.max(0, Math.round(percent)));
    if (lastProgressRef.current === clamped) return;
    lastProgressRef.current = clamped;
    setState((current) => ({ ...current, progress: clamped }));
  }, []);

  const reportCompressionProgress = useCallback(
    (percent: number) => {
      reportProgress((Math.min(100, Math.max(0, percent)) / 100) * COMPRESS_PROGRESS_END);
    },
    [reportProgress],
  );

  const reportUploadProgress = useCallback(
    (loaded: number, total: number) => {
      const ratio = total > 0 ? loaded / total : 0;
      reportProgress(
        UPLOAD_PROGRESS_START + Math.min(1, Math.max(0, ratio)) * (UPLOAD_PROGRESS_END - UPLOAD_PROGRESS_START),
      );
    },
    [reportProgress],
  );

  const revokePreview = useCallback(() => {
    const preview = previewRef.current;
    previewRef.current = null;
    if (preview) revokeObjectUrl(preview);
    setState((current) =>
      current.previewUrl === null ? current : { ...current, previewUrl: null },
    );
  }, []);

  const fail = useCallback(
    (error: CoverUploadError) => {
      enter("error");
      setState((current) => ({ ...current, phase: "error", error, progress: null }));
      optionsRef.current.onError?.(error);
    },
    [enter],
  );

  const finish = useCallback(
    (updatedTrip: Trip | null, media: MediaRead | null, operation: CoverUploadOperation) => {
      const serverCover = updatedTrip?.cover;
      const hasServerCover = Boolean(serverCover?.url || serverCover?.thumbUrl);
      if (hasServerCover) revokePreview();
      enter("ready");
      setState((current) => ({
        ...current,
        phase: "ready",
        progress: null,
        error: null,
        lastOperation: operation,
        media: media ?? current.media,
        mediaId: media?.id ?? current.mediaId,
        updatedTrip: updatedTrip ?? current.updatedTrip,
      }));
    },
    [enter, revokePreview],
  );

  const presignUpload = useCallback(
    async (attempt: UploadAttempt): Promise<MediaPresignResponse> => {
      const config = optionsRef.current;
      const sourceFile = attempt.file;
      const uploadBlob = attempt.uploadBlob;
      if (!sourceFile || !uploadBlob) throw new Error("Missing file for presign.");

      enter("presigning");
      setState((current) => ({ ...current, error: null, progress: null }));

      const presigned = await client.presign(config.workspaceId, {
        ...(config.tripId ? { tripId: config.tripId } : {}),
        fileName: attempt.uploadFileName ?? sourceFile.name,
        mimeType: attempt.uploadMimeType ?? attempt.mimeType ?? "",
        size: uploadBlob.size,
      });

      attempt.upload = presigned;
      attempt.mediaId = presigned.mediaId;
      setState((current) => ({ ...current, mediaId: presigned.mediaId }));
      return presigned;
    },
    [client, enter],
  );

  const run = useCallback(
    async (from: CoverUploadPhase) => {
      const attempt = attemptRef.current;
      if (!attempt || attempt.operation !== "upload" || !attempt.file) return;
      const config = optionsRef.current;
      const file = attempt.file;
      const compressor = config.compressor ?? workerCompress;
      const startAt = stepIndex(from);

      const runId = ++runIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      const alive = () => mountedRef.current && runId === runIdRef.current && !signal.aborted;

      try {
        if (startAt <= stepIndex("validating")) {
          enter("validating");
          setState((current) => ({ ...current, error: null, progress: null }));
          const validation = validateCoverFile(file, {
            maxBytes: config.maxBytes ?? mediaPolicy.maxUploadBytes,
          });
          if (!validation.ok) {
            fail(validation.error);
            return;
          }
          attempt.mimeType = validation.mimeType;
          if (!alive()) return;
        }

        if (startAt <= stepIndex("compressing")) {
          enter("compressing");
          setState((current) => ({ ...current, error: null, progress: 0 }));
          lastProgressRef.current = 0;

          const compression = await compressor(file, {
            signal,
            maxEdge: mediaPolicy.maxEdge,
            quality: mediaPolicy.quality,
            targetBytes: mediaPolicy.targetBytes,
            onProgress: (progress) => {
              if (alive()) reportCompressionProgress(progress.percent);
            },
          });
          if (!alive()) return;

          attempt.compression = compression;
          attempt.uploadBlob = compression.full;
          attempt.uploadMimeType = compression.skipped ? attempt.mimeType : "image/webp";
          attempt.uploadFileName = compression.skipped ? file.name : toWebpFileName(file.name);
          // The source/original preference is recorded for D2; D1 deliberately
          // uploads exactly one object (the compressed derivative, or the source
          // when it was already small enough).
          console.info("[cover-upload] image compression", {
            fileName: file.name,
            originalBytes: compression.originalBytes,
            compressedBytes: compression.compressedBytes,
            quality: compression.quality,
            iterations: compression.iterations,
            skipped: compression.skipped,
            elapsedMs: compression.elapsedMs,
            keepOriginal: attempt.keepOriginal,
          });
          if (!alive()) return;
        }

        if (startAt <= stepIndex("presigning")) {
          await presignUpload(attempt);
          if (!alive()) return;
        }

        if (startAt <= stepIndex("uploading")) {
          enter("uploading");
          let upload = attempt.upload;
          if (!upload || Date.parse(upload.expiresAt) <= Date.now()) {
            // Expired signature: re-sign transparently, then upload.
            upload = await presignUpload(attempt);
            if (!alive()) return;
            if (Date.parse(upload.expiresAt) <= Date.now()) {
              fail(signatureExpiredError());
              return;
            }
            enter("uploading");
          }
          const uploadBlob = attempt.uploadBlob;
          if (!uploadBlob) throw new Error("Missing compressed file before upload.");
          lastProgressRef.current = null;
          setState((current) => ({ ...current, progress: UPLOAD_PROGRESS_START }));
          reportProgress(UPLOAD_PROGRESS_START);
          await client.putObject({
            url: upload.uploadUrl,
            headers: upload.headers,
            file: uploadBlob,
            signal,
            onProgress: (loaded, total) => {
              if (alive()) reportUploadProgress(loaded, total);
            },
          });
          if (!alive()) return;
        }

        if (startAt <= stepIndex("completing")) {
          enter("completing");
          reportProgress(COMPLETING_PROGRESS);
          if (!attempt.mediaId) throw new Error("Missing media id before complete.");
          const completed = await client.complete(attempt.mediaId, {
            size: attempt.uploadBlob?.size ?? file.size,
          });
          if (!alive()) return;
          if (completed.status === "failed") {
            throw new ProcessingFailure("PROCESSING_FAILED", completed.error ?? undefined);
          }
        }

        if (startAt <= stepIndex("processing")) {
          enter("processing");
          reportProgress(PROCESSING_PROGRESS);
          if (!attempt.mediaId) throw new Error("Missing media id before polling.");
          const media = await pollForReady({
            client,
            mediaId: attempt.mediaId,
            signal,
            alive,
            timeoutMs: config.processTimeoutMs ?? COVER_PROCESS_TIMEOUT_MS,
            intervalMs: config.pollIntervalMs ?? COVER_POLL_INTERVAL_MS,
          });
          if (!alive()) return;
          attempt.mediaId = media.id;
          setState((current) => ({ ...current, media, mediaId: media.id }));

          if (!attempt.applyAfterReady || !config.tripId) {
            optionsRef.current.onMediaReady?.(media);
            finish(null, media, "upload");
            return;
          }
        }

        if (startAt <= stepIndex("applying")) {
          enter("applying");
          reportProgress(APPLYING_PROGRESS);
          const mediaId = attempt.mediaId;
          const targetTripId = config.tripId;
          if (!mediaId || !targetTripId) throw new Error("Missing trip id before set cover.");
          const updated = await client.setCover(targetTripId, mediaId);
          if (!alive()) return;
          attempt.tripVersion = updated.version;
          invalidateCoverQueries(queryClient, config.workspaceId, targetTripId);
          setState((current) => ({ ...current, updatedTrip: updated }));
          optionsRef.current.onCoverChange?.(updated);
          finish(updated, null, "upload");
        }
      } catch (error) {
        if (!alive() || isAbortLike(error)) return;
        if (isImageCompressionError(error)) {
          fail(compressionFailure(error.code, error.message, error.detail));
          return;
        }
        if (error instanceof ProcessingFailure) {
          fail(processingFailure(error.code, error.detail));
          return;
        }
        fail(mapCoverFailure(error, phaseRef.current));
      }
    },
    [
      client,
      enter,
      fail,
      finish,
      mediaPolicy,
      presignUpload,
      queryClient,
      reportCompressionProgress,
      reportProgress,
      reportUploadProgress,
      workerCompress,
    ],
  );

  const runClear = useCallback(
    async (attempt: UploadAttempt) => {
      const config = optionsRef.current;
      const targetTripId = config.tripId;
      if (!targetTripId) return;
      const version = attempt.tripVersion ?? config.tripVersion ?? null;
      if (version === null) {
        fail({
          code: "VERSION_CONFLICT",
          message: "缺少旅行版本号，请刷新页面后重试。",
          retryable: false,
          resumeAt: "applying",
        });
        return;
      }

      const runId = ++runIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const alive = () => mountedRef.current && runId === runIdRef.current && !controller.signal.aborted;

      try {
        enter("applying");
        setState((current) => ({
          ...current,
          error: null,
          progress: null,
          lastOperation: "clear",
        }));
        const updated = await client.clearCover(targetTripId, version);
        if (!alive()) return;
        attempt.tripVersion = updated.version;
        invalidateCoverQueries(queryClient, config.workspaceId, targetTripId);
        revokePreview();
        setState((current) => ({
          ...current,
          updatedTrip: updated,
          media: null,
          mediaId: null,
          file: null,
          previewUrl: null,
        }));
        optionsRef.current.onCoverChange?.(updated);
        finish(updated, null, "clear");
      } catch (error) {
        if (!alive() || isAbortLike(error)) return;
        fail(mapCoverFailure(error, "applying"));
      }
    },
    [client, enter, fail, finish, queryClient, revokePreview],
  );

  const selectFile = useCallback(
    (file: File) => {
      const config = optionsRef.current;
      abortRef.current?.abort();
      abortRef.current = null;
      runIdRef.current += 1;
      lastProgressRef.current = null;
      attemptNumberRef.current += 1;

      const previewUrl = createPreviewUrl(file);
      const previousPreview = previewRef.current;
      previewRef.current = previewUrl;
      if (previousPreview) revokeObjectUrl(previousPreview);

      attemptRef.current = {
        operation: "upload",
        file,
        mimeType: null,
        mediaId: null,
        upload: null,
        uploadBlob: null,
        uploadMimeType: null,
        uploadFileName: null,
        compression: null,
        keepOriginal: resolveKeepOriginal(config.keepOriginal),
        applyAfterReady: Boolean(config.tripId),
        tripVersion: config.tripVersion ?? null,
      };

      setState((current) => ({
        ...current,
        phase: "validating",
        progress: null,
        error: null,
        file,
        previewUrl,
        mediaId: null,
        media: null,
        lastOperation: "upload",
      }));

      void run("validating");
    },
    [run],
  );

  const retry = useCallback(() => {
    const error = stateRef.current.error;
    const attempt = attemptRef.current;
    if (!attempt || !error || !error.retryable) return;
    attemptNumberRef.current += 1;
    if (attempt.operation === "clear") {
      void runClear(attempt);
      return;
    }
    void run(error.resumeAt);
  }, [run, runClear]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current += 1;
    attemptRef.current = null;
    attemptNumberRef.current += 1;
    lastProgressRef.current = null;
    phaseRef.current = "idle";
    revokePreview();
    setState(INITIAL_STATE);
  }, [revokePreview]);

  const remove = useCallback(() => {
    const config = optionsRef.current;
    if (!config.tripId) return;
    attemptNumberRef.current += 1;
    const previousAttempt = attemptRef.current;
    const version =
      previousAttempt?.tripVersion ??
      stateRef.current.updatedTrip?.version ??
      config.tripVersion ??
      null;
    attemptRef.current = {
      operation: "clear",
      file: null,
      mimeType: null,
      mediaId: null,
      upload: null,
      uploadBlob: null,
      uploadMimeType: null,
      uploadFileName: null,
      compression: null,
      keepOriginal: resolveKeepOriginal(config.keepOriginal),
      applyAfterReady: false,
      tripVersion: version,
    };
    void runClear(attemptRef.current);
  }, [runClear]);

  const isBusy = BUSY_PHASES.has(state.phase);

  return {
    ...state,
    isBusy,
    canRetry: Boolean(state.error?.retryable),
    selectFile,
    retry,
    reset,
    remove,
  };
}