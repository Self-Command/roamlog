"use client";

import type { NodeViewProps } from "@tiptap/core";
import { NodeViewWrapper } from "@tiptap/react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { COVER_ACCEPT_ATTRIBUTE, createCoverMediaClient } from "@/lib/api/media";
import type { PhotoLightboxItem } from "@/components/media/photo-lightbox";

import { JournalImageCaption } from "./journal-image-caption";
import { sanitizeJournalImageAttributes, type JournalImageOptions } from "./journal-image";
import type { JournalImageSettingsValues } from "./journal-image-settings";
import { JournalImageToolbar } from "./journal-image-toolbar";
import { journalImageUploadErrorMessage } from "../journal-image-upload";

const IMAGE_ERROR_TEXT = "图片加载失败";

const PhotoLightbox = dynamic(
  () => import("@/components/media/photo-lightbox").then((module) => module.PhotoLightbox),
  { ssr: false },
);

/**
 * Image NodeView. The DOM shape mirrors `JournalImage.renderHTML` so
 * selection, the editing toolbar, and error recovery never change the
 * serialized document.
 * The image node is an atom, so it has no contentDOM and does not use
 * `NodeViewContent`; the caption is edited by the node view and serialized by
 * the node's renderHTML as a standard figcaption.
 */
export function JournalImageNodeView({
  editor,
  extension,
  getPos,
  node,
  selected,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const attrs = sanitizeJournalImageAttributes(node.attrs);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const attemptedMediaIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const replaceAbortRef = useRef<AbortController | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const showToolbar = editor.isEditable && selected;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      replaceAbortRef.current?.abort();
    };
  }, []);

  async function handleReplaceFile(file: File): Promise<void> {
    const uploadImage = (extension.options as JournalImageOptions).uploadImage;
    if (!uploadImage) {
      setReplaceError("当前编辑器未配置图片替换。");
      return;
    }

    abortRef.current?.abort();
    abortRef.current = null;
    replaceAbortRef.current?.abort();
    const controller = new AbortController();
    replaceAbortRef.current = controller;
    setReplaceError(null);
    setReplacing(true);

    try {
      const replacement = await uploadImage(file, controller.signal);
      if (controller.signal.aborted || editor.isDestroyed) return;

      const next = sanitizeJournalImageAttributes({
        ...node.attrs,
        src: replacement.src,
        mediaId: replacement.mediaId,
        alt: replacement.alt ?? file.name,
        caption: null,
        title: null,
        displayWidth: replacement.width ?? null,
        displayHeight: replacement.height ?? null,
      });

      if (!next.src || !next.mediaId) {
        throw new Error("替换图片的结果不完整，请重试。");
      }

      updateAttributes({
        src: next.src,
        mediaId: next.mediaId,
        alt: next.alt,
        caption: null,
        title: null,
        displayWidth: next.displayWidth,
        displayHeight: next.displayHeight,
      });
      attemptedMediaIdRef.current = null;
      setFailedSrc(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setReplaceError(journalImageUploadErrorMessage(error));
    } finally {
      if (replaceAbortRef.current === controller) {
        replaceAbortRef.current = null;
      }
      if (!controller.signal.aborted) setReplacing(false);
    }
  }

  function replaceNodeAttributes(attributes: Record<string, unknown>): void {
    const pos = getPos();
    if (typeof pos !== "number") return;

    const current = editor.state.doc.nodeAt(pos);
    if (!current || current.type !== node.type) return;

    const transaction = editor.state.tr.setNodeMarkup(pos, undefined, {
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
        const src = media.url ?? media.thumbUrl;
        if (!src) return;

        const next = sanitizeJournalImageAttributes({
          ...node.attrs,
          src,
          displayWidth: media.width ?? attrs.displayWidth,
          displayHeight: media.height ?? attrs.displayHeight,
        });
        replaceNodeAttributes({
          src: next.src,
          displayWidth: next.displayWidth,
          displayHeight: next.displayHeight,
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
  const canPreview = !showPlaceholder;
  const canOpenOnClick = !editor.isEditable && canPreview && !attrs.linkHref;
  const previewItems = useMemo<PhotoLightboxItem[]>(
    () =>
      canPreview
        ? [
            {
              id: attrs.mediaId ?? attrs.src,
              src: attrs.src,
              alt: attrs.alt,
              width: attrs.displayWidth,
              height: attrs.displayHeight,
            },
          ]
        : [],
    [attrs.alt, attrs.displayHeight, attrs.displayWidth, attrs.mediaId, attrs.src, canPreview],
  );

  function openPreview(trigger?: HTMLElement | null): void {
    if (!canPreview) return;

    previewTriggerRef.current =
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setPreviewOpen(true);
  }

  function closePreview(): void {
    setPreviewOpen(false);
    const trigger = previewTriggerRef.current;
    previewTriggerRef.current = null;
    queueMicrotask(() => trigger?.focus());
  }

  function handleFigureClick(event: MouseEvent<HTMLElement>): void {
    if (!editor.isEditable) {
      const target = event.target;
      if (!canOpenOnClick || !(target instanceof HTMLImageElement)) return;

      event.preventDefault();
      openPreview(target);
      return;
    }

    if (
      event.target instanceof Element &&
      event.target.closest('[role="toolbar"], [data-image-caption-editor]')
    ) {
      return;
    }

    // In edit mode a click selects the atom; it must not follow the image link.
    event.preventDefault();
    const pos = getPos();
    if (typeof pos === "number") editor.commands.setNodeSelection(pos);
  }

  function handleFigureKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!canOpenOnClick) return;
    if (event.target !== event.currentTarget && !(event.target instanceof HTMLImageElement)) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    openPreview(event.target instanceof HTMLImageElement ? event.target : null);
  }

  function handleApplySettings(values: JournalImageSettingsValues): void {
    const next = sanitizeJournalImageAttributes({
      ...node.attrs,
      ...values,
    });

    updateAttributes({
      alt: next.alt,
      title: next.title,
      caption: next.caption,
      displayWidth: next.displayWidth,
      displayHeight: next.displayHeight,
      linkHref: next.linkHref,
      linkBlank: next.linkHref ? next.linkBlank : false,
    });
  }

  const image = (
    <img
      src={attrs.src || undefined}
      alt={attrs.alt}
      title={attrs.title ?? undefined}
      width={attrs.displayWidth ?? undefined}
      height={attrs.displayHeight ?? undefined}
      loading="lazy"
      decoding="async"
      data-media-id={attrs.mediaId ?? undefined}
      onError={handleImageError}
      role={canOpenOnClick ? "button" : undefined}
      tabIndex={canOpenOnClick ? 0 : undefined}
      aria-label={canOpenOnClick ? `预览图片：${attrs.alt || "图片"}` : undefined}
      className={`block h-auto max-w-full rounded-[3px] ${
        canOpenOnClick
          ? "cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink/40"
          : ""
      }`}
    />
  );

  return (
    <NodeViewWrapper
      as="figure"
      data-type="image"
      data-align={attrs.alignment ?? undefined}
      data-selected={selected ? "true" : undefined}
      onClick={handleFigureClick}
      onKeyDown={handleFigureKeyDown}
      className={`journal-image-node relative my-6 outline-none ${
        selected
          ? "rounded-[3px] outline outline-2 outline-offset-4 outline-ink/50"
          : "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink/40"
      }`}
    >
      {showPlaceholder ? (
        <div
          role="img"
          aria-label={attrs.alt ? `${IMAGE_ERROR_TEXT}：${attrs.alt}` : IMAGE_ERROR_TEXT}
          className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-[3px] border border-dashed border-hairline-strong bg-surface-2 px-4 py-6 text-center"
        >
          <span className="font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
            {IMAGE_ERROR_TEXT}
          </span>
          {attrs.alt ? <span className="text-[13px] leading-5 text-body">{attrs.alt}</span> : null}
        </div>
      ) : attrs.linkHref ? (
        <a
          href={attrs.linkHref}
          target={attrs.linkBlank ? "_blank" : undefined}
          rel="noopener noreferrer"
          className="block outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          {image}
        </a>
      ) : (
        image
      )}
      {showToolbar ? (
        <JournalImageToolbar
          alignment={attrs.alignment}
          attributes={attrs}
          onAlign={(alignment) => updateAttributes({ alignment })}
          onApplySettings={handleApplySettings}
          onPreview={(trigger) => openPreview(trigger)}
          replacing={replacing}
          onReplace={() => {
            setReplaceError(null);
            replaceInputRef.current?.click();
          }}
          onDelete={deleteNode}
        />
      ) : null}
      {editor.isEditable ? (
        <input
          ref={replaceInputRef}
          type="file"
          accept={COVER_ACCEPT_ATTRIBUTE}
          className="hidden"
          aria-label="选择替换图片"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleReplaceFile(file);
          }}
        />
      ) : null}
      {replacing ? (
        <p role="status" className="mt-2 text-center text-[11px] text-muted">
          正在替换图片…
        </p>
      ) : null}
      {replaceError ? (
        <p role="alert" className="mt-2 text-center text-[11px] text-accent-red">
          {replaceError}
        </p>
      ) : null}
      {editor.isEditable ? (
        <JournalImageCaption
          caption={attrs.caption}
          onChange={(caption) => updateAttributes({ caption })}
        />
      ) : attrs.caption ? (
        <figcaption className="mt-2 text-center text-[13px] leading-5 text-muted">
          {attrs.caption}
        </figcaption>
      ) : null}
      <PhotoLightbox open={previewOpen} index={0} items={previewItems} onClose={closePreview} />
    </NodeViewWrapper>
  );
}
