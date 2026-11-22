import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JournalGallery, JournalGalleryImage } from "../journal-gallery";

const { fetchMedia } = vi.hoisted(() => ({
  fetchMedia: vi.fn(),
}));

vi.mock("@/lib/api/media", () => ({
  createCoverMediaClient: () => ({ fetchMedia }),
}));

const MEDIA_ID = "0193f6a0-7c00-7000-8000-000000000001";
const STALE_SRC = "https://media.example.test/stale.jpg";
const FRESH_SRC = "https://media.example.test/fresh.jpg";

const editors: Editor[] = [];

function galleryDoc(attrs: Record<string, unknown>): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "gallery",
        attrs: { columns: 3 },
        content: [{ type: "galleryImage", attrs }],
      },
    ],
  };
}

function makeEditor(content: JSONContent, editable = true): Editor {
  const editor = new Editor({
    extensions: [StarterKit, JournalGallery, JournalGalleryImage],
    content,
    editable,
  });
  editors.push(editor);
  return editor;
}

async function mountEditor(editor: Editor) {
  const result = render(<EditorContent editor={editor} />);

  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(
      result.container.querySelector('[data-node-view-wrapper][data-type="gallery-item"]'),
    ).not.toBeNull(),
  );

  return result;
}

function galleryImageNode(editor: Editor): JSONContent | null {
  return (editor.getJSON().content?.[0]?.content?.[0] as JSONContent | undefined) ?? null;
}

beforeEach(() => {
  fetchMedia.mockReset();
});

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("JournalGalleryImageNodeView", () => {
  it("renders the image attrs and caption without changing serialized HTML", async () => {
    const editor = makeEditor(
      galleryDoc({
        src: STALE_SRC,
        alt: "锦市场",
        title: "京都",
        caption: "锦市场的一碗热汤",
        width: 1200,
        height: 800,
        mediaId: MEDIA_ID,
      }),
    );
    const { container } = await mountEditor(editor);
    const figure = container.querySelector('figure[data-type="gallery-item"]');
    const image = figure?.querySelector("img");

    expect(image).toHaveAttribute("src", STALE_SRC);
    expect(image).toHaveAttribute("alt", "锦市场");
    expect(image).toHaveAttribute("title", "京都");
    expect(image).toHaveAttribute("width", "1200");
    expect(image).toHaveAttribute("height", "800");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveAttribute("data-media-id", MEDIA_ID);
    expect(figure?.querySelector("figcaption")).toHaveTextContent("锦市场的一碗热汤");

    const html = editor.getHTML();
    expect(html).toContain('figure data-type="gallery-item"');
    expect(html).toContain("<figcaption>锦市场的一碗热汤</figcaption>");
    expect(html).not.toContain("data-node-view-wrapper");
  });

  it("re-signs an expired src once through mediaId without adding history", async () => {
    fetchMedia.mockResolvedValue({
      url: FRESH_SRC,
      thumbUrl: null,
      width: 800,
      height: 600,
    });
    const editor = makeEditor(
      galleryDoc({
        src: STALE_SRC,
        alt: "鸭川",
        mediaId: MEDIA_ID,
      }),
    );
    const { container } = await mountEditor(editor);

    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    expect(fetchMedia).toHaveBeenCalledTimes(1);
    expect(fetchMedia).toHaveBeenCalledWith(MEDIA_ID, {
      signal: expect.any(AbortSignal),
    });

    await waitFor(() => {
      const image = container.querySelector('figure[data-type="gallery-item"] img');
      expect(image).toHaveAttribute("src", FRESH_SRC);
      expect(image).toHaveAttribute("width", "800");
      expect(image).toHaveAttribute("height", "600");
    });

    expect(galleryImageNode(editor)?.attrs).toMatchObject({
      src: FRESH_SRC,
      width: 800,
      height: 600,
      mediaId: MEDIA_ID,
    });
    expect(editor.getHTML()).toContain(`src="${FRESH_SRC}"`);
    expect(editor.can().undo()).toBe(false);
  });

  it("shows the placeholder without requesting media when mediaId is absent or invalid", async () => {
    const absent = makeEditor(galleryDoc({ src: STALE_SRC, alt: "旧图" }));
    const first = await mountEditor(absent);
    fireEvent.error(first.container.querySelector("img") as HTMLImageElement);

    const absentPlaceholder = await waitFor(() => {
      const placeholder = first.container.querySelector(
        '[role="img"][aria-label="图片加载失败：旧图"]',
      );
      expect(placeholder).not.toBeNull();
      return placeholder as HTMLElement;
    });
    expect(absentPlaceholder).toHaveTextContent("图片加载失败");
    expect(fetchMedia).not.toHaveBeenCalled();
    first.unmount();

    fetchMedia.mockReset();
    const invalid = makeEditor(
      galleryDoc({
        src: STALE_SRC,
        alt: "坏 mediaId",
        mediaId: "not-a-uuid",
      }),
    );
    const second = await mountEditor(invalid);
    fireEvent.error(second.container.querySelector("img") as HTMLImageElement);

    await waitFor(() =>
      expect(
        second.container.querySelector('[role="img"][aria-label="图片加载失败：坏 mediaId"]'),
      ).not.toBeNull(),
    );
    expect(fetchMedia).not.toHaveBeenCalled();
  });

  it("keeps the placeholder when the refreshed URL also fails", async () => {
    fetchMedia.mockResolvedValue({
      url: FRESH_SRC,
      thumbUrl: null,
      width: 800,
      height: 600,
    });
    const editor = makeEditor(galleryDoc({ src: STALE_SRC, alt: "鸭川", mediaId: MEDIA_ID }));
    const { container } = await mountEditor(editor);

    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", FRESH_SRC));

    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    await waitFor(() =>
      expect(
        container.querySelector('[role="img"][aria-label="图片加载失败：鸭川"]'),
      ).not.toBeNull(),
    );
    expect(fetchMedia).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a placeholder for an empty src without an image request", async () => {
    const editor = makeEditor(galleryDoc({ alt: "没有地址", mediaId: MEDIA_ID }));
    const { container } = await mountEditor(editor);

    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[role="img"][aria-label="图片加载失败：没有地址"]'),
    ).not.toBeNull();
    expect(fetchMedia).not.toHaveBeenCalled();
  });

  it("works in read-only mode", async () => {
    const editor = makeEditor(
      galleryDoc({
        src: STALE_SRC,
        alt: "只读图片",
        caption: "只读图注",
      }),
      false,
    );
    const { container } = await mountEditor(editor);

    expect(container.querySelector("img")).toHaveAttribute("src", STALE_SRC);
    expect(container.querySelector("figcaption")).toHaveTextContent("只读图注");
  });

  it("aborts the in-flight refresh when the node view unmounts", async () => {
    let aborted = false;
    fetchMedia.mockImplementation(
      (_mediaId: string, options: { signal?: AbortSignal } | undefined) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const editor = makeEditor(galleryDoc({ src: STALE_SRC, alt: "取消", mediaId: MEDIA_ID }));
    const { container, unmount } = await mountEditor(editor);

    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    await waitFor(() => expect(fetchMedia).toHaveBeenCalledTimes(1));

    unmount();
    await waitFor(() => expect(aborted).toBe(true));
  });
});
