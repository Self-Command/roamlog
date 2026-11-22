import { Editor, type Content } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { JournalImage } from "../journal-image";

const MEDIA_ID = "0193f6a0-7c00-7000-8000-000000000001";
const PHOTO_SRC = "https://media.example.test/photo.jpg";

const editors: Editor[] = [];

function makeEditor(content: Content): Editor {
  const editor = new Editor({
    extensions: [StarterKit, JournalImage],
    content,
    element: document.createElement("div"),
  });
  editors.push(editor);
  return editor;
}

function imageNode(editor: Editor) {
  return editor.getJSON().content?.find((node) => node.type === "image") ?? null;
}

function htmlDocument(editor: Editor): Document {
  return new DOMParser().parseFromString(editor.getHTML(), "text/html");
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("JournalImage", () => {
  it("parses legacy <img> content and renders the figure contract", () => {
    const editor = makeEditor(
      `<img src="${PHOTO_SRC}" alt="旧图" title="京都" width="480" height="320" data-media-id="${MEDIA_ID}">`,
    );
    const node = imageNode(editor);

    expect(node).not.toBeNull();
    expect(node?.attrs).toMatchObject({
      src: PHOTO_SRC,
      alt: "旧图",
      title: "京都",
      caption: null,
      alignment: null,
      displayWidth: 480,
      displayHeight: 320,
      linkHref: null,
      linkBlank: false,
      mediaId: MEDIA_ID,
    });

    const html = editor.getHTML();
    const figure = htmlDocument(editor).querySelector('figure[data-type="image"]');
    const img = figure?.querySelector("img");

    expect(html).toContain('<figure data-type="image">');
    expect(figure).not.toBeNull();
    expect(figure?.hasAttribute("data-align")).toBe(false);
    expect(figure?.querySelector("figcaption")).toBeNull();
    expect(img?.getAttribute("src")).toBe(PHOTO_SRC);
    expect(img?.getAttribute("alt")).toBe("旧图");
    expect(img?.getAttribute("title")).toBe("京都");
    expect(img?.getAttribute("width")).toBe("480");
    expect(img?.getAttribute("height")).toBe("320");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
    expect(img?.getAttribute("data-media-id")).toBe(MEDIA_ID);
    expect(html).not.toContain("class=");
    expect(html).not.toContain("style=");
  });

  it("round-trips a figure with caption, alignment, link and media id", () => {
    const editor = makeEditor(
      `<figure data-type="image" data-align="right">
        <a href="https://example.com/photo" target="_blank" rel="noopener noreferrer">
          <img src="/media/photo.jpg" alt="照片" title="标题" width="480" height="320" data-media-id="${MEDIA_ID}">
        </a>
        <figcaption>鸭川边的清晨</figcaption>
      </figure>`,
    );
    const node = imageNode(editor);

    expect(node?.attrs).toMatchObject({
      src: "/media/photo.jpg",
      alt: "照片",
      title: "标题",
      caption: "鸭川边的清晨",
      alignment: "right",
      displayWidth: 480,
      displayHeight: 320,
      linkHref: "https://example.com/photo",
      linkBlank: true,
      mediaId: MEDIA_ID,
    });

    const figure = htmlDocument(editor).querySelector('figure[data-type="image"]');
    const anchor = figure?.querySelector("a");
    const img = anchor?.querySelector("img");

    expect(figure?.getAttribute("data-align")).toBe("right");
    expect(figure?.querySelector("figcaption")?.textContent).toBe("鸭川边的清晨");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/photo");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(img?.getAttribute("src")).toBe("/media/photo.jpg");
    expect(img?.getAttribute("data-media-id")).toBe(MEDIA_ID);
  });

  it("omits figcaption and data-align when they are absent or invalid", () => {
    const editor = makeEditor(
      `<figure data-type="image" data-align="wide">
        <img src="${PHOTO_SRC}" alt="">
      </figure>`,
    );
    const node = imageNode(editor);
    const figure = htmlDocument(editor).querySelector('figure[data-type="image"]');
    const img = figure?.querySelector("img");

    expect(node?.attrs?.alignment).toBeNull();
    expect(figure?.hasAttribute("data-align")).toBe(false);
    expect(figure?.querySelector("figcaption")).toBeNull();
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("rejects dangerous image URLs and data URLs", () => {
    for (const src of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//evil.example/photo.jpg",
      "vbscript:msgbox(1)",
    ]) {
      const editor = makeEditor(`<img src="${src}" alt="bad">`);

      expect(imageNode(editor)).toBeNull();
      expect(editor.getHTML()).not.toContain(src);
    }
  });

  it("drops unsafe link URLs while keeping the image", () => {
    const editor = makeEditor(
      `<figure data-type="image">
        <a href="javascript:alert(1)" target="_blank">
          <img src="${PHOTO_SRC}" alt="照片">
        </a>
        <figcaption>照片</figcaption>
      </figure>`,
    );
    const node = imageNode(editor);
    const html = editor.getHTML();
    const figure = htmlDocument(editor).querySelector('figure[data-type="image"]');

    expect(node?.attrs?.linkHref).toBeNull();
    expect(node?.attrs?.linkBlank).toBe(false);
    expect(figure?.querySelector("a")).toBeNull();
    expect(html).not.toContain("javascript:");
  });

  it("drops unsafe attrs from JSON at render time", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "javascript:alert(1)",
            linkHref: "javascript:alert(2)",
            mediaId: "not-a-uuid",
          },
        },
      ],
    });
    const html = editor.getHTML();

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data-media-id");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
  });

  it("clamps display dimensions and ignores non-numeric values", () => {
    const clamped = makeEditor(`<img src="${PHOTO_SRC}" alt="clamped" width="50" height="3000">`);
    const clampedNode = imageNode(clamped);
    const clampedImg = htmlDocument(clamped).querySelector("img");

    expect(clampedNode?.attrs?.displayWidth).toBe(80);
    expect(clampedNode?.attrs?.displayHeight).toBe(2400);
    expect(clampedImg?.getAttribute("width")).toBe("80");
    expect(clampedImg?.getAttribute("height")).toBe("2400");

    const invalid = makeEditor(`<img src="${PHOTO_SRC}" alt="invalid" width="abc" height="">`);
    const invalidNode = imageNode(invalid);
    const invalidImg = htmlDocument(invalid).querySelector("img");

    expect(invalidNode?.attrs?.displayWidth).toBeNull();
    expect(invalidNode?.attrs?.displayHeight).toBeNull();
    expect(invalidImg?.hasAttribute("width")).toBe(false);
    expect(invalidImg?.hasAttribute("height")).toBe(false);
  });

  it("clamps dimensions supplied through JSON", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: PHOTO_SRC,
            displayWidth: 50,
            displayHeight: 9999,
          },
        },
      ],
    });
    const img = htmlDocument(editor).querySelector("img");

    expect(img?.getAttribute("width")).toBe("80");
    expect(img?.getAttribute("height")).toBe("2400");
  });

  it("keeps linkBlank true only when the source link opens a new tab", () => {
    const blank = makeEditor(
      `<figure data-type="image">
        <a href="https://example.com" target="_blank"><img src="${PHOTO_SRC}" alt="blank"></a>
      </figure>`,
    );
    const sameTab = makeEditor(
      `<figure data-type="image">
        <a href="https://example.com"><img src="${PHOTO_SRC}" alt="same"></a>
      </figure>`,
    );
    const mailto = makeEditor(
      `<figure data-type="image">
        <a href="mailto:hello@example.com"><img src="${PHOTO_SRC}" alt="mail"></a>
      </figure>`,
    );

    expect(imageNode(blank)?.attrs?.linkBlank).toBe(true);
    expect(htmlDocument(blank).querySelector("a")?.getAttribute("target")).toBe("_blank");
    expect(imageNode(sameTab)?.attrs?.linkBlank).toBe(false);
    expect(htmlDocument(sameTab).querySelector("a")?.hasAttribute("target")).toBe(false);
    expect(htmlDocument(sameTab).querySelector("a")?.getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(imageNode(mailto)?.attrs?.linkHref).toBe("mailto:hello@example.com");
  });

  it("uses defaults for legacy JSON that only has src", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "image", attrs: { src: PHOTO_SRC } }],
    });

    expect(imageNode(editor)?.attrs).toMatchObject({
      src: PHOTO_SRC,
      alt: "",
      title: null,
      caption: null,
      alignment: null,
      displayWidth: null,
      displayHeight: null,
      linkHref: null,
      linkBlank: false,
      mediaId: null,
    });
  });

  it("round-trips JSON through HTML and back without losing attributes", () => {
    const first = makeEditor({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: PHOTO_SRC,
            alt: "鸭川",
            title: "京都",
            caption: "清晨的鸭川",
            alignment: "center",
            displayWidth: 640,
            displayHeight: 480,
            linkHref: "/trips/kyoto",
            linkBlank: true,
            mediaId: MEDIA_ID,
          },
        },
      ],
    });
    const second = makeEditor(first.getHTML());

    expect(imageNode(second)?.attrs).toEqual(imageNode(first)?.attrs);
  });

  it("truncates alt, title and caption to the 280 character contract", () => {
    const long = "x".repeat(300);
    const editor = makeEditor(
      `<figure data-type="image">
        <img src="${PHOTO_SRC}" alt="${long}" title="${long}">
        <figcaption>${long}</figcaption>
      </figure>`,
    );
    const node = imageNode(editor);

    expect(node?.attrs?.alt).toHaveLength(280);
    expect(node?.attrs?.title).toHaveLength(280);
    expect(node?.attrs?.caption).toHaveLength(280);
  });
});
