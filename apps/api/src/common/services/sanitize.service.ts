import { Injectable } from "@nestjs/common";
import sanitizeHtml from "sanitize-html";

const TIPTAP_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "a",
  "mark",
  "sup",
  "sub",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "colgroup",
  "col",
  // Journal images, layout wrappers and the read-only task-list markup Tiptap emits.
  "img",
  "figure",
  "figcaption",
  "div",
  "span",
  "label",
  "input",
] as const;

/** Absolute http(s) URLs and same-site paths only: no `data:`, `javascript:` or `//host`. */
const SAFE_IMAGE_SRC = /^(?:https?:\/\/|\/(?!\/))/i;
/** Media ids are UUIDs; the version is intentionally not pinned for older content. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAYOUT_ATTRIBUTES = ["data-type", "data-align", "data-columns", "data-column-index"] as const;
const LAYOUT_TYPES_BY_TAG = {
  figure: new Set(["image", "gallery", "gallery-item"]),
  div: new Set(["gallery", "columns", "column"]),
} as const;
const IMAGE_ALIGNMENTS = new Set(["left", "center", "right"]);

function isSafeImageSrc(value: string | undefined): boolean {
  const src = value?.trim() ?? "";
  return src.length > 0 && !src.includes("\\") && SAFE_IMAGE_SRC.test(src);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

/** http(s), mailto, or a single-slash same-site path; never a protocol-relative URL. */
function isSafeAnchorHref(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const href = value.trim();
  if (!href || href.includes("\\") || hasControlCharacters(href)) return false;
  if (href.startsWith("/") && !href.startsWith("//")) return true;

  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.length > 0;
    }
    return url.protocol === "mailto:" && url.pathname.length > 0;
  } catch {
    return false;
  }
}

function integerInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;

  const numeric = Number(text);
  return Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : null;
}

/**
 * Layout attributes are a closed vocabulary. Normalize values here, before
 * serialization, so a stored or imported document cannot choose an arbitrary
 * column count/alignment that the renderer and CSS do not support.
 */
function normalizeLayoutTag(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  const tag = tagName.toLowerCase();
  const allowedTypes = tag === "figure" || tag === "div" ? LAYOUT_TYPES_BY_TAG[tag] : null;

  if (!allowedTypes) return { tagName, attribs };

  const next = { ...attribs };
  const dataType = (next["data-type"] ?? "").trim().toLowerCase();

  for (const attribute of LAYOUT_ATTRIBUTES) delete next[attribute];

  if (!allowedTypes.has(dataType)) {
    return { tagName, attribs: next };
  }

  next["data-type"] = dataType;

  if (tag === "figure" && dataType === "image") {
    const alignment = (attribs["data-align"] ?? "").trim().toLowerCase();
    if (IMAGE_ALIGNMENTS.has(alignment)) next["data-align"] = alignment;
  }

  if (dataType === "gallery") {
    next["data-columns"] = String(integerInRange(attribs["data-columns"], 1, 6) ?? 3);
  }

  if (tag === "div" && dataType === "columns") {
    next["data-columns"] = String(integerInRange(attribs["data-columns"], 1, 4) ?? 2);
  }

  if (tag === "div" && dataType === "column") {
    next["data-column-index"] = String(integerInRange(attribs["data-column-index"], 0, 3) ?? 0);
  }

  return { tagName, attribs: next };
}

/**
 * Images carry presentation attributes plus a stable media id. The id is only
 * useful when it can be used for re-signing, so malformed values are dropped.
 * Loading/decoding are forced regardless of what the stored HTML claimed.
 */
function normalizeImageTag(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  if (tagName !== "img") return { tagName, attribs };

  const next = { ...attribs };
  const src = (attribs.src ?? "").trim();
  if (isSafeImageSrc(src)) {
    next.src = src;
  } else {
    delete next.src;
  }

  const mediaId = (attribs["data-media-id"] ?? "").trim();
  if (UUID.test(mediaId)) {
    next["data-media-id"] = mediaId;
  } else {
    delete next["data-media-id"];
  }

  next.loading = "lazy";
  next.decoding = "async";
  delete next.srcset;

  return { tagName, attribs: next };
}

