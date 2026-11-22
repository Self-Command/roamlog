const BLOCKED_TAGS = ["script", "style", "iframe", "object", "embed", "form", "link", "meta"];

/** Presentation-only attributes a journal image may keep. */
const IMAGE_ATTRIBUTES = new Set([
  "src",
  "alt",
  "title",
  "width",
  "height",
  "loading",
  "decoding",
  "data-media-id",
]);
/** Journal layout wrappers keep only the fixed data attributes the renderer reads. */
const FIGURE_ATTRIBUTES = new Set(["data-type", "data-align", "data-columns", "data-column-index"]);
const DIV_ATTRIBUTES = new Set(["data-type", "data-columns", "data-column-index"]);
/** Read-only task-list checkbox attributes; everything else on an input is dropped. */
const INPUT_ATTRIBUTES = new Set(["type", "checked", "disabled"]);
/** Media ids are UUIDs; the version is intentionally not pinned for older content. */
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAYOUT_ATTRIBUTES = ["data-type", "data-align", "data-columns", "data-column-index"] as const;
const LAYOUT_TYPES_BY_TAG: Record<string, ReadonlySet<string>> = {
  FIGURE: new Set(["image", "gallery", "gallery-item"]),
  DIV: new Set(["gallery", "columns", "column"]),
};
const IMAGE_ALIGNMENTS = new Set(["left", "center", "right"]);

/** Absolute http(s) URLs and same-site paths only. */
function isAllowedImageSrc(value: string): boolean {
  const src = value.trim();
  return src.length > 0 && !src.includes("\\") && /^(?:https?:\/\/|\/(?!\/))/i.test(src);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

/** http(s), mailto, or a single-slash same-site path; never a protocol-relative URL. */
function isAllowedLinkHref(value: string | null): boolean {
  const href = value?.trim() ?? "";
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

/** Replace an element with its children, preserving text and nested media. */
function unwrapElement(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function integerInRange(value: string | null, min: number, max: number): number | null {
  const text = value?.trim() ?? "";
  if (!/^\d+$/.test(text)) return null;

  const numeric = Number(text);
  return Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : null;
}

function normalizeLayoutData(element: Element): void {
  const allowedTypes = LAYOUT_TYPES_BY_TAG[element.tagName];
  if (!allowedTypes) return;

  const dataType = (element.getAttribute("data-type") ?? "").trim().toLowerCase();
  const rawAlignment = element.getAttribute("data-align");
  const rawColumns = element.getAttribute("data-columns");
  const rawColumnIndex = element.getAttribute("data-column-index");

  for (const attribute of LAYOUT_ATTRIBUTES) element.removeAttribute(attribute);

  if (!allowedTypes.has(dataType)) return;

  element.setAttribute("data-type", dataType);

  if (element.tagName === "FIGURE" && dataType === "image") {
    const alignment = (rawAlignment ?? "").trim().toLowerCase();
    if (IMAGE_ALIGNMENTS.has(alignment)) element.setAttribute("data-align", alignment);
  }

  if (dataType === "gallery") {
    element.setAttribute("data-columns", String(integerInRange(rawColumns, 1, 6) ?? 3));
  }

  if (element.tagName === "DIV" && dataType === "columns") {
    element.setAttribute("data-columns", String(integerInRange(rawColumns, 1, 4) ?? 2));
  }

  if (element.tagName === "DIV" && dataType === "column") {
    element.setAttribute("data-column-index", String(integerInRange(rawColumnIndex, 0, 3) ?? 0));
  }
}

/**
 * Defense-in-depth sanitizer for public share HTML.
 *
 * The API already runs `SanitizeService`, but the share page renders raw HTML
 * with `dangerouslySetInnerHTML`, so it re-applies the same safe subset in the
 * browser: no script/style/iframe, no event handlers, no `javascript:`/`data:`
 * URLs, images limited to presentation attributes, and task-list checkboxes
 * limited to a disabled `type="checkbox"`.
 */
export function sanitizePublicHtml(html: string): string {
  if (typeof document === "undefined") {
    // The public API response is already sanitized by the API's
    // SanitizeService before it reaches this renderer. During SSR there is no
    // DOM implementation here, so preserve that server-trusted HTML instead of
    // deleting the article; the browser repeats the allowlist after hydration.
    return html;
  }

  const template = document.createElement("template");
  template.innerHTML = html;

  for (const selector of BLOCKED_TAGS) {
    template.content.querySelectorAll(selector).forEach((node) => node.remove());
  }

  template.content.querySelectorAll("input").forEach((input) => {
    if ((input.getAttribute("type") ?? "").trim().toLowerCase() !== "checkbox") {
      input.remove();
      return;
    }
    for (const attribute of [...input.attributes]) {
      if (!INPUT_ATTRIBUTES.has(attribute.name.toLowerCase())) {
        input.removeAttribute(attribute.name);
      }
    }
    input.setAttribute("disabled", "");
  });

  template.content.querySelectorAll("img").forEach((image) => {
    if (!isAllowedImageSrc(image.getAttribute("src") ?? "")) {
      image.remove();
      return;
    }
    for (const attribute of [...image.attributes]) {
      if (!IMAGE_ATTRIBUTES.has(attribute.name.toLowerCase())) {
        image.removeAttribute(attribute.name);
      }
    }
    const mediaId = image.getAttribute("data-media-id");
    if (mediaId !== null) {
      const trimmed = mediaId.trim();
      if (MEDIA_ID.test(trimmed)) {
        image.setAttribute("data-media-id", trimmed);
      } else {
        image.removeAttribute("data-media-id");
      }
    }
  });

  // A stripped image must not leave a visible empty figure/box behind. This
  // runs after the image allowlist so a figure with only an unsafe image is
  // also removed.
  template.content
    .querySelectorAll('figure[data-type="image"], figure[data-type="gallery-item"]')
    .forEach((figure) => {
      if (!figure.querySelector("img[src]")) figure.remove();
    });

  template.content.querySelectorAll("*").forEach((element) => {
    normalizeLayoutData(element);

    const allowedDataAttributes =
      element.tagName === "FIGURE"
        ? FIGURE_ATTRIBUTES
        : element.tagName === "DIV"
          ? DIV_ATTRIBUTES
          : null;
    if (allowedDataAttributes) {
      for (const attribute of [...element.attributes]) {
        if (!allowedDataAttributes.has(attribute.name.toLowerCase())) {
          element.removeAttribute(attribute.name);
        }
      }
    }

    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcdoc" ||
        name === "srcset" ||
        ((name === "href" || name === "src") &&
          (value.startsWith("javascript:") || value.startsWith("data:")))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName === "A") {
      if (!isAllowedLinkHref(element.getAttribute("href"))) {
        unwrapElement(element);
        return;
      }

      const target = element.getAttribute("target")?.trim().toLowerCase();
      element.setAttribute("rel", "noopener noreferrer");
      if (target === "_blank") {
        element.setAttribute("target", "_blank");
      } else {
        element.removeAttribute("target");
      }
    }
  });

  return template.innerHTML;
}
