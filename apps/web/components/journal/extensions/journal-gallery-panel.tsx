"use client";

import { Button, Input } from "@roamlog/ui";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, ImageOff, Trash2, X } from "lucide-react";
import type { CSSProperties } from "react";

import { sanitizeGallerySource, type JournalGalleryImageAttrs } from "./journal-gallery";

export interface JournalGalleryImagePatch {
  alt?: string;
  caption?: string | null;
}

export interface JournalGalleryPanelProps {
  images: JournalGalleryImageAttrs[];
  onImageChange: (index: number, patch: JournalGalleryImagePatch) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onClose: () => void;
}

function galleryImageSortableId(image: JournalGalleryImageAttrs, index: number): string {
  return `${index}:${image.mediaId ?? image.src}`;
}

function galleryImageLabel(image: JournalGalleryImageAttrs, index: number): string {
  return image.alt || image.caption || `第 ${index + 1} 张图片`;
}

/**
 * Resolves a dnd-kit drag result to the two gallery indexes that must swap
 * places. Kept pure so the panel wiring and its cancellation path are testable
 * without relying on browser layout measurements.
 */
export function galleryReorderTarget(
  ids: readonly string[],
  activeId: string | number,
  overId: string | number | null,
): { from: number; to: number } | null {
  if (overId === null) return null;

  const from = ids.indexOf(String(activeId));
  const to = ids.indexOf(String(overId));

  return from < 0 || to < 0 || from === to ? null : { from, to };
}

/** Applies a drag result to the caller's reorder callback. */
export function reorderGalleryByDrag(
  ids: readonly string[],
  activeId: string | number,
  overId: string | number | null,
  onReorder: (from: number, to: number) => void,
): boolean {
  const target = galleryReorderTarget(ids, activeId, overId);
  if (!target) return false;

  onReorder(target.from, target.to);
  return true;
}

interface SortableGalleryRowProps {
  image: JournalGalleryImageAttrs;
  index: number;
  total: number;
  onImageChange: (index: number, patch: JournalGalleryImagePatch) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}