function signedImageSrc(
  attribs: sanitizeHtml.Attributes,
  mediaUrlById: ReadonlyMap<string, string> | undefined,
): string | undefined {
  if (!mediaUrlById) return undefined;
  const mediaId = (attribs["data-media-id"] ?? "").trim();
  const signedSrc = UUID.test(mediaId) ? mediaUrlById.get(mediaId)?.trim() : undefined;
  return signedSrc || undefined;
}

/**
 * Rewrites an inline image from the response-scoped signed URL map before the
 * normal allowlist runs. A missing or malformed media id leaves the stored src
 * untouched, so old images are neither guessed nor dropped.
 */
function imageTagTransformer(
  mediaUrlById?: ReadonlyMap<string, string>,
): (tagName: string, attribs: sanitizeHtml.Attributes) => sanitizeHtml.Tag {
  return (tagName, attribs) => {
    if (tagName !== "img") return normalizeImageTag(tagName, attribs);

    const signedSrc = signedImageSrc(attribs, mediaUrlById);
    const nextAttribs = signedSrc ? { ...attribs, src: signedSrc } : attribs;
    return normalizeImageTag(tagName, nextAttribs);
  };
}

/**
 * Task lists render `<input type="checkbox">`. Public HTML is read-only, so
 * every checkbox is forced disabled; any other input is degraded to an inert
 * span (the same effect as stripping it) instead of being allowed through.
 */
function normalizeInputTag(
  tagName: string,
  attribs: Record<string, string>,
): { tagName: string; attribs: Record<string, string> } {
  if (tagName !== "input") return { tagName, attribs };

  const type = (attribs.type ?? "").trim().toLowerCase();
  if (type !== "checkbox") {
    return { tagName: "span", attribs: {} };
  }

  return {
    tagName: "input",
    attribs: {
      type: "checkbox",
      disabled: "disabled",
      ...(Object.prototype.hasOwnProperty.call(attribs, "checked") ? { checked: "checked" } : {}),
    },
  };
}

/**
 * `linkBlank` is persisted as `target="_blank"`. Only that exact target is
 * allowed, and every link gets the matching opener protection. Other target
 * values are dropped so stored or imported HTML cannot choose a browsing
 * context.
 */
function normalizeAnchorTag(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  const next = { ...attribs };

  // A stripped href must not leave an inert `<a>` in the document. Downgrade
  // it to a span so sanitize-html keeps the child text/images without a fake
  // link affordance.
  if (!isSafeAnchorHref(next.href)) {
    return { tagName: "span", attribs: {} };
  }

  if ((next.target ?? "").trim().toLowerCase() === "_blank") {
    next.target = "_blank";
  } else {
    delete next.target;
  }

  next.rel = "noopener noreferrer";

  return { tagName, attribs: next };
}

interface ParsedNode {
  name: string;
  attribs: sanitizeHtml.Attributes;
  children: ParsedNode[];
}

function hasSafeImage(node: ParsedNode): boolean {
  if (node.name === "img" && isSafeImageSrc(node.attribs.src)) return true;
  return node.children.some(hasSafeImage);
}

function isGalleryItem(node: ParsedNode): boolean {
  return (
    node.name === "figure" &&
    (node.attribs["data-type"] ?? "").trim().toLowerCase() === "gallery-item" &&
    hasSafeImage(node)
  );
}

function isColumn(node: ParsedNode): boolean {
  return node.name === "div" && (node.attribs["data-type"] ?? "").trim().toLowerCase() === "column";
}

/**
 * `exclusiveFilter` only exposes the closing frame, not its child tags. Track
 * the raw tag tree through the parser callbacks so an empty gallery/columns
 * wrapper can be dropped as a whole instead of leaving a broken layout.
 */
