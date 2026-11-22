import { Node } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { JournalImageNodeView } from "./journal-image-node-view";

export interface JournalImageOptions {
  inline: boolean;
  /**
   * Kept for API compatibility with `@tiptap/extension-image`. Journal
   * content never persists inline payloads, so `data:` URLs are always
   * rejected regardless of this flag.
   */
  allowBase64: boolean;
  /** Uploads a replacement through the editor's media pipeline. */
  uploadImage?: JournalImageUpload;
}

export interface JournalImageUploadResult {
  src: string;
  mediaId: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
}

export type JournalImageUpload = (
  file: File,
  signal: AbortSignal,
) => Promise<JournalImageUploadResult>;

export interface JournalImageAttributes {
  src: string;
  alt: string;
  title: string | null;
  caption: string | null;
  alignment: "left" | "center" | "right" | null;
  displayWidth: number | null;
  displayHeight: number | null;
  linkHref: string | null;
  linkBlank: boolean;
  mediaId: string | null;
}

const MAX_TEXT_LENGTH = 280;
const MIN_DISPLAY_SIZE = 80;
const MAX_DISPLAY_SIZE = 2400;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE_BASE = new URL("https://roamlog.invalid/");

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;

  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isSiteRelative(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;

  try {
    return new URL(value, SITE_BASE).origin === SITE_BASE.origin;
  } catch {
    return false;
  }
}

function isMailto(value: string): boolean {
  if (!/^mailto:/i.test(value)) return false;

  try {
    const url = new URL(value);
    return url.protocol === "mailto:" && url.pathname.length > 0;
  } catch {
    return false;
  }
}

function sanitizeImageSrc(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const src = value.trim();
  if (!src || hasControlCharacters(src)) return null;

  return isHttpUrl(src) || isSiteRelative(src) ? src : null;
}

function sanitizeLinkHref(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const href = value.trim();
  if (!href || hasControlCharacters(href)) return null;

  return isHttpUrl(href) || isMailto(href) || isSiteRelative(href) ? href : null;
}

function sanitizeText(value: unknown): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, MAX_TEXT_LENGTH);
}

function sanitizeOptionalText(value: unknown): string | null {
  const text = sanitizeText(value);
  return text.length > 0 ? text : null;
}

function sanitizeAlignment(value: unknown): JournalImageAttributes["alignment"] {
  return value === "left" || value === "center" || value === "right" ? value : null;
}

function sanitizeDimension(value: unknown): number | null {
  let numeric: number;

  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numeric = Number(value);
  } else {
    return null;
  }

  if (!Number.isFinite(numeric)) return null;

  return Math.min(MAX_DISPLAY_SIZE, Math.max(MIN_DISPLAY_SIZE, Math.round(numeric)));
}

function sanitizeMediaId(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const mediaId = value.trim();
  return UUID_RE.test(mediaId) ? mediaId : null;
}

function sanitizeBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

export function sanitizeJournalImageAttributes(
  attrs: Record<string, unknown>,
): JournalImageAttributes {
  return {
    src: sanitizeImageSrc(attrs.src) ?? "",
    alt: sanitizeText(attrs.alt),
    title: sanitizeOptionalText(attrs.title),
    caption: sanitizeOptionalText(attrs.caption),
    alignment: sanitizeAlignment(attrs.alignment),
    displayWidth: sanitizeDimension(attrs.displayWidth),
    displayHeight: sanitizeDimension(attrs.displayHeight),
    linkHref: sanitizeLinkHref(attrs.linkHref),
    linkBlank: sanitizeBoolean(attrs.linkBlank),
    mediaId: sanitizeMediaId(attrs.mediaId),
  };
}

function findFigureImage(
  figure: HTMLElement,
): { img: HTMLImageElement; anchor: HTMLAnchorElement | null } | null {
  for (const child of Array.from(figure.children)) {
    if (child.tagName === "IMG") {
      return { img: child as HTMLImageElement, anchor: null };
    }

    if (child.tagName === "A") {
      const img = child.querySelector("img");
      if (img) return { img, anchor: child as HTMLAnchorElement };
    }
  }

  return null;
}