function SortableGalleryRow({
  image,
  index,
  total,
  onImageChange,
  onMove,
  onRemove,
}: SortableGalleryRowProps) {
  const id = galleryImageSortableId(image, index);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const src = sanitizeGallerySource(image.src);

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-gallery-image-index={index}
      data-gallery-sortable-id={id}
      className={`rounded-control border border-hairline bg-surface-1/70 p-2 transition-colors ${
        isDragging ? "z-10 border-hairline-strong opacity-70 shadow-lg" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={`拖动第 ${index + 1} 张图片`}
          title={`拖动第 ${index + 1} 张图片`}
          className="mt-1 inline-flex size-6 shrink-0 touch-none items-center justify-center rounded-[4px] border border-transparent text-muted outline-none transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          data-dnd-handle=""
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button>

        <span
          aria-hidden="true"
          className="mt-1 w-4 shrink-0 font-mono text-[10px] tabular-nums text-muted"
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-hairline bg-surface-2">
          {src ? (
            <img
              src={src}
              alt={`第 ${index + 1} 张图片缩略图`}
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            <span
              role="img"
              aria-label={`第 ${index + 1} 张图片无缩略图`}
              className="flex size-full items-center justify-center"
            >
              <ImageOff aria-hidden="true" className="size-4 text-muted" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <Input
            aria-label={`第 ${index + 1} 张图片的替代文本`}
            value={image.alt ?? ""}
            placeholder="替代文本"
            className="h-8 text-xs"
            onChange={(event) => onImageChange(index, { alt: event.target.value })}
          />
          <Input
            aria-label={`第 ${index + 1} 张图片的说明`}
            value={image.caption ?? ""}
            placeholder="图片说明（可选）"
            className="h-8 text-xs"
            onChange={(event) => onImageChange(index, { caption: event.target.value })}
          />
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="subtle"
          size="sm"
          className="size-8 p-0"
          aria-label={`上移第 ${index + 1} 张图片`}
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp aria-hidden="true" className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="subtle"
          size="sm"
          className="size-8 p-0"
          aria-label={`下移第 ${index + 1} 张图片`}
          disabled={index === total - 1}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown aria-hidden="true" className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          className="size-8 p-0"
          aria-label={`删除第 ${index + 1} 张图片`}
          onClick={() => onRemove(index)}
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

/**
 * Gallery settings panel.
 *
 * Ported from emdash-cms/emdash@732867e9836efbd9fa9cf01f4fd086949b1bb392:
 * - packages/admin/src/components/editor/GalleryDetailPanel.tsx:232-312
 *   (columns, thumbnail list, per-image alt/caption, remove, delete gallery)
 * - packages/admin/src/components/editor/GalleryDetailPanel.tsx:337-404
 *   (numbered thumbnail row and remove action)
 * - packages/admin/src/components/editor/GalleryDetailPanel.tsx:406-520
 *   (per-image alt and caption inputs)
 * - packages/admin/src/components/editor/GalleryDetailPanel.tsx:120-220,
 *   268-384 (pointer/keyboard sensors, SortableContext, screen-reader
 *   announcements, and the sortable thumbnail handle)
 *
 * Adaptation layer: Roamlog reads ordered galleryImage child nodes instead of
 * Emdash's `attributes.images`, keeps explicit up/down controls as the keyboard
 * fallback alongside drag sorting, and uses Roamlog UI primitives and tokens.
 */
export function JournalGalleryPanel({
  images,
  onImageChange,
  onMove,
  onReorder,
  onRemove,
  onClose,
}: JournalGalleryPanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = images.map(galleryImageSortableId);

  function imageAt(id: string | number): JournalGalleryImageAttrs | null {
    const index = ids.indexOf(String(id));
    return index < 0 ? null : (images[index] ?? null);
  }

  function imageIndex(id: string | number): number {
    return ids.indexOf(String(id));
  }

  function handleDragEnd(event: DragEndEvent): void {
    reorderGalleryByDrag(ids, event.active.id, event.over?.id ?? null, onReorder);
  }

  const dragAccessibility = {
    announcements: {
      onDragStart: ({ active }: { active: { id: string | number } }) => {
        const index = imageIndex(active.id);
        const image = imageAt(active.id);
        return image ? `已拿起${galleryImageLabel(image, index)}。` : "已拿起图片。";
      },
      onDragOver: ({
        active,
        over,
      }: {
        active: { id: string | number };
        over: { id: string | number } | null;
      }) => {
        if (!over) return "";
        const image = imageAt(active.id);
        const target = imageIndex(over.id);
        return image && target >= 0
          ? `正在将${galleryImageLabel(image, imageIndex(active.id))}移动到第 ${target + 1} 张。`
          : "";
      },
      onDragEnd: ({
        active,
        over,
      }: {
        active: { id: string | number };
        over: { id: string | number } | null;
      }) => {
        if (!over) return "移动已取消。";
        const image = imageAt(active.id);
        const target = imageIndex(over.id);
        return image && target >= 0
          ? `${galleryImageLabel(image, imageIndex(active.id))}已移动到第 ${target + 1} 张。`
          : "移动已结束。";
      },
      onDragCancel: () => "移动已取消。",
    },
    screenReaderInstructions: {
      draggable: "按空格拿起图片，使用方向键移动，再按空格放下。",
    },
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">图库设置</h3>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {images.length} 张图片
          </p>
        </div>
        <Button
          type="button"
          variant="subtle"
          size="sm"
          className="size-8 shrink-0 p-0"
          aria-label="关闭图库设置"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </div>

      {images.length === 0 ? (
        <p className="rounded-control border border-dashed border-hairline-strong px-3 py-6 text-center text-xs leading-5 text-muted">
          图库中没有图片。
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={dragAccessibility}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <ol
              aria-label="图库图片列表"
              className="m-0 max-h-[min(60vh,30rem)] list-none space-y-2 overflow-y-auto p-0 pr-0.5"
            >
              {images.map((image, index) => (
                <SortableGalleryRow
                  key={ids[index]}
                  image={image}
                  index={index}
                  total={images.length}
                  onImageChange={onImageChange}
                  onMove={onMove}
                  onRemove={onRemove}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