function createStructureTracker(mediaUrlById?: ReadonlyMap<string, string>) {
  const root: ParsedNode = { name: "#root", attribs: {}, children: [] };
  const stack: ParsedNode[] = [root];
  let lastClosed: ParsedNode | null = null;

  return {
    onOpenTag(name: string, attribs: sanitizeHtml.Attributes): void {
      const signedSrc =
        name.toLowerCase() === "img" ? signedImageSrc(attribs, mediaUrlById) : undefined;
      const node: ParsedNode = {
        name: name.toLowerCase(),
        attribs: signedSrc ? { ...attribs, src: signedSrc } : { ...attribs },
        children: [],
      };
      stack[stack.length - 1]?.children.push(node);
      stack.push(node);
    },

    onCloseTag(name: string): void {
      const target = name.toLowerCase();
      let index = stack.length - 1;
      while (index > 0 && stack[index]?.name !== target) index--;
      if (index <= 0) {
        lastClosed = null;
        return;
      }
      // htmlparser2 may close unclosed descendants together with their parent.
      stack.length = index + 1;
      lastClosed = stack.pop() ?? null;
    },

    consume(name: string): ParsedNode | null {
      const node = lastClosed;
      lastClosed = null;
      return node?.name === name ? node : null;
    },
  };
}

function createOptions(mediaUrlById?: ReadonlyMap<string, string>): sanitizeHtml.IOptions {
  const structure = createStructureTracker(mediaUrlById);

  return {
    allowedTags: [...TIPTAP_TAGS],
    allowedAttributes: {
      a: ["href", "title", "rel", "target"],
      code: ["class"],
      pre: ["class"],
      table: ["class"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      col: ["span"],
      // Images carry presentation only. Event handlers, style and every other
      // attribute are dropped by the allowlist.
      img: ["src", "alt", "title", "width", "height", "loading", "decoding", "data-media-id"],
      // Journal layout wrappers. Only the fixed data attributes are useful to
      // the renderer; class/style/on* stay out of the allowlist.
      figure: ["data-type", "data-align", "data-columns", "data-column-index"],
      div: ["data-type", "data-columns", "data-column-index"],
      // Read-only task list state; any other input is rejected below.
      input: ["type", "checked", "disabled"],
      ul: ["data-type"],
      li: ["data-type", "data-checked"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      a: ["http", "https", "mailto"],
      img: ["http", "https"],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: [
      "script",
      "style",
      "textarea",
      "option",
      "noscript",
      "iframe",
      "object",
      "embed",
      "form",
    ],
    transformTags: {
      a: normalizeAnchorTag,
      div: normalizeLayoutTag,
      figure: normalizeLayoutTag,
      img: imageTagTransformer(mediaUrlById),
      input: normalizeInputTag,
    },
    onOpenTag: structure.onOpenTag,
    onCloseTag: structure.onCloseTag,
    exclusiveFilter: (frame) => {
      // An img whose src was stripped (data:/javascript:/unknown scheme) is
      // meaningless: drop the element instead of emitting an empty <img>.
      if (frame.tag === "img") {
        structure.consume(frame.tag);
        return !isSafeImageSrc(signedImageSrc(frame.attribs, mediaUrlById) ?? frame.attribs.src);
      }

      const node = structure.consume(frame.tag);
      if (!node) return false;

      const dataType = (frame.attribs["data-type"] ?? "").trim().toLowerCase();
      if (
        frame.tag === "figure" &&
        (dataType === "image" || dataType === "gallery-item")
      ) {
        return !hasSafeImage(node);
      }
      if ((frame.tag === "div" || frame.tag === "figure") && dataType === "gallery") {
        return !node.children.some(isGalleryItem);
      }
      if (frame.tag === "div" && dataType === "columns") {
        return !node.children.some(isColumn);
      }
      return false;
    },
  };
}

@Injectable()
export class SanitizeService {
  sanitizeHtml(html: string): string {
    return sanitizeHtml(html, createOptions());
  }

  /**
   * Public-share variant: replaces `img[data-media-id]` sources from a
   * response-scoped signed URL map, then applies the same full sanitizer.
   * Stored content and every other caller keep using {@link sanitizeHtml}.
   */
  sanitizeHtmlWithSignedMediaUrls(html: string, mediaUrlById: ReadonlyMap<string, string>): string {
    return sanitizeHtml(html, createOptions(mediaUrlById));
  }
}
