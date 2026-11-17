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
] as const;

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
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    a: ["http", "https", "mailto"],
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
  },
};

@Injectable()
export class SanitizeService {
  sanitizeHtml(html: string): string {
    return sanitizeHtml(html, OPTIONS);
  }
}
