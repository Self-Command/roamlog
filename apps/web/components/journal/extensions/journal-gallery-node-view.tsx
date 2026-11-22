import type { Editor } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { Popover, PopoverContent, PopoverTrigger } from "@roamlog/ui";
import { Eye, ImagePlus, Loader2, SlidersHorizontal, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { COVER_ACCEPT_ATTRIBUTE } from "@/lib/api/media";
import type { PhotoLightboxItem } from "@/components/media/photo-lightbox";
import { journalImageUploadErrorMessage } from "../journal-image-upload";
import {
  clampGalleryColumns,
  GALLERY_TEXT_MAX_LENGTH,
  galleryImageAttrsFromUpload,
  JournalGallery,
  sanitizeGallerySource,
  type JournalGalleryImageAttrs,
  type JournalGalleryOptions,
  type JournalGalleryUploadImages,
} from "./journal-gallery";
import { JournalGalleryPanel, type JournalGalleryImagePatch } from "./journal-gallery-panel";

const PhotoLightbox = dynamic(
  () => import("@/components/media/photo-lightbox").then((module) => module.PhotoLightbox),
  { ssr: false },
);

/**
 * Gallery grid node view.
 *
 * Ported from emdash-cms/emdash@732867e9836efbd9fa9cf01f4fd086949b1bb392:
 * - packages/admin/src/components/editor/GalleryNode.tsx:164-240
 * - packages/admin/src/components/editor/GalleryDetailPanel.tsx:190-192,
 *   255-267, 314-322 (multi-select Add Images + batch append)
 * - packages/core/src/components/Gallery.astro:177-240 (MIT)
 *
 * Adaptation layer: Roamlog reads gallery images from the existing
 * galleryImage child nodes instead of Emdash's `attrs.images`, uses the
 * journal design tokens, and keeps the upstream grid/caption/delete behavior.
 */

const GALLERY_GRID_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 min-[641px]:grid-cols-3",
  4: "grid-cols-2 min-[641px]:grid-cols-4",
  5: "grid-cols-2 min-[641px]:grid-cols-5",
  6: "grid-cols-2 min-[641px]:grid-cols-6",
};

const GALLERY_CONTENT_CLASS = [
  "grid gap-2",
  "[&>[data-node-view-content-react]]:contents",
  "[&_figure]:m-0 [&_figure]:min-w-0",
  "[&_figure_img]:block [&_figure_img]:aspect-square [&_figure_img]:h-auto [&_figure_img]:w-full [&_figure_img]:rounded-[3px] [&_figure_img]:border [&_figure_img]:border-hairline [&_figure_img]:object-cover",
  "[&_figcaption]:mt-1.5 [&_figcaption]:break-words [&_figcaption]:text-center [&_figcaption]:font-mono [&_figcaption]:text-[10px] [&_figcaption]:leading-4 [&_figcaption]:text-stone",
].join(" ");

const GALLERY_COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

const GALLERY_TOOL_BUTTON_CLASS =
  "inline-flex size-8 items-center justify-center rounded-[5px] border border-hairline-strong bg-surface-1 text-muted transition-colors outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

function getGalleryUploadImages(editor: Editor): JournalGalleryUploadImages | null {
  const extension = editor.extensionManager.extensions.find(
    ({ name }) => name === JournalGallery.name,
  );
  const uploadImages = (extension?.options as JournalGalleryOptions | undefined)?.uploadImages;
  return typeof uploadImages === "function" ? uploadImages : null;
}

function galleryChildPosition(
  node: ProseMirrorNode,
  galleryPosition: number,
  index: number,
): number {
  let offset = 0;

  for (let childIndex = 0; childIndex < index; childIndex += 1) {
    offset += node.child(childIndex).nodeSize;
  }

  return galleryPosition + 1 + offset;
}

function galleryAltValue(value: string): string {
  const text = value.slice(0, GALLERY_TEXT_MAX_LENGTH);
  return text.trim() ? text : "";
}

function galleryCaptionValue(value: string | null): string | null {
  if (value === null) return null;

  const text = value.slice(0, GALLERY_TEXT_MAX_LENGTH);
  return text.trim() ? text : null;
}

function galleryImageAttrsFromNode(node: ProseMirrorNode): JournalGalleryImageAttrs[] {
  const images: JournalGalleryImageAttrs[] = [];

  node.forEach((child) => {
    if (child.type.name !== "galleryImage") return;

    const attrs = child.attrs;
    images.push({
      src: typeof attrs.src === "string" ? attrs.src : "",
      alt: typeof attrs.alt === "string" ? attrs.alt : "",
      title: typeof attrs.title === "string" ? attrs.title : null,
      caption: typeof attrs.caption === "string" ? attrs.caption : null,
      width: typeof attrs.width === "number" ? attrs.width : null,
      height: typeof attrs.height === "number" ? attrs.height : null,
      mediaId: typeof attrs.mediaId === "string" ? attrs.mediaId : null,
    });
  });

  return images;
}

