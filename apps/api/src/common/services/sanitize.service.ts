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
  // Journal images and the read-only task-list markup Tiptap emits.
  "img",
  "div",
  "span",
  "label",
  "input",
] as const;

/** Absolute http(s) URLs and same-site paths only: no `data:`, `javascript:` or `//host`. */
const SAFE_IMAGE_SRC = /^(?:https?:\/\/|\/(?!\/))/i;

function isSafeImageSrc(value: string | undefined): boolean {
  const src = value?.trim() ?? "";
  return src.length > 0 && !src.includes("\\") && SAFE_IMAGE_SRC.test(src);
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
      ...(Object.prototype.hasOwnProperty.call(attribs, "checked")
        ? { checked: "checked" }
        : {}),
    },
  };
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...TIPTAP_TAGS],
  allowedAttributes: {
    a: ["href", "title", "rel"],
    code: ["class"],
    pre: ["class"],
    table: ["class"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    col: ["span"],
    // Images carry presentation only. Event handlers, style and every other
    // attribute are dropped by the allowlist.
    img: ["src", "alt", "title", "width", "height"],
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
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: "noopener noreferrer",
      },
    }),
    input: normalizeInputTag,
  },
  exclusiveFilter: (frame) => {
    // An img whose src was stripped (data:/javascript:/unknown scheme) is
    // meaningless: drop the element instead of emitting an empty <img>.
    if (frame.tag === "img") {
      return !isSafeImageSrc(frame.attribs.src);
    }
    return false;
  },
};

@Injectable()
export class SanitizeService {
  sanitizeHtml(html: string): string {
    return sanitizeHtml(html, OPTIONS);
  }
}
