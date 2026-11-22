import { Node } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { JournalGalleryImageNodeView } from "./journal-gallery-image-node-view";
import { JournalGalleryNodeView } from "./journal-gallery-node-view";

export const GALLERY_DEFAULT_COLUMNS = 3;
export const GALLERY_MIN_COLUMNS = 1;
export const GALLERY_MAX_COLUMNS = 6;
export const GALLERY_TEXT_MAX_LENGTH = 280;

const GALLERY_ITEM_SELECTOR = 'figure[data-type="gallery-item"]';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JournalGalleryImageAttrs {
  src: string;
  alt: string;
  title: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  mediaId: string | null;
}

export interface JournalGalleryAttrs {
  columns: number;
}

export interface JournalGalleryUploadImage {
  src: string;
  mediaId: string;
  alt: string;
  width?: number | null;
  height?: number | null;
}

export type JournalGalleryUploadImages = (
  files: File[],
  signal: AbortSignal,
) => Promise<JournalGalleryUploadImage[]>;

export interface JournalGalleryOptions {
  uploadImages?: JournalGalleryUploadImages;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function clampGalleryColumns(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(numeric) &&
    numeric >= GALLERY_MIN_COLUMNS &&
    numeric <= GALLERY_MAX_COLUMNS
    ? numeric
    : GALLERY_DEFAULT_COLUMNS;
}

export function sanitizeGallerySource(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const src = value.trim();
  if (!src) return null;

  if (src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/\\")) {
    return src;
  }

  try {
    const url = new URL(src);
    return url.protocol === "http:" || url.protocol === "https:" ? src : null;
  } catch {
    return null;
  }
}

export function sanitizeGalleryMediaId(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const mediaId = value.trim();
  return UUID_PATTERN.test(mediaId) ? mediaId : null;
}

function galleryText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const text = value.trim();
  return text ? text.slice(0, GALLERY_TEXT_MAX_LENGTH) : null;
}

function positiveInteger(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeGalleryImageAttrs(value: unknown): JournalGalleryImageAttrs {
  const attrs = asRecord(value);

  return {
    src: sanitizeGallerySource(attrs.src) ?? "",
    alt: galleryText(attrs.alt) ?? "",
    title: galleryText(attrs.title),
    caption: galleryText(attrs.caption),
    width: positiveInteger(attrs.width),
    height: positiveInteger(attrs.height),
    mediaId: sanitizeGalleryMediaId(attrs.mediaId),
  };
}

/** Validates one upload result before it is inserted into the document. */
export function galleryImageAttrsFromUpload(
  image: JournalGalleryUploadImage,
): JournalGalleryImageAttrs | null {
  const attrs = normalizeGalleryImageAttrs(image);
  return attrs.src && attrs.mediaId ? attrs : null;
}

function isGalleryItemElement(element: Element): boolean {
  return element.tagName === "FIGURE" && element.getAttribute("data-type") === "gallery-item";
}

function isDirectGalleryItem(element: Element): boolean {
  const parent = element.parentElement;
  return parent?.tagName === "DIV" && parent.getAttribute("data-type") === "gallery";
}

function parseGalleryImageElement(element: Element): JournalGalleryImageAttrs | null {
  const image = element.querySelector("img");
  if (!image) return null;

  const src = sanitizeGallerySource(image.getAttribute("src"));
  if (!src) return null;

  return {
    src,
    alt: galleryText(image.getAttribute("alt")) ?? "",
    title: galleryText(image.getAttribute("title")),
    caption: galleryText(element.querySelector("figcaption")?.textContent),
    width: positiveInteger(image.getAttribute("width")),
    height: positiveInteger(image.getAttribute("height")),
    mediaId: sanitizeGalleryMediaId(image.getAttribute("data-media-id")),
  };
}

function galleryChildTypeName(value: unknown): string | null {
  const type = asRecord(value).type;
  if (typeof type === "string") return type;
  if (type !== null && typeof type === "object") {
    const name = asRecord(type).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

export function galleryImagesFromNode(node: unknown): JournalGalleryImageAttrs[] {
  const content = asRecord(node).content;
  const children: unknown[] = [];

  if (Array.isArray(content)) {
    children.push(...content);
  } else if (
    content !== null &&
    typeof content === "object" &&
    typeof (content as { forEach?: unknown }).forEach === "function"
  ) {
    (content as { forEach: (callback: (child: unknown) => void) => void }).forEach((child) =>
      children.push(child),
    );
  }

  return children
    .filter((child) => galleryChildTypeName(child) === "galleryImage")
    .map((child) => normalizeGalleryImageAttrs(asRecord(child).attrs));
}

export const JournalGalleryImage = Node.create({
  name: "galleryImage",

  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      src: { default: "", parseHTML: () => null },
      alt: { default: "", parseHTML: () => null },
      title: { default: null, parseHTML: () => null },
      caption: { default: null, parseHTML: () => null },
      width: { default: null, parseHTML: () => null },
      height: { default: null, parseHTML: () => null },
      mediaId: { default: null, parseHTML: () => null },
    };
  },

  parseHTML() {
    return [
      {
        tag: GALLERY_ITEM_SELECTOR,
        getAttrs: (element) => {
          if (!isDirectGalleryItem(element)) return false;
          return parseGalleryImageElement(element) ?? false;
        },
      },
    ];
  },

  renderHTML({ node }): DOMOutputSpec {
    const attrs = normalizeGalleryImageAttrs(node.attrs);
    const imageAttributes: Record<string, string> = {
      src: attrs.src,
      alt: attrs.alt,
    };

    if (attrs.title) imageAttributes.title = attrs.title;
    if (attrs.width !== null) imageAttributes.width = String(attrs.width);
    if (attrs.height !== null) imageAttributes.height = String(attrs.height);
    imageAttributes.loading = "lazy";
    imageAttributes.decoding = "async";
    if (attrs.mediaId) imageAttributes["data-media-id"] = attrs.mediaId;

    const children: DOMOutputSpec[] = [];
    if (attrs.src) children.push(["img", imageAttributes]);
    if (attrs.caption) children.push(["figcaption", attrs.caption]);

    return ["figure", { "data-type": "gallery-item" }, ...children];
  },

  addNodeView() {
    return ReactNodeViewRenderer(JournalGalleryImageNodeView);
  },
});

export const JournalGallery = Node.create<JournalGalleryOptions>({
  name: "gallery",

  group: "block",
  content: "galleryImage+",
  isolating: true,
  defining: true,
  draggable: true,

  addOptions() {
    return {
      uploadImages: undefined,
    };
  },

  addAttributes() {
    return {
      columns: {
        default: GALLERY_DEFAULT_COLUMNS,
        parseHTML: () => null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="gallery"]',
        getAttrs: (element) => {
          const images = Array.from(element.children)
            .filter(isGalleryItemElement)
            .map(parseGalleryImageElement);

          if (!images.some((image) => image !== null)) return false;

          return {
            columns: clampGalleryColumns(element.getAttribute("data-columns")),
          };
        },
      },
    ];
  },

  renderHTML({ node }): DOMOutputSpec {
    return [
      "div",
      {
        "data-type": "gallery",
        "data-columns": String(clampGalleryColumns(node.attrs.columns)),
      },
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(JournalGalleryNodeView);
  },
});

export const Gallery = JournalGallery;
export const GalleryImage = JournalGalleryImage;
