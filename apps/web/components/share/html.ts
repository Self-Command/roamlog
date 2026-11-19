const BLOCKED_TAGS = ["script", "style", "iframe", "object", "embed", "form", "link", "meta"];

/** Presentation-only attributes a journal image may keep. */
const IMAGE_ATTRIBUTES = new Set(["src", "alt", "title", "width", "height"]);
/** Read-only task-list checkbox attributes; everything else on an input is dropped. */
const INPUT_ATTRIBUTES = new Set(["type", "checked", "disabled"]);

/** Absolute http(s) URLs and same-site paths only. */
function isAllowedImageSrc(value: string): boolean {
  const src = value.trim();
  return src.length > 0 && !src.includes("\\") && /^(?:https?:\/\/|\/(?!\/))/i.test(src);
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
    return html.replace(/<[^>]*>/g, " ").trim();
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
  });

  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcdoc" ||
        ((name === "href" || name === "src") &&
          (value.startsWith("javascript:") || value.startsWith("data:")))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName === "A") {
      element.setAttribute("rel", "noreferrer nofollow");
      element.setAttribute("target", "_blank");
    }
  });

  return template.innerHTML;
}