function galleryPreviewItems(images: JournalGalleryImageAttrs[]): PhotoLightboxItem[] {
  return images.flatMap((image, index) => {
    const src = sanitizeGallerySource(image.src);
    if (!src) return [];

    const alt = image.alt.trim() || image.caption?.trim() || `图库第 ${index + 1} 张图片`;
    return [
      {
        id: image.mediaId ?? `${src}-${index}`,
        src,
        alt,
        width: image.width,
        height: image.height,
      },
    ];
  });
}

function galleryItemIndex(container: HTMLElement, target: Element): number | null {
  const figure = target.closest('figure[data-type="gallery-item"]');
  if (!figure) return null;

  const figures = Array.from(container.querySelectorAll('figure[data-type="gallery-item"]'));
  const index = figures.indexOf(figure as Element);
  return index >= 0 ? index : null;
}

export function JournalGalleryNodeView({
  node,
  editor,
  selected,
  deleteNode,
  getPos,
}: NodeViewProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadingCount, setUploadingCount] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const previewGalleryElementRef = useRef<HTMLElement | null>(null);
  const previewGalleryPositionRef = useRef<number | null>(null);
  const closePreviewRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);
  const columns = clampGalleryColumns(node.attrs.columns);
  const images = galleryImageAttrsFromNode(node);
  const previewItems = useMemo(() => galleryPreviewItems(images), [images]);
  const showEditorChrome = editor.isEditable && selected;
  const position = getPos();
  const galleryPosition = typeof position === "number" ? position : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!previewOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      // The editor sheet listens on document. Capture on window runs before
      // that listener, so Escape closes only the lightbox, never the sheet.
      event.preventDefault();
      event.stopPropagation();
      closePreviewRef.current();
    };

    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [previewOpen]);

  useEffect(() => {
    if (selected || !settingsOpen) return;

    // Opening the settings Popover moves focus into a portal. Keep the panel
    // open while the editor still has this Gallery selected; only a real
    // selection change should dismiss it.
    const selection = editor.state.selection;
    const stillSelected =
      galleryPosition !== null &&
      selection instanceof NodeSelection &&
      selection.from === galleryPosition;

    if (!stillSelected) setSettingsOpen(false);
  }, [editor, galleryPosition, selected, settingsOpen]);

  const dispatchGalleryTransaction = (transaction: Transaction) => {
    if (galleryPosition === null) return;

    transaction.setSelection(NodeSelection.create(transaction.doc, galleryPosition));
    editor.view.dispatch(transaction);
  };

  const selectGallery = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('figure[data-type="gallery-item"]')) {
      return;
    }

    if (!editor.isEditable) {
      const rawIndex = galleryItemIndex(event.currentTarget, target);
      if (rawIndex === null) return;

      const clickedImage = images[rawIndex];
      if (!clickedImage || !sanitizeGallerySource(clickedImage.src)) return;

      let nextIndex = 0;
      for (let index = 0; index < rawIndex; index += 1) {
        if (sanitizeGallerySource(images[index]?.src ?? "")) nextIndex += 1;
      }

      const trigger = target instanceof HTMLImageElement ? target : null;
      if (trigger) trigger.tabIndex = -1;
      event.preventDefault();
      openPreview(nextIndex, trigger);
      return;
    }

    const position = getPos();
    if (typeof position !== "number") return;

    event.preventDefault();
    editor.commands.setNodeSelection(position);
  };

  function openPreview(index: number, trigger?: HTMLElement | null): void {
    if (previewItems.length === 0) return;

    previewGalleryElementRef.current =
      trigger?.closest<HTMLElement>('div[data-type="gallery"]') ?? null;
    previewGalleryPositionRef.current = galleryPosition;
    previewTriggerRef.current =
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setPreviewIndex(Math.min(Math.max(index, 0), previewItems.length - 1));
    setPreviewOpen(true);
  }

  function closePreview(): void {
    setPreviewOpen(false);
    const trigger = previewTriggerRef.current;
    previewTriggerRef.current = null;
    const galleryElement = previewGalleryElementRef.current;
    previewGalleryElementRef.current = null;
    const galleryPositionAtOpen = previewGalleryPositionRef.current;
    previewGalleryPositionRef.current = null;

    if (editor.isDestroyed) {
      window.requestAnimationFrame(() => {
        const liveGallery =
          (galleryElement?.isConnected ? galleryElement : null) ??
          (galleryPositionAtOpen !== null
            ? (Array.from(
                document.querySelectorAll<HTMLElement>(
                  `div[data-type="gallery"][data-gallery-position="${galleryPositionAtOpen}"]`,
                ),
              ).at(-1) ?? null)
            : null);
        if (liveGallery?.isConnected) {
          liveGallery
            .querySelector<HTMLImageElement>('figure[data-type="gallery-item"] img')
            ?.click();
        }

        window.requestAnimationFrame(() => {
          (
            liveGallery?.querySelector<HTMLButtonElement>('button[aria-label="预览图库"]') ??
            document.querySelector<HTMLButtonElement>('button[aria-label="预览图库"]')
          )?.focus();
        });
      });
      return;
    }

    if (editor.isEditable && galleryPosition !== null) {
      // YARL restores focus from its own cleanup after the close animation. Wait
      // for that portal to unmount, then restore the Gallery selection and focus
      // the newly mounted preview button.
      window.requestAnimationFrame(() => {
        if (editor.isDestroyed) return;

        const currentPosition = getPos();
        if (typeof currentPosition !== "number" || !editor.state.doc.nodeAt(currentPosition)) {
          return;
        }

        const selection = editor.state.selection;
        const gallerySelected =
          selection instanceof NodeSelection && selection.from === currentPosition;

        if (!gallerySelected) {
          editor.commands.setNodeSelection(currentPosition);
        }

        window.requestAnimationFrame(() => {
          if (editor.isDestroyed) return;

          try {
            const button = editor.view.dom.querySelector<HTMLButtonElement>(
              'button[aria-label="预览图库"]',
            );
            button?.focus();
          } catch {
            // The editor can be destroyed between the two animation frames.
          }
        });
      });
      return;
    }

    queueMicrotask(() => trigger?.focus());
  }

  closePreviewRef.current = closePreview;

  const updateColumns = (nextColumns: number) => {
    if (galleryPosition === null) return;

    dispatchGalleryTransaction(
      editor.state.tr.setNodeMarkup(galleryPosition, undefined, {
        ...node.attrs,
        columns: clampGalleryColumns(nextColumns),
      }),
    );
  };

  const updateImage = (index: number, patch: JournalGalleryImagePatch) => {
    if (galleryPosition === null || index < 0 || index >= node.childCount) return;

    const child = node.child(index);
    const attrs = { ...child.attrs };

    if (patch.alt !== undefined) attrs.alt = galleryAltValue(patch.alt);
    if (patch.caption !== undefined) attrs.caption = galleryCaptionValue(patch.caption);

    // Attribute edits originate from controls in a portal. Resetting the
    // NodeSelection here steals focus from the input and collapses the
    // settings panel after the first keystroke. setNodeMarkup does not move
    // the selection, so preserve the existing Gallery selection verbatim.
    const transaction = editor.state.tr.setNodeMarkup(
      galleryChildPosition(node, galleryPosition, index),
      undefined,
      attrs,
    );
    editor.view.dispatch(transaction);
  };

  const reorderImages = (from: number, to: number) => {
    if (galleryPosition === null) return;
    if (from < 0 || from >= node.childCount || to < 0 || to >= node.childCount || from === to) {
      return;
    }

    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(child));

    const [moved] = children.splice(from, 1);
    if (!moved) return;
    children.splice(to, 0, moved);

    dispatchGalleryTransaction(
      editor.state.tr.replaceWith(
        galleryPosition,
        galleryPosition + node.nodeSize,
        node.copy(Fragment.fromArray(children)),
      ),
    );
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    reorderImages(index, index + direction);
  };

  const removeImage = (index: number) => {
    if (galleryPosition === null || index < 0 || index >= node.childCount) return;

    if (node.childCount <= 1) {
      setSettingsOpen(false);
      deleteNode();
      return;
    }

    const child = node.child(index);
    const from = galleryChildPosition(node, galleryPosition, index);

    dispatchGalleryTransaction(editor.state.tr.delete(from, from + child.nodeSize));
  };

  const removeGallery = () => {
    setSettingsOpen(false);
    deleteNode();
  };

  async function handleGalleryFiles(files: File[]) {
    if (files.length === 0) return;

    const uploadImages = getGalleryUploadImages(editor);
    if (!uploadImages) {
      setUploadError("当前编辑器未配置图库上传。");
      return;
    }

    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploadError(null);
    setUploadingCount(files.length);

    try {
      const uploads = await uploadImages(files, controller.signal);
      if (controller.signal.aborted || editor.isDestroyed || !mountedRef.current) return;
      if (uploads.length === 0) {
        throw new Error("没有可插入的图片。");
      }

      const currentPosition = getPos();
      if (typeof currentPosition !== "number") {
        throw new Error("找不到当前图库，请重试。");
      }

      const currentGallery = editor.state.doc.nodeAt(currentPosition);
      if (!currentGallery || currentGallery.type.name !== JournalGallery.name) {
        return;
      }

      const galleryImageType = editor.schema.nodes.galleryImage;
      if (!galleryImageType) {
        throw new Error("当前编辑器不支持图库图片。");
      }

      const imageNodes = uploads.map((upload) => {
        const attrs = galleryImageAttrsFromUpload(upload);
        if (!attrs) {
          throw new Error("图片上传结果不完整，请重试。");
        }
        return galleryImageType.create(attrs);
      });
      const transaction = editor.state.tr.insert(
        currentPosition + currentGallery.nodeSize - 1,
        imageNodes,
      );
      transaction.setSelection(NodeSelection.create(transaction.doc, currentPosition));
      editor.view.dispatch(transaction);
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setUploadError(journalImageUploadErrorMessage(error));
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
      if (!controller.signal.aborted && mountedRef.current) {
        setUploadingCount(null);
      }
    }
  }

  return (
    <NodeViewWrapper
      className={`relative my-3 rounded-control border p-1 transition-colors ${
        showEditorChrome ? "border-hairline-strong bg-surface-2/30" : "border-transparent"
      }`}
      data-type="gallery"
      data-columns={columns}
      data-gallery-position={galleryPosition ?? undefined}
      data-selected={showEditorChrome ? "true" : "false"}
      onClick={selectGallery}
    >
      <NodeViewContent className={`${GALLERY_CONTENT_CLASS} ${GALLERY_GRID_CLASS[columns]}`} />

      {uploadError ? (
        <p role="alert" className="mt-1 px-1 text-xs text-accent-red">
          {uploadError}
        </p>
      ) : null}

      {showEditorChrome ? (
        <div
          role="toolbar"
          aria-label="图库工具"
          className="absolute right-2 top-2 z-10 flex max-w-[calc(100vw_-_24px)] flex-wrap items-center justify-end gap-1 rounded-control border border-hairline-strong bg-surface-1/95 p-1 shadow-lg backdrop-blur"
        >
          <div role="group" aria-label="图库列数" className="flex items-center gap-0.5">
            {GALLERY_COLUMN_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`${option} 列`}
                aria-pressed={columns === option}
                title={`${option} 列`}
                className={`inline-flex size-7 items-center justify-center rounded-[4px] border font-mono text-[10px] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                  columns === option
                    ? "border-ink/40 bg-surface-2 text-ink"
                    : "border-transparent text-muted hover:bg-surface-2 hover:text-ink"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => updateColumns(option)}
              >
                {option}
              </button>
            ))}
          </div>

          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-hairline-strong" />

          <button
            type="button"
            aria-label="预览图库"
            title="预览图库"
            className={GALLERY_TOOL_BUTTON_CLASS}
            disabled={previewItems.length === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              openPreview(0, event.currentTarget);
            }}
          >
            <Eye aria-hidden="true" className="size-3.5" />
          </button>

          <button
            type="button"
            aria-label={uploadingCount === null ? "添加图片" : `正在上传 ${uploadingCount} 张图片…`}
            title="添加图片"
            className={GALLERY_TOOL_BUTTON_CLASS}
            disabled={uploadingCount !== null}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setUploadError(null);
              uploadInputRef.current?.click();
            }}
          >
            {uploadingCount !== null ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <ImagePlus aria-hidden="true" className="size-3.5" />
            )}
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            accept={COVER_ACCEPT_ATTRIBUTE}
            className="hidden"
            aria-label="选择要添加到图库的图片"
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length > 0) void handleGalleryFiles(files);
            }}
          />
          {uploadingCount !== null ? (
            <span role="status" className="px-1 font-mono text-[10px] text-muted">
              正在上传 {uploadingCount} 张图片…
            </span>
          ) : null}

          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="图库设置"
                title="图库设置"
                className={GALLERY_TOOL_BUTTON_CLASS}
                onMouseDown={(event) => event.preventDefault()}
              >
                <SlidersHorizontal aria-hidden="true" className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              aria-label="图库设置"
              className="w-[22rem] max-w-[calc(100vw_-_24px)] p-3"
            >
              <JournalGalleryPanel
                images={images}
                onImageChange={updateImage}
                onMove={moveImage}
                onReorder={reorderImages}
                onRemove={removeImage}
                onClose={() => setSettingsOpen(false)}
              />
            </PopoverContent>
          </Popover>

          <button
            type="button"
            aria-label="删除图库"
            title="删除图库"
            className={GALLERY_TOOL_BUTTON_CLASS}
            onMouseDown={(event) => event.preventDefault()}
            onClick={removeGallery}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ) : null}

      <PhotoLightbox
        open={previewOpen}
        index={previewIndex}
        items={previewItems}
        onClose={closePreview}
      />
    </NodeViewWrapper>
  );
}
