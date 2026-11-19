"use client";

import type { MediaRead, Trip, TripCover } from "@roamlog/contracts";
import { Button, Progress, Skeleton } from "@roamlog/ui";
import { ImageUp, RefreshCw, Trash2 } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";

import {
  COVER_ACCEPT_ATTRIBUTE,
  type CoverMediaClient,
} from "@/lib/api/media";
import type { ImageCompressor } from "@/lib/image/use-image-compression";
import { useMediaCompressionPolicy } from "@/lib/settings";

import {
  type CoverTransition,
  useCoverUpload,
} from "./use-cover-upload";
import {
  type CoverUploadError,
  type CoverUploadOperation,
  type CoverUploadPhase,
} from "./cover-upload-error";
import { formatBytes } from "./cover-upload-validation";

export interface CoverChange {
  kind: "uploaded" | "removed";
  mediaId: string | null;
  media: MediaRead | null;
  trip: Trip | null;
  cover: TripCover | null;
}

export interface CoverUploaderProps {
  /** Workspace that owns the media asset (presign is workspace-scoped). */
  workspaceId: string;
  /** Trip being edited. Omit for the create-trip flow (upload only). */
  trip?: Trip | null;
  /** Explicit cover override, for flows that keep the cover outside `trip`. */
  cover?: TripCover | null;
  /** Layout preset; `cover` renders 16:9, `photo` renders 4:3. */
  size?: "cover" | "photo";
  onChange?: (change: CoverChange) => void;
  onError?: (error: CoverUploadError) => void;
  onTransition?: (transition: CoverTransition) => void;
  disabled?: boolean;
  className?: string;
  /** Injectable media client; production uses the generated API client. */
  client?: CoverMediaClient;
  /** Overrides the public `media.maxUploadBytes` policy for embedded flows. */
  maxBytes?: number;
  pollIntervalMs?: number;
  processTimeoutMs?: number;
  /** Test/embedding seam; production uses the Worker compression pipeline. */
  compressor?: ImageCompressor;
  /** D2 will retain the untouched source; D1 records the preference only. */
  keepOriginal?: boolean;
}

const STATUS_LABEL: Record<CoverUploadPhase, string> = {
  idle: "",
  validating: "正在检查图片",
  compressing: "正在压缩图片",
  presigning: "正在准备上传",
  uploading: "",
  completing: "正在确认上传",
  processing: "正在处理图片",
  applying: "正在应用封面",
  ready: "",
  error: "",
};

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function describeLiveText(input: {
  phase: CoverUploadPhase;
  progress: number | null;
  hasCover: boolean;
  operation: CoverUploadOperation | null;
  hasTrip: boolean;
}): string {
  const bucketedProgress =
    input.progress === null ? null : Math.floor(input.progress / 10) * 10;

  switch (input.phase) {
    case "idle":
      return input.hasCover ? "已设置封面，可以替换或移除。" : "尚未设置封面。";
    case "validating":
      return "正在检查图片格式和大小…";
    case "compressing":
      return "正在压缩图片…";
    case "presigning":
      return "正在准备上传链接…";
    case "uploading":
      return `正在上传 ${bucketedProgress ?? 0}%`;
    case "completing":
      return "正在确认上传…";
    case "processing":
      return "服务器正在处理图片，完成后会自动应用为封面。";
    case "applying":
      return input.operation === "clear" ? "正在移除封面…" : "正在应用封面…";
    case "ready":
      if (input.operation === "clear") return "封面已移除。";
      return input.hasTrip ? "封面已更新。" : "图片已上传完成，创建旅行后即可使用。";
    case "error":
      return "上传失败，请查看错误提示。";
    default:
      return "";
  }
}

/**
 * Real trip-cover uploader: click or drag to select, local preview, real PUT
 * progress, server-side processing poll, set/replace/remove, and a truthful
 * empty state. All storage URLs come from the server's presign response.
 */
