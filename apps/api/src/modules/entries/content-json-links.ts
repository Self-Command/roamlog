const SITE_BASE = new URL("https://roamlog.invalid/");
const OMIT = Symbol("omit-content-json-value");
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const href = value.trim();
  if (!href || hasControlCharacters(href) || href.includes("\\")) return null;

  if (href.startsWith("/")) {
    if (href.startsWith("//") || href.startsWith("/\\")) return null;

    try {
      const url = new URL(href, SITE_BASE);
      return url.origin === SITE_BASE.origin ? href : null;
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.length > 0 ? href : null;
    }
    if (url.protocol === "mailto:") {
      return url.pathname.length > 0 ? href : null;
    }
  } catch {
    return null;
  }

  return null;
}

function sanitizeLinkMark(mark: JsonRecord): JsonRecord | typeof OMIT {
  if (!isRecord(mark.attrs)) return OMIT;

  const href = safeHref(mark.attrs.href);
  if (!href) return OMIT;

  const attrs: JsonRecord = {
    href,
    rel: "noopener noreferrer",
  };
  const target =
    typeof mark.attrs.target === "string" ? mark.attrs.target.trim().toLowerCase() : "";
  if (target === "_blank") {
    attrs.target = "_blank";
  }

  return {
    type: "link",
    attrs,
  };
}

function sanitizeValue(value: unknown): unknown | typeof OMIT {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitized = sanitizeValue(item);
      return sanitized === OMIT ? [] : [sanitized];
    });
  }

  if (!isRecord(value)) return value;
  if (value.type === "link") return sanitizeLinkMark(value);

  const sanitized: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;

    const next = sanitizeValue(child);
    if (next !== OMIT) sanitized[key] = next;
  }
  return sanitized;
}

/**
 * Removes unsafe Tiptap link marks from persisted content JSON.
 *
 * The detail view renders `contentJson` directly, so the API cannot rely only
 * on the HTML sanitizer. Safe links keep their URL and only `_blank` targets;
 * a mark with an unsafe or missing href is removed while its text remains.
 */
export function sanitizeContentJsonLinkMarks(value: JsonRecord): JsonRecord {
  return sanitizeValue(value) as JsonRecord;
}
