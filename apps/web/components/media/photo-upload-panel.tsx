"use client";

import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "./photo-uploader.css";

import type { Media } from "@roamlog/contracts";
import { useEffect, useRef, useState } from "react";

import type { MediaUploadLimits } from "@/lib/api/media";
import { useMediaCompressionPolicy } from "@/lib/settings";
import {
  createPhotoUppy,
  type PhotoUppySummary,
} from "@/lib/upload/photo-uppy";

/**
 * Client-only inline Uppy Dashboard, mounted inside the upload Dialog.
 *
 * Kept in its own module so `@uppy/core` + `@uppy/dashboard` (57 KB gzip
 * together) only enter the bundle after the user opens the dialog; the parent
 * loads this with `next/dynamic({ ssr: false })`. Uppy is Preact + DOM
 * (`this.el`, a document-level paste listener), so it must never run on the
 * server.
 *
 * `inline: true` in `createPhotoUppy` is what keeps the Dashboard's own modal
 * out of the tree: the Dialog is the only overlay.
 */
export default function PhotoUploadPanel({
  workspaceId,
  tripId,
  limits,
  onBatchComplete,
  onMediaUploaded,
  onNotice,
  onBusyChange,
}: {
  workspaceId: string;
  tripId: string;
  limits: MediaUploadLimits | null;
  onBatchComplete?: (summary: PhotoUppySummary) => void;
  onMediaUploaded?: (media: Media) => void;
  onNotice?: (message: string) => void;
  /** Reports whether a batch is currently uploading (dialog close guard). */
  onBusyChange?: (busy: boolean) => void;
}) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const mediaPolicy = useMediaCompressionPolicy();
  // Uppy options are read at construction; the settings cache resolves within
  // seconds, so the first render's policy is the one this batch uses.
  const policyRef = useRef(mediaPolicy);
  policyRef.current = mediaPolicy;

  const callbacksRef = useRef({
    onBatchComplete,
    onMediaUploaded,
    onNotice,
    onBusyChange,
  });
  callbacksRef.current = { onBatchComplete, onMediaUploaded, onNotice, onBusyChange };
  const limitsRef = useRef(limits);
  limitsRef.current = limits;

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const handle = createPhotoUppy({
      target,
      workspaceId,
      tripId,
      mediaPolicy: policyRef.current,
      limits: limitsRef.current,
      onMediaUploaded: (media) => callbacksRef.current.onMediaUploaded?.(media),
      onBatchComplete: (summary) => callbacksRef.current.onBatchComplete?.(summary),
      onNotice: (message) => callbacksRef.current.onNotice?.(message),
    });
    const { uppy } = handle;
    const markBusy = (busy: boolean) => callbacksRef.current.onBusyChange?.(busy);
    uppy.on("upload-start", () => markBusy(true));
    uppy.on("complete", () => markBusy(false));
    uppy.on("cancel-all", () => markBusy(false));
    setReady(true);
    return () => {
      setReady(false);
      markBusy(false);
      handle.destroy();
    };
  }, [tripId, workspaceId]);

  return (
    <div
      ref={targetRef}
      data-testid="photo-upload-dashboard"
      data-ready={ready ? "true" : "false"}
      className="photo-uploader-mount"
    />
  );
}