"use client";

import { useEffect, useRef, useState } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";

import { createCoverMediaClient } from "@/lib/api/media";

import {
  GALLERY_TEXT_MAX_LENGTH,
  sanitizeGalleryMediaId,
  sanitizeGallerySource,
} from "./journal-gallery";

const IMAGE_ERROR_TEXT = "图片加载失败";

interface GalleryImageNodeAttrs {
  src: string;
  alt: string;
  title: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  mediaId: string | null;
}

function textValue(value: unknown, fallback: string | null): string | null {
  if (typeof value !== "string") return fallback;

  const text = value.trim().slice(0, GALLERY_TEXT_MAX_LENGTH);
  return text.length > 0 ? text : fallback;
}

function positiveDimension(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function readAttrs(value: Record<string, unknown>): GalleryImageNodeAttrs {
  return {
    src: sanitizeGallerySource(value.src) ?? "",
    alt: textValue(value.alt, "") ?? "",
    title: textValue(value.title, null),
    caption: textValue(value.caption, null),
    width: positiveDimension(value.width),
    height: positiveDimension(value.height),
    mediaId: sanitizeGalleryMediaId(value.mediaId),
  };
}

/**
 * Gallery item node view.
 *
 * Ported from emdash-cms/emdash@732867e9836efbd9fa9cf01f4fd086949b1bb392
 * (MIT), packages/admin/src/components/editor/GalleryNode.tsx (GalleryPreviewImage
 * and the per-image fallback) plus Gallery.astro's gallery-item contract.
 *
 * Adaptation layer: Roamlog stores each gallery image as a galleryImage child
 * node, uses the response-scoped media client to re-sign an expired src once,
 * and keeps the persisted HTML identical to `renderHTML`.
 */
export function JournalGalleryImageNodeView({ editor, getPos, node }: NodeViewProps) {
  const attrs = readAttrs(node.attrs);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const attemptedMediaIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function updateImageAttributes(attributes: Record<string, unknown>): void {
    const position = getPos();
    if (typeof position !== "number") return;

    const current = editor.state.doc.nodeAt(position);
    if (!current || current.type !== node.type) return;

    const transaction = editor.state.tr.setNodeMarkup(position, undefined, {
      ...current.attrs,
      ...attributes,
    });
    // Re-signing a URL is a display repair, not an undoable document edit.
    transaction.setMeta("addToHistory", false);
    editor.view.dispatch(transaction);
  }

  function refreshFromMedia(): void {
    if (!attrs.mediaId || attemptedMediaIdRef.current === attrs.mediaId) return;

    attemptedMediaIdRef.current = attrs.mediaId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void createCoverMediaClient()
      .fetchMedia(attrs.mediaId, { signal: controller.signal })
      .then((media) => {
        if (controller.signal.aborted) return;

        const src = sanitizeGallerySource(media.url ?? media.thumbUrl);
        if (!src) return;

        updateImageAttributes({
          src,
          width: positiveDimension(media.width) ?? attrs.width,
          height: positiveDimension(media.height) ?? attrs.height,
        });
      })
      .catch(() => {
        // The placeholder is already visible; never retry the same media id.
      });
  }

  function handleImageError(): void {
    setFailedSrc(attrs.src);
    refreshFromMedia();
  }

  const showPlaceholder = attrs.src.length === 0 || failedSrc === attrs.src;

  return (
    <NodeViewWrapper
      as="figure"
      data-type="gallery-item"
      className="journal-gallery-image-node m-0 min-w-0"
    >
      {showPlaceholder ? (
        <div
          role="img"
          aria-label={attrs.alt ? `${IMAGE_ERROR_TEXT}：${attrs.alt}` : IMAGE_ERROR_TEXT}
          className="flex aspect-square min-h-24 flex-col items-center justify-center gap-1 rounded-[3px] border border-dashed border-hairline-strong bg-surface-2 px-3 py-4 text-center"
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
            {IMAGE_ERROR_TEXT}
          </span>
          {attrs.alt ? (
            <span className="line-clamp-3 text-[10px] leading-4 text-body">{attrs.alt}</span>
          ) : null}
        </div>
      ) : (
        <img
          src={attrs.src}
          alt={attrs.alt}
          title={attrs.title ?? undefined}
          width={attrs.width ?? undefined}
          height={attrs.height ?? undefined}
          loading="lazy"
          decoding="async"
          data-media-id={attrs.mediaId ?? undefined}
          draggable={false}
          onError={handleImageError}
          className="block aspect-square h-auto w-full object-cover"
        />
      )}
      {attrs.caption ? <figcaption>{attrs.caption}</figcaption> : null}
    </NodeViewWrapper>
  );
}
