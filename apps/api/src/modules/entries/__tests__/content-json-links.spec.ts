import { describe, expect, it } from "vitest";

import { sanitizeContentJsonLinkMarks } from "../content-json-links.js";

function linkMark(attrs: Record<string, unknown>): Record<string, unknown> {
  return { type: "link", attrs };
}

function text(textValue: string, marks: unknown[]): Record<string, unknown> {
  return { type: "text", text: textValue, marks };
}

describe("sanitizeContentJsonLinkMarks", () => {
  it("keeps safe protocols and same-site paths, and normalizes link attributes", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            text("web", [
              linkMark({
                href: " https://example.com/path ",
                target: "_BLANK",
                rel: "opener",
                class: "external",
                onclick: "alert(1)",
              }),
            ]),
            text("http", [linkMark({ href: "http://example.com" })]),
            text("mail", [linkMark({ href: "mailto:hello@example.com" })]),
            text("site", [linkMark({ href: "/trips/kyoto" })]),
          ],
        },
      ],
    };

    const result = sanitizeContentJsonLinkMarks(input) as typeof input;
    const content = result.content[0]!.content as Array<{
      marks: Array<{ attrs: Record<string, unknown> }>;
    }>;

    expect(content[0]!.marks[0]!.attrs).toEqual({
      href: "https://example.com/path",
      rel: "noopener noreferrer",
      target: "_blank",
    });
    expect(content[1]!.marks[0]!.attrs).toEqual({
      href: "http://example.com",
      rel: "noopener noreferrer",
    });
    expect(content[2]!.marks[0]!.attrs).toEqual({
      href: "mailto:hello@example.com",
      rel: "noopener noreferrer",
    });
    expect(content[3]!.marks[0]!.attrs).toEqual({
      href: "/trips/kyoto",
      rel: "noopener noreferrer",
    });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example.test/path",
    "/\\evil.example.test/path",
    "/safe\\path",
    "https://example.com/\nadmin",
  ])("removes a link mark with unsafe href %s", (href) => {
    const input = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [text("bad", [linkMark({ href }), { type: "bold" }])],
        },
      ],
    };

    const result = sanitizeContentJsonLinkMarks(input) as typeof input;
    const content = result.content[0]!.content as Array<{
      text: string;
      marks: Array<{ type: string }>;
    }>;

    expect(content[0]!.text).toBe("bad");
    expect(content[0]!.marks).toEqual([{ type: "bold" }]);
  });

  it("removes non-blank targets and marks without an href", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            text("self", [linkMark({ href: "https://example.com", target: "_self" })]),
            text("missing", [{ type: "link", attrs: { target: "_blank" } }]),
          ],
        },
      ],
    };

    const result = sanitizeContentJsonLinkMarks(input) as typeof input;
    const content = result.content[0]!.content as Array<{
      marks: Array<{ attrs?: Record<string, unknown> }>;
    }>;

    expect(content[0]!.marks[0]!.attrs).toEqual({
      href: "https://example.com",
      rel: "noopener noreferrer",
    });
    expect(content[1]!.marks).toEqual([]);
  });

  it("preserves document structure and does not mutate the input", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "https://media.example.test/photo.jpg",
            linkHref: "https://example.com/album",
            mediaId: "01942f30-1200-7000-8000-000000000701",
          },
        },
        {
          type: "gallery",
          attrs: { columns: 3 },
          content: [
            {
              type: "galleryImage",
              attrs: { src: "/media/one.jpg", caption: "One" },
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(input);

    const result = sanitizeContentJsonLinkMarks(input);

    expect(result).toEqual(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(result).not.toBe(input);
  });

  it("handles nested arrays and arbitrary JSON primitives", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            text("nested", [
              linkMark({
                href: "javascript:alert(1)",
                nested: [{ href: "https://example.com" }],
              }),
            ]),
          ],
        },
        {
          type: "paragraph",
          content: [text("text only", [])],
        },
      ],
      nullValue: null,
      numberValue: 42,
      booleanValue: true,
    };

    const result = sanitizeContentJsonLinkMarks(input);

    expect(result.nullValue).toBeNull();
    expect(result.numberValue).toBe(42);
    expect(result.booleanValue).toBe(true);
    expect(JSON.stringify(result)).not.toContain("javascript:");
  });

  it("does not copy prototype-polluting keys", () => {
    const input = JSON.parse(
      '{"type":"doc","__proto__":{"polluted":true},"constructor":"bad","content":[]}',
    ) as Record<string, unknown>;

    const result = sanitizeContentJsonLinkMarks(input);

    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