export function CoverUploader({
  workspaceId,
  trip = null,
  cover,
  size = "cover",
  onChange,
  onError,
  onTransition,
  disabled = false,
  className,
  client,
  maxBytes,
  pollIntervalMs,
  processTimeoutMs,
  compressor,
  keepOriginal,
}: CoverUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const titleId = useId();
  // Read once per render from the shared 30s public-settings cache; the
  // resolved values flow into validation and the compressor for this upload.
  const mediaPolicy = useMediaCompressionPolicy();
  const effectiveMaxBytes = maxBytes ?? mediaPolicy.maxUploadBytes;

  const upload = useCoverUpload({
    workspaceId,
    tripId: trip?.id ?? null,
    tripVersion: trip?.version ?? null,
    client,
    onError,
    onTransition,
    maxBytes: effectiveMaxBytes,
    mediaPolicy,
    pollIntervalMs,
    processTimeoutMs,
    compressor,
    keepOriginal,
    onCoverChange: (updated) => {
      onChange?.({
        kind: updated.coverMediaId ? "uploaded" : "removed",
        mediaId: updated.cover?.mediaId ?? updated.coverMediaId ?? null,
        media: null,
        trip: updated,
        cover: updated.cover,
      });
    },
    onMediaReady: (media) => {
      onChange?.({
        kind: "uploaded",
        mediaId: media.id,
        media,
        trip: null,
        cover: null,
      });
    },
  });

  const tripCover = cover ?? trip?.cover ?? null;
  const updatedTrip = upload.updatedTrip;
  const serverCover: TripCover | null = updatedTrip
    ? updatedTrip.coverMediaId && tripCover?.mediaId === updatedTrip.coverMediaId
      ? tripCover
      : updatedTrip.cover
    : tripCover;

  const coverImageUrl = serverCover?.url ?? serverCover?.thumbUrl ?? null;
  const hasCoverImage = Boolean(coverImageUrl);
  const isProcessingCover = Boolean(serverCover) && !hasCoverImage;
  const showPreview =
    Boolean(upload.previewUrl) &&
    (upload.isBusy ||
      upload.phase === "error" ||
      (!hasCoverImage && upload.phase === "ready"));
  const displayUrl = showPreview ? upload.previewUrl : coverImageUrl;
  // Browsers cannot decode HEIC/HEIF previews; tell the truth instead of showing
  // a broken image, while keeping the upload fully functional.
  const showPreviewFallback = showPreview && previewFailed && !coverImageUrl;
  const isPhoto = size === "photo";
  const aspectClass = isPhoto ? "aspect-[4/3]" : "aspect-[16/9]";
  const canAcceptInput = !disabled && !upload.isBusy;

  const openPicker = () => {
    if (!canAcceptInput) return;
    inputRef.current?.click();
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canAcceptInput) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!canAcceptInput) return;
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setDropNotice("一次只能上传一张图片，已选择第一张。");
    } else {
      setDropNotice(null);
    }
    const file = files[0];
    if (file) {
      setPreviewFailed(false);
      upload.selectFile(file);
    }
  };

  const liveText =
    dropNotice ??
    describeLiveText({
      phase: upload.phase,
      progress: upload.progress,
      hasCover: Boolean(serverCover),
      operation: upload.lastOperation,
      hasTrip: Boolean(trip),
    });

  const statusChip = upload.isBusy
    ? "上传中"
    : serverCover
      ? isProcessingCover
        ? "处理中"
        : "已设置"
      : "未设置";

  const uploadLabel =
    upload.phase === "compressing"
      ? `正在压缩图片 ${upload.progress ?? 0}%`
      : upload.phase === "uploading"
        ? `正在上传 ${upload.progress ?? 0}%`
        : upload.phase === "applying" && upload.lastOperation === "clear"
          ? "正在移除封面"
          : (STATUS_LABEL[upload.phase] ?? "");

  return (
    <section
      className={cx("flex flex-col gap-3", className)}
      aria-labelledby={titleId}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3
          id={titleId}
          className="font-mono text-[10px] uppercase tracking-[0.13em] text-muted"
        >
          {isPhoto ? "照片" : "封面"}
        </h3>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
          {statusChip}
        </span>
      </div>

      <div
        role="group"
        aria-label={isPhoto ? "旅行照片" : "旅行封面"}
        aria-busy={upload.isBusy}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cx(
          "relative overflow-hidden rounded-card border bg-surface-1",
          displayUrl || isProcessingCover
            ? "border-hairline-strong"
            : "border-dashed border-hairline-strong",
          dragging && "border-ink/60 bg-surface-2",
          !canAcceptInput && "opacity-80",
        )}
      >
        {displayUrl && !showPreviewFallback ? (
          <img
            src={displayUrl}
            alt={
              coverImageUrl
                ? isPhoto
                  ? "当前旅行照片"
                  : "当前旅行封面"
                : `待上传图片预览：${upload.file?.name ?? "未命名图片"}`
            }
            className={cx("w-full object-cover", aspectClass)}
            loading={coverImageUrl ? "lazy" : "eager"}
            onError={() => {
              if (!coverImageUrl) setPreviewFailed(true);
            }}
          />
        ) : showPreviewFallback ? (
          <div
            className={cx(
              "flex flex-col items-center justify-center gap-2 px-6 text-center",
              aspectClass,
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 text-muted"
            >
              <ImageUp className="size-4" />
            </span>
            <p className="text-sm text-body">
              已选择 {upload.file?.name ?? "图片"}，浏览器无法预览此格式
            </p>
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
              上传时会尝试转换为 WebP
            </p>
          </div>
        ) : isProcessingCover ? (
          <div
            className={cx(
              "flex flex-col items-center justify-center gap-2 px-6 text-center",
              aspectClass,
            )}
          >
            <p className="text-sm text-body">封面正在服务器处理中…</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
              处理完成后会自动显示
            </p>
            <Skeleton className="h-1.5 w-32 motion-reduce:animate-none!" />
          </div>
        ) : (
          <div
            className={cx(
              "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
              aspectClass,
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 text-muted"
            >
              <ImageUp className="size-4" />
            </span>
            <div>
              <p className="text-sm text-body">拖拽图片到这里，或</p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                JPEG · PNG · WebP · AVIF · HEIC / 最大 {formatBytes(effectiveMaxBytes)}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={openPicker} disabled={disabled}>
              选择图片
            </Button>
          </div>
        )}

        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60 text-xs font-medium text-white">
            松开以选择这张图片
          </div>
        ) : null}

        {upload.isBusy ? (
          <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/90 via-black/55 to-transparent p-3">
            {upload.phase === "uploading" || upload.phase === "compressing" ? (
              <Progress
                value={upload.progress ?? 0}
                aria-label={upload.phase === "compressing" ? "图片压缩进度" : "上传进度"}
                aria-valuetext={`${upload.progress ?? 0}%`}
                indicatorClassName="motion-reduce:transition-none!"
              />
            ) : (
              <Skeleton className="h-1.5 w-full motion-reduce:animate-none!" />
            )}
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/70">
              {uploadLabel}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {displayUrl || isProcessingCover ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={openPicker}
            disabled={disabled || upload.isBusy}
          >
            {coverImageUrl || isProcessingCover ? "替换" : "重新选择"}
          </Button>
        ) : null}
        {serverCover && trip ? (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setDropNotice(null);
              upload.remove();
            }}
            disabled={disabled || upload.isBusy}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            移除
          </Button>
        ) : null}
        {upload.canRetry ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={upload.retry}
            disabled={disabled || upload.isBusy}
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            重试
          </Button>
        ) : null}
        {upload.phase === "error" && !upload.canRetry ? (
          <Button
            variant="subtle"
            size="sm"
            onClick={openPicker}
            disabled={disabled || upload.isBusy}
          >
            选择其他文件
          </Button>
        ) : null}
        </div>

      {upload.error ? (
        <div
          role="alert"
          className="rounded-control border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs leading-5 text-accent-red"
        >
          <p>{upload.error.message}</p>
          {upload.error.detail && upload.error.detail !== upload.error.message ? (
            <p className="mt-1 font-mono text-[10px] leading-4 text-accent-red/80">
              {upload.error.detail}
            </p>
          ) : null}
        </div>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-h-4 text-[11px] leading-5 text-muted"
      >
        {liveText}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={COVER_ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-label={isPhoto ? "选择旅行照片" : "选择旅行封面"}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          setDropNotice(null);
          setPreviewFailed(false);
          upload.selectFile(file);
        }}
      />
    </section>
  );
}