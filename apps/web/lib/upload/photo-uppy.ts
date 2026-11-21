"use client";

import Uppy, { type Body, type Meta } from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import zhCN from "@uppy/locales/lib/zh_CN.js";

import type { Media } from "@roamlog/contracts";
import type { MediaUploadLimits } from "@/lib/api/media";
import type { MediaCompressionPolicy } from "@/lib/settings";

import {
  PHOTO_UPLOAD_ALLOWED_TYPES,
  overBatchLimitMessage,
  restrictionMessage,
} from "./photo-upload-limits";
import { RoamlogUploader } from "./roamlog-uploader";

/**
 * Assembles the Uppy instance for one batch upload inside the upload dialog.
 *
 * Everything here is Uppy's documented extension surface, not a fork:
 * - `restrictions` are Uppy core's (`@uppy/core` `Restricter.ts`), so the
 *   number/size limits hold even if the Dashboard is replaced;
 * - `locale: zh_CN` is the official `@uppy/locales` pack;
 * - the uploader is our `RoamlogUploader` plugin (`type = 'uploader'`), exactly
 *   how `@uppy/xhr-upload` installs itself — `@uppy/xhr-upload` is deliberately
 *   **not** installed because its single multipart POST cannot express
 *   `presign → PUT → complete`.
 *
 * `inline: true` keeps the Dashboard *inside* the Radix Dialog; Uppy's own modal
 * is never opened, so the page never stacks two overlays.
 *
 * Every number comes from `limits`, the server's response. When it is `null`
 * (endpoint unavailable) no restriction is invented: the picker accepts the
 * selection and the API answers with its own configured limit.
 */

export interface PhotoUppySummary {
  successful: number;
  failed: number;
}

export interface CreatePhotoUppyOptions {
  /** DOM element the inline Dashboard mounts into. */
  target: HTMLElement;
  workspaceId: string;
  tripId: string;
  /** Admin-tunable compression policy the uploader must honour. */
  mediaPolicy: MediaCompressionPolicy;
  /** Server-owned upload limits; `null` while the endpoint is unavailable. */
  limits: MediaUploadLimits | null;
  onMediaUploaded?: (media: Media) => void;
  onBatchComplete?: (summary: PhotoUppySummary) => void;
  /** Restriction/failure copy for the panel's own banner. */
  onNotice?: (message: string) => void;
}

export interface PhotoUppyHandle {
  uppy: Uppy<Meta, Body>;
  destroy(): void;
}

export function createPhotoUppy(options: CreatePhotoUppyOptions): PhotoUppyHandle {
  const { limits } = options;
  const uppy = new Uppy<Meta, Body>({
    id: "roamlog-photo-uploader",
    autoProceed: false,
    allowMultipleUploadBatches: true,
    locale: zhCN,
    meta: { tripId: options.tripId },
    restrictions: {
      maxNumberOfFiles: limits?.maxFilesPerBatch ?? null,
      maxFileSize: limits?.maxFileBytes ?? null,
      maxTotalFileSize: limits?.maxBatchBytes ?? null,
      minNumberOfFiles: 1,
      allowedFileTypes: [...PHOTO_UPLOAD_ALLOWED_TYPES],
    },
    onBeforeFileAdded: (file, files) => {
      if (!limits) return undefined;
      const queued = Object.values(files).filter((entry) => !entry.isGhost).length;
      if (queued >= limits.maxFilesPerBatch) {
        // Returning `false` rejects only this file; the accepted ones stay queued.
        options.onNotice?.(overBatchLimitMessage(file.name, limits));
        return false;
      }
      return undefined;
    },
  });

  uppy.use(Dashboard, {
    target: options.target,
    // Render into the Dialog’s container; never open Uppy's own modal on top.
    inline: true,
    width: "100%",
    height: 380,
    theme: "dark",
    proudlyDisplayPoweredByUppy: false,
    // The linked PUT cannot resume, so the pause button would be a lie.
    hidePauseResumeButton: true,
    // A finished photo can still be removed from the queue before closing.
    showRemoveButtonAfterComplete: true,
    thumbnailWidth: 240,
    waitForThumbnailsBeforeUpload: false,
    showNativePhotoCameraButton: false,
    showNativeVideoCameraButton: false,
  });

  uppy.use(RoamlogUploader, {
    workspaceId: options.workspaceId,
    tripId: options.tripId,
    ...(limits
      ? { maxBytes: limits.maxFileBytes, presignPerMinute: limits.presignPerMinute }
      : {}),
    maxEdge: options.mediaPolicy.maxEdge,
    targetBytes: options.mediaPolicy.targetBytes,
    quality: options.mediaPolicy.quality,
    onMediaUploaded: options.onMediaUploaded,
  });

  uppy.on("restriction-failed", (_file, error) => {
    const userFacing = (error as { isUserFacing?: boolean }).isUserFacing !== false;
    if (!userFacing) return; // the batch hook already explained itself
    const message = error instanceof Error ? error.message : "有照片不符合上传限制。";
    options.onNotice?.(restrictionMessage(message, limits));
  });

  uppy.on("complete", (result) => {
    options.onBatchComplete?.({
      successful: result.successful?.length ?? 0,
      failed: result.failed?.length ?? 0,
    });
  });

  return {
    uppy,
    destroy() {
      uppy.destroy();
    },
  };
}
