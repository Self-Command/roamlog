"use client";

/**
 * Attachment thumbnail, ported from vercel/chatbot
 * `components/chat/preview-attachment.tsx` @ a8989b52 (Apache-2.0), L17–L55:
 * a 96×96 rounded tile, `object-cover` image for `image/*`, a "File" label
 * otherwise, a blurred `Spinner` overlay while uploading, and a remove button
 * that only appears when the tile is not uploading (L45–L53).
 *
 * Adaptation layer:
 * - Upstream renders `next/image`; the signed media URL is a cross-origin
 *   object-store URL and `next/image` would need a remote-hosts allow-list in
 *   `next.config.ts` (outside this task's write scope), so a plain `<img>` is
 *   used with the same classes.
 * - Upstream's `Spinner` (`components/ui/spinner.tsx`) is a spinning ring; this
 *   repo has no spinner primitive and may not add one, so the ring is expressed
 *   with Tailwind's built-in `animate-spin` (same visual, no new dependency).
 * - `onRemove` is wired to assistant-ui's `composer.removeAttachment` upstream
 *   was a `setAttachments` filter.
 * - Chinese labels (`aria-label`, "文件") are the i18n adaptation.
 */

import { useEffect, useState } from "react";

import { readImageMetadata } from "./media-attachment-adapter";

export interface AttachmentLike {
  id: string;
  name: string;
  contentType?: string | undefined;
  file?: File | undefined;
  content?: readonly { type: string; image?: string; providerMetadata?: unknown }[] | undefined;
  status: { type: string; reason?: string };
}

/** The first image URL already present on a completed attachment. */
function uploadedUrl(attachment: AttachmentLike): string | undefined {
  for (const part of attachment.content ?? []) {
    if (part.type === "image" && typeof part.image === "string" && part.image.length > 0) {
      return part.image;
    }
  }
  return undefined;
}

/**
 * A local preview while the upload is in flight (upstream showed the object URL
 * created by the browser; here the pending attachment still owns the `File`).
 */
function useLocalPreview(attachment: AttachmentLike): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!attachment.file) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(attachment.file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [attachment.file]);
  return url;
}

export function AttachmentPreview({
  attachment,
  isUploading = false,
  onRemove,
}: {
  attachment: AttachmentLike;
  isUploading?: boolean;
  onRemove?: (() => void) | undefined;
}) {
  const metadata = readImageMetadata(
    attachment.content?.[0]?.providerMetadata,
  );
  const localUrl = useLocalPreview(attachment);
  const url = uploadedUrl(attachment) ?? localUrl;
  const contentType = attachment.contentType ?? metadata?.mimeType ?? "";
  const isImage = contentType.startsWith("image");

  return (
    <div
      className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-control border border-hairline bg-surface-2"
      data-testid="input-attachment-preview"
      // Exposes the adapter's state machine to tests and to assistive tech:
      // running = uploading, requires-action = ready to send, incomplete = failed.
      data-attachment-status={attachment.status.type}
      data-attachment-reason={attachment.status.reason}
    >
      {isImage && url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed cross-origin media URL, not a Next-served asset
        <img
          alt={attachment.name || "附件"}
          className="size-full object-cover"
          data-testid="input-attachment-thumb"
          height={96}
          src={url}
          width={96}
        />
      ) : (
        <div className="flex size-full items-center justify-center px-2 text-center text-xs leading-4 text-muted">
          文件
        </div>
      )}

      {isUploading ? (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-control bg-black/40 backdrop-blur-sm"
          data-testid="input-attachment-loader"
        >
          <span
            aria-hidden="true"
            className="size-5 animate-spin rounded-full border-2 border-ink/25 border-t-ink"
          />
          <span className="sr-only">正在上传</span>
        </div>
      ) : null}

      {onRemove && !isUploading ? (
        <button
          className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-pill bg-black/60 text-[11px] leading-none text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
          onClick={onRemove}
          type="button"
          aria-label={`移除 ${attachment.name || "附件"}`}
          data-testid="input-attachment-remove"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}