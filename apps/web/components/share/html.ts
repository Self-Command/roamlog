const BLOCKED_TAGS = ["script", "style", "iframe", "object", "embed", "form", "input", "link", "meta"];

export function sanitizePublicHtml(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<[^>]*>/g, " ").trim();
  }

  const template = document.createElement("template");
  template.innerHTML = html;

  for (const selector of BLOCKED_TAGS) {
    template.content.querySelectorAll(selector).forEach((node) => node.remove());
  }

  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        ((name === "href" || name === "src") && value.startsWith("javascript:"))
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
