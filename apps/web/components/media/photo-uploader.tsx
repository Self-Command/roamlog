"use client";

import type { Media } from "@roamlog/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@roamlog/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ImageUp, UploadCloud } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { uploadLimitHint } from "@/lib/upload/photo-upload-limits";
import type { PhotoUppySummary } from "@/lib/upload/photo-uppy";
import { useMediaUploadLimits } from "@/lib/upload/use-media-upload-limits";

import { deniedReason } from "../trip-workspace/capabilities";
import { tripWorkspaceKeys } from "../trip-workspace/queries";

/**
 * Uppy is a browser-only Preact app, so the Dashboard is a client-only chunk:
 * 57 KB gzip stays out of the trip bundle until the user opens the dialog.
 */
const PhotoUploadPanel = dynamic(() => import("./photo-upload-panel"), {
  ssr: false,
  loading: () => (
    <p
      role="status"
      className="flex h-[380px] items-center justify-center rounded-control border border-hairline bg-surface-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-stone"
    >
      正在准备上传面板…
    </p>
  ),
});

export interface PhotoUploaderProps {
  workspaceId: string;
  tripId: string;
  /** `media:presign` capability; false disables the entry point. */
  canUpload: boolean;
  /** Workspace role, used for the disabled explanation. */
  role?: string | undefined;
  /** Called after the media list has been re-read with at least one new photo. */
  onUploaded?: (mediaIds: readonly string[]) => void;
}

/**
 * The photos tab's batch upload entry point: one button, one Dialog.
 *
 * The trigger is deliberately the only thing this component renders into the
 * page. The picker, queue, per-file progress, cancel and retry all live in a
 * Radix Dialog consistent with the workspace's other dialogs, so the tab has no
 * permanently-inflated upload block.
 *
 * All rate/size copy comes from `useMediaUploadLimits` (the server's limits);
 * while that request is pending or unavailable the dialog shows number-free
 * copy instead of a client-side guess.
 */
export function PhotoUploader({
  workspaceId,
  tripId,
  canUpload,
  role,
  onUploaded,
}: PhotoUploaderProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<PhotoUppySummary | null>(null);
  const uploadedIdsRef = useRef<string[]>([]);
  const allowCloseRef = useRef(false);

  // The limits request only fires when the dialog is actually opened.
  const { limits, isLoading } = useMediaUploadLimits(workspaceId, { enabled: open });

  useEffect(() => {
    // Uploads finished while the confirmation was on screen: drop the warning.
    if (!busy) setConfirmClose(false);
  }, [busy]);

  const handleMediaUploaded = useCallback((media: Media) => {
    uploadedIdsRef.current = [...uploadedIdsRef.current, media.id];
  }, []);

  const handleBatchComplete = useCallback(
    async (result: PhotoUppySummary) => {
      setSummary(result);
      const uploaded = uploadedIdsRef.current;
      uploadedIdsRef.current = [];
      if (uploaded.length === 0) return;
      // Single source of truth is the API: the grid and the map layer both read
      // this query, so one invalidation refreshes both.
      await queryClient.invalidateQueries({ queryKey: tripWorkspaceKeys.media(tripId) });
      onUploaded?.(uploaded);
    },
    [onUploaded, queryClient, tripId],
  );

  const resetState = useCallback(() => {
    allowCloseRef.current = false;
    setBusy(false);
    setConfirmClose(false);
    setNotice(null);
    setSummary(null);
    uploadedIdsRef.current = [];
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setOpen(true);
        return;
      }
      // Closing during an active batch must be confirmed, never silent.
      if (busy && !allowCloseRef.current) {
        setConfirmClose(true);
        return;
      }
      setOpen(false);
      resetState();
    },
    [busy, resetState],
  );

  const confirmAbortClose = () => {
    allowCloseRef.current = true;
    setOpen(false);
    resetState();
  };

  const limitText = uploadLimitHint(limits);
  const limitsKnown = limits !== null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => handleOpenChange(true)}
        disabled={!canUpload}
        title={canUpload ? undefined : deniedReason(role, "上传照片")}
        data-testid="photo-upload-open"
      >
        <ImageUp aria-hidden="true" />
        上传照片
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="w-[calc(100%-1rem)] max-w-3xl sm:w-[calc(100%-2rem)]"
          onEscapeKeyDown={(event) => {
            if (busy) {
              event.preventDefault();
              setConfirmClose(true);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>上传旅行照片</DialogTitle>
            <DialogDescription data-testid="photo-upload-limit">
              {limitText}
            </DialogDescription>
          </DialogHeader>

          {confirmClose ? (
            <div
              role="alert"
              data-testid="photo-upload-close-confirm"
              className="mb-3 rounded-control border border-accent-yellow/35 bg-accent-yellow/[0.07] px-3 py-2.5"
            >
              <p className="text-[11px] leading-5 text-accent-yellow">
                还有照片正在上传。关闭这个窗口会中止未完成的上传；已经完成的照片不会受影响。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmClose(false)}
                >
                  继续上传
                </Button>
                <Button type="button" variant="danger" size="sm" onClick={confirmAbortClose}>
                  中止并关闭
                </Button>
              </div>
            </div>
          ) : null}

          {notice ? (
            <p
              role="alert"
              data-testid="photo-upload-notice"
              className="mb-3 rounded-control border border-accent-yellow/35 bg-accent-yellow/[0.07] px-3 py-2 text-[11px] leading-5 text-accent-yellow"
            >
              {notice}
            </p>
          ) : null}

          {summary ? (
            <p
              role="status"
              data-testid="photo-upload-summary"
              className={`mb-3 rounded-control border px-3 py-2 text-[11px] leading-5 ${
                summary.failed > 0
                  ? "border-accent-red/30 bg-accent-red/[0.06] text-accent-red"
                  : "border-hairline bg-surface-2 text-muted"
              }`}
            >
              {summary.failed > 0
                ? `本批 ${summary.successful} 张上传完成，${summary.failed} 张没有成功；可以在上面的面板里点重试，或重新选择这几张。`
                : `本批 ${summary.successful} 张照片已上传，相册与照片地图正在刷新。`}
            </p>
          ) : null}

          {isLoading ? (
            <p
              role="status"
              className="flex h-[380px] items-center justify-center rounded-control border border-hairline bg-surface-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-stone"
            >
              正在读取上传限制…
            </p>
          ) : (
            <PhotoUploadPanel
              workspaceId={workspaceId}
              tripId={tripId}
              limits={limits}
              onBatchComplete={(result) => void handleBatchComplete(result)}
              onMediaUploaded={handleMediaUploaded}
              onNotice={setNotice}
              onBusyChange={setBusy}
            />
          )}

          <p className="mt-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
            <UploadCloud aria-hidden="true" className="size-3" />
            {limitsKnown
              ? "选择照片后点「上传」开始；失败的照片可以在队列里单独重试。"
              : "选择照片后点「上传」开始；系统会按当前账号的上限校验这次上传。"}
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