function readImageAttributes(
  img: HTMLImageElement,
  figure?: HTMLElement,
  anchor?: HTMLAnchorElement | null,
): JournalImageAttributes | false {
  const src = sanitizeImageSrc(img.getAttribute("src"));
  if (!src) return false;

  const caption = figure
    ? Array.from(figure.children).find((child) => child.tagName === "FIGCAPTION")
    : undefined;
  const linkHref = sanitizeLinkHref(anchor?.getAttribute("href"));

  return {
    src,
    alt: sanitizeText(img.getAttribute("alt")),
    title: sanitizeOptionalText(img.getAttribute("title")),
    caption: sanitizeOptionalText(caption?.textContent),
    alignment: sanitizeAlignment(figure?.getAttribute("data-align")),
    displayWidth: sanitizeDimension(img.getAttribute("width")),
    displayHeight: sanitizeDimension(img.getAttribute("height")),
    linkHref,
    linkBlank: linkHref !== null && anchor?.getAttribute("target")?.toLowerCase() === "_blank",
    mediaId: sanitizeMediaId(img.getAttribute("data-media-id")),
  };
}

/**
 * Journal image node. Ported from Emdash's portable-text image attributes and
 * render contract, with the Roamlog figure/data-* HTML shape from the journal
 * layout spec.
 */
export const JournalImage = Node.create<JournalImageOptions>({
  name: "image",

  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      uploadImage: undefined,
    };
  },

  inline() {
    return this.options.inline;
  },

  group() {
    return this.options.inline ? "inline" : "block";
  },

  atom: true,
  draggable: true,
  selectable: true,

  addNodeView() {
    return ReactNodeViewRenderer(JournalImageNodeView);
  },

  addAttributes() {
    return {
      src: {
        default: "",
      },
      alt: {
        default: "",
      },
      title: {
        default: null,
      },
      caption: {
        default: null,
      },
      alignment: {
        default: null,
      },
      displayWidth: {
        default: null,
      },
      displayHeight: {
        default: null,
      },
      linkHref: {
        default: null,
      },
      linkBlank: {
        default: false,
      },
      mediaId: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="image"]',
        priority: 1000,
        getAttrs: (element) => {
          const figure = element as HTMLElement;
          const found = findFigureImage(figure);
          if (!found) return false;

          return readImageAttributes(found.img, figure, found.anchor);
        },
      },
      {
        tag: "img[src]",
        priority: 100,
        getAttrs: (element) => {
          const img = element as HTMLImageElement;
          if (img.closest('figure[data-type="image"]')) return false;

          return readImageAttributes(img);
        },
      },
    ];
  },

  renderHTML({ node }): DOMOutputSpec {
    const attrs = sanitizeJournalImageAttributes(node.attrs);
    const figureAttributes: Record<string, string> = { "data-type": "image" };

    if (attrs.alignment) figureAttributes["data-align"] = attrs.alignment;
    if (!attrs.src) return ["figure", figureAttributes];

    const imgAttributes: Record<string, string | number> = {
      src: attrs.src,
      alt: attrs.alt,
    };
    if (attrs.title) imgAttributes.title = attrs.title;
    if (attrs.displayWidth !== null) imgAttributes.width = attrs.displayWidth;
    if (attrs.displayHeight !== null) imgAttributes.height = attrs.displayHeight;
    imgAttributes.loading = "lazy";
    imgAttributes.decoding = "async";
    if (attrs.mediaId) imgAttributes["data-media-id"] = attrs.mediaId;

    const image: DOMOutputSpec = ["img", imgAttributes];
    const children: DOMOutputSpec[] = [];

    if (attrs.linkHref) {
      const linkAttributes: Record<string, string> = { href: attrs.linkHref };
      if (attrs.linkBlank) linkAttributes.target = "_blank";
      linkAttributes.rel = "noopener noreferrer";
      children.push(["a", linkAttributes, image]);
    } else {
      children.push(image);
    }

    if (attrs.caption) children.push(["figcaption", {}, attrs.caption]);

    return ["figure", figureAttributes, ...children] as DOMOutputSpec;
  },
});

export default JournalImage;
