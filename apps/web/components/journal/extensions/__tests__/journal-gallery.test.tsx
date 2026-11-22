import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import {
  clampGalleryColumns,
  galleryImagesFromNode,
  JournalGallery,
  JournalGalleryImage,
} from "../journal-gallery";

const MEDIA_ID = "0193f6a0-7c00-7000-8000-000000000001";
const editors: Editor[] = [];

function makeEditor(content?: JSONContent | string): Editor {
  const editor = new Editor({
    extensions: [StarterKit, JournalGallery, JournalGalleryImage],
    content,
    element: document.createElement("div"),
  });
  editors.push(editor);
  return editor;
}

function galleryDoc(columns: number, images: Array<Record<string, unknown>>): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "gallery",
        attrs: { columns },
        content: images.map((attrs) => ({ type: "galleryImage", attrs })),
      },
    ],
  };
}

function galleryHtml(columns: string | null, images: string, attributes = ""): string {
  const columnAttribute = columns === null ? "" : ` data-columns="${columns}"`;
  return `<div data-type="gallery"${columnAttribute}${attributes}>${images}</div>`;
}

function imageHtml(attributes: string): string {
  return `<figure data-type="gallery-item"><img src="/media/photo.jpg" ${attributes}></figure>`;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("clampGalleryColumns", () => {
  it("keeps only integers from 1 through 6 and falls back to 3", () => {
    expect(clampGalleryColumns(1)).toBe(1);
    expect(clampGalleryColumns("6")).toBe(6);
    expect(clampGalleryColumns(0)).toBe(3);
    expect(clampGalleryColumns(7)).toBe(3);
    expect(clampGalleryColumns(3.5)).toBe(3);
    expect(clampGalleryColumns("not-a-number")).toBe(3);
  });
});

describe("gallery schema", () => {
  it.each([1, 3, 6])("round-trips %i columns", (columns) => {
    const editor = makeEditor(galleryDoc(columns, [{ src: "/media/photo.jpg", alt: "鸭川" }]));

    expect(editor.getJSON().content?.[0]?.attrs?.columns).toBe(columns);

    const html = editor.getHTML();
    expect(html).toContain(`data-columns="${columns}"`);

    const reparsed = makeEditor(html);
    expect(reparsed.getJSON().content?.[0]?.attrs?.columns).toBe(columns);
    expect(reparsed.getHTML()).toBe(html);
  });

  it("falls back to 3 columns for invalid HTML and JSON values", () => {
    const fromHtml = makeEditor(galleryHtml("9", imageHtml('alt="鸭川"')));
    expect(fromHtml.getJSON().content?.[0]?.attrs?.columns).toBe(3);

    const fromJson = makeEditor(galleryDoc(9, [{ src: "/media/photo.jpg" }]));
    expect(fromJson.getHTML()).toContain('data-columns="3"');
  });

  it("does not parse an empty gallery", () => {
    const editor = makeEditor(galleryHtml("3", ""));

    expect(editor.getJSON().content ?? []).not.toContainEqual(
      expect.objectContaining({ type: "gallery" }),
    );
  });

  it("declares the gallery and image schema constraints", () => {
    const editor = makeEditor();
    const gallery = editor.schema.nodes.gallery!;
    const galleryImage = editor.schema.nodes.galleryImage!;

    expect(gallery.spec.group).toBe("block");
    expect(gallery.spec.content).toBe("galleryImage+");
    expect(gallery.spec.isolating).toBe(true);
    expect(gallery.spec.defining).toBe(true);
    expect(gallery.spec.draggable).toBe(true);
    expect(galleryImage.spec.atom).toBe(true);
    expect(galleryImage.spec.selectable).toBe(true);
    expect(galleryImage.spec.draggable).toBe(false);
  });

  it("parses direct gallery children and their image metadata", () => {
    const editor = makeEditor(
      galleryHtml(
        "3",
        `<figure data-type="gallery-item">
          <img
            src="https://media.example/a.jpg"
            alt="锦市场"
            title="京都"
            width="1200"
            height="800"
            data-media-id="${MEDIA_ID}"
          >
          <figcaption>锦市场的一碗热汤</figcaption>
        </figure>`,
      ),
    );

    const gallery = editor.getJSON().content?.[0];
    expect(gallery?.content?.[0]).toMatchObject({
      type: "galleryImage",
      attrs: {
        src: "https://media.example/a.jpg",
        alt: "锦市场",
        title: "京都",
        caption: "锦市场的一碗热汤",
        width: 1200,
        height: 800,
        mediaId: MEDIA_ID,
      },
    });
  });

  it("rejects malicious image sources and invalid media ids", () => {
    const fromHtml = makeEditor(
      galleryHtml(
        "3",
        `<figure data-type="gallery-item">
          <img src="javascript:alert(1)" data-media-id="not-a-uuid">
        </figure>`,
      ),
    );
    expect(fromHtml.getJSON().content ?? []).not.toContainEqual(
      expect.objectContaining({ type: "gallery" }),
    );

    const fromJson = makeEditor(
      galleryDoc(3, [
        {
          src: "javascript:alert(1)",
          mediaId: "not-a-uuid",
        },
      ]),
    );
    const html = fromJson.getHTML();
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data-media-id");
    expect(html).toContain('data-type="gallery-item"');
  });

  it("allows same-site paths and http(s) sources", () => {
    const editor = makeEditor(
      galleryHtml(
        "3",
        `<figure data-type="gallery-item"><img src="/media/a.jpg"></figure>
         <figure data-type="gallery-item"><img src="http://media.example/b.jpg"></figure>
         <figure data-type="gallery-item"><img src="https://media.example/c.jpg"></figure>`,
      ),
    );

    const images = galleryImagesFromNode(editor.state.doc.firstChild);
    expect(images.map((image) => image.src)).toEqual([
      "/media/a.jpg",
      "http://media.example/b.jpg",
      "https://media.example/c.jpg",
    ]);
  });

  it("caps alt and caption text at 280 characters", () => {
    const longText = "x".repeat(300);
    const editor = makeEditor(
      galleryHtml(
        "3",
        `<figure data-type="gallery-item">
          <img src="/media/photo.jpg" alt="${longText}">
          <figcaption>${longText}</figcaption>
        </figure>`,
      ),
    );

    const attrs = (editor.getJSON() as JSONContent).content?.[0]?.content?.[0]?.attrs;
    expect(attrs?.alt).toHaveLength(280);
    expect(attrs?.caption).toHaveLength(280);
  });

  it("round-trips HTML to JSON to HTML without classes or styles", () => {
    const html = galleryHtml(
      "3",
      `<figure data-type="gallery-item" class="bad" style="color: red">
        <img
          src="/media/photo.jpg"
          alt="南禅寺"
          width="1200"
          height="800"
          loading="lazy"
          decoding="async"
          data-media-id="${MEDIA_ID}"
          class="bad"
          style="color: red"
        >
        <figcaption>南禅寺的一碗热汤</figcaption>
      </figure>`,
      ' class="bad" style="color: red"',
    );

    const editor = makeEditor(html);
    const json = editor.getJSON();
    const rendered = makeEditor(json).getHTML();

    expect(json.content?.[0]).toMatchObject({
      type: "gallery",
      attrs: { columns: 3 },
    });
    expect(rendered).toContain('<div data-type="gallery" data-columns="3">');
    expect(rendered).toContain('<figure data-type="gallery-item">');
    expect(rendered).toContain("<figcaption>南禅寺的一碗热汤</figcaption>");
    expect(rendered).toContain('loading="lazy"');
    expect(rendered).toContain('decoding="async"');
    expect(rendered).toContain(`data-media-id="${MEDIA_ID}"`);
    expect(rendered).not.toContain("class=");
    expect(rendered).not.toContain("style=");
  });

  it("applies JSON default attrs", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "gallery",
          content: [
            {
              type: "galleryImage",
              attrs: { src: "/media/photo.jpg" },
            },
          ],
        },
      ],
    });

    const gallery = (editor.getJSON() as JSONContent).content?.[0];
    expect(gallery?.attrs).toMatchObject({ columns: 3 });
    expect(gallery?.content?.[0]?.attrs).toMatchObject({
      src: "/media/photo.jpg",
      alt: "",
      title: null,
      caption: null,
      width: null,
      height: null,
      mediaId: null,
    });
  });

  it("does not parse gallery items outside a direct gallery parent", () => {
    const editor = makeEditor(
      `<div data-type="gallery">
        <div>${imageHtml('alt="nested"')}</div>
      </div>`,
    );

    expect(editor.getJSON().content ?? []).not.toContainEqual(
      expect.objectContaining({ type: "gallery" }),
    );
  });
});
