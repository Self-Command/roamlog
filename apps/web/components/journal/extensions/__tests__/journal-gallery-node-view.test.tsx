import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clampGalleryColumns,
  JournalGallery,
  JournalGalleryImage,
  type JournalGalleryOptions,
  type JournalGalleryUploadImage,
} from "../journal-gallery";

vi.mock("@/components/media/photo-lightbox", async () => {
  const React = await import("react");

  return {
    PhotoLightbox: ({
      open,
      index,
      items,
      onClose,
    }: {
      open: boolean;
      index: number;
      items: Array<{ id: string; src: string; alt: string }>;
      onClose: () => void;
    }) =>
      open
        ? React.createElement(
            "div",
            {
              role: "dialog",
              "aria-label": "照片查看",
              "data-index": index,
              "data-count": items.length,
            },
            items.map((item) => React.createElement("span", { key: item.id }, item.alt)),
            React.createElement("button", { type: "button", onClick: onClose }, "关闭测试灯箱"),
          )
        : null,
  };
});

const MEDIA_ID = "0193f6a0-7c00-7000-8000-000000000001";
const editors: Editor[] = [];

function makeEditor(
  content: JSONContent,
  editable = true,
  options: JournalGalleryOptions = {},
): Editor {
  const editor = new Editor({
    extensions: [StarterKit, JournalGallery.configure(options), JournalGalleryImage],
    content,
    editable,
  });
  editors.push(editor);
  return editor;
}

function galleryDoc(columns: unknown, images: Array<Record<string, unknown>>): JSONContent {
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

async function mountEditor(editor: Editor) {
  const result = render(<EditorContent editor={editor} />);

  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(result.container.querySelector(".node-gallery")).not.toBeNull());

  return result;
}

async function openGallerySettings(
  editor: Editor,
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  act(() => {
    editor.commands.setNodeSelection(0);
  });

  const trigger = await screen.findByRole("button", { name: "图库设置" });
  await user.click(trigger);

  return screen.findByRole("dialog", { name: "图库设置" });
}

function galleryImageNodes(editor: Editor): JSONContent[] {
  return editor.getJSON().content?.[0]?.content ?? [];
}

function galleryImageAlts(editor: Editor): unknown[] {
  return galleryImageNodes(editor).map((image) => image.attrs?.alt);
}

function galleryFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]');
  if (!input) throw new Error("expected the gallery file picker to render");
  return input;
}

function uploadedFile(name: string): File {
  return new File(["photo"], name, { type: "image/png" });
}

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("JournalGalleryNodeView", () => {
  it("renders the existing gallery figures inside a responsive grid", async () => {
    const editor = makeEditor(
      galleryDoc(6, [{ src: "/media/photo.jpg", alt: "鸭川", caption: "清晨的鸭川" }]),
    );
    const { container } = await mountEditor(editor);
    const content = container.querySelector("[data-node-view-content]");
    const wrapper = container.querySelector('[data-node-view-wrapper][data-type="gallery"]');

    expect(container.querySelector(".node-gallery")).not.toBeNull();
    expect(wrapper).not.toBeNull();
    expect(content).toHaveClass("grid", "gap-2", "grid-cols-2", "min-[641px]:grid-cols-6");
    expect(content).toHaveClass("[&>[data-node-view-content-react]]:contents");
    expect(container.querySelectorAll('figure[data-type="gallery-item"]')).toHaveLength(1);
  });

  it.each([
    [1, "grid-cols-1", null],
    [3, "grid-cols-2", "min-[641px]:grid-cols-3"],
    [6, "grid-cols-2", "min-[641px]:grid-cols-6"],
    [0, "grid-cols-2", "min-[641px]:grid-cols-3"],
    [99, "grid-cols-2", "min-[641px]:grid-cols-3"],
    ["not-a-number", "grid-cols-2", "min-[641px]:grid-cols-3"],
  ])(
    "uses the clamped columns value %j for the grid",
    async (columns, mobileClass, desktopClass) => {
      const editor = makeEditor(galleryDoc(columns, [{ src: "/media/photo.jpg" }]));
      const { container } = await mountEditor(editor);
      const content = container.querySelector("[data-node-view-content]");
      const wrapper = container.querySelector('[data-node-view-wrapper][data-type="gallery"]');

      expect(content).toHaveClass(mobileClass);
      if (desktopClass) {
        expect(content).toHaveClass(desktopClass);
      } else {
        expect(content).not.toHaveClass("min-[641px]:grid-cols-3");
      }
      expect(wrapper).toHaveAttribute("data-columns", String(clampGalleryColumns(columns)));
    },
  );

  it("renders per-image captions, omits empty captions, and accepts images without mediaId", async () => {
    const editor = makeEditor(
      galleryDoc(3, [
        {
          src: "/media/market.jpg",
          alt: "锦市场",
          caption: "锦市场的一碗热汤",
          mediaId: MEDIA_ID,
        },
        { src: "/media/temple.jpg", alt: "南禅寺" },
      ]),
    );
    const { container } = await mountEditor(editor);
    const figures = container.querySelectorAll('figure[data-type="gallery-item"]');

    expect(figures).toHaveLength(2);
    expect(figures[0]?.querySelector("figcaption")?.textContent).toBe("锦市场的一碗热汤");
    expect(figures[1]?.querySelector("figcaption")).toBeNull();
    expect(figures[0]?.querySelector("img")?.getAttribute("data-media-id")).toBe(MEDIA_ID);
    expect(figures[1]?.querySelector("img")?.hasAttribute("data-media-id")).toBe(false);
    expect(figures[1]?.querySelector("img")?.getAttribute("alt")).toBe("南禅寺");
  });

  it("hides editor chrome when the document is read-only", async () => {
    const editor = makeEditor(galleryDoc(3, [{ src: "/media/photo.jpg" }]), false);
    const { container } = await mountEditor(editor);

    act(() => {
      editor.commands.setNodeSelection(0);
    });

    await waitFor(() =>
      expect(
        container.querySelector('[data-node-view-wrapper][data-type="gallery"]'),
      ).toHaveAttribute("data-selected", "false"),
    );
    expect(screen.queryByRole("toolbar", { name: "图库工具" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除图库" })).toBeNull();
    expect(screen.queryByRole("button", { name: "图库设置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "3 列" })).toBeNull();
    expect(container.querySelectorAll('figure[data-type="gallery-item"]')).toHaveLength(1);
  });

  it("shows the toolbar only while selected and deletes the whole gallery with undo support", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(
      galleryDoc(3, [
        { src: "/media/a.jpg", alt: "A" },
        { src: "/media/b.jpg", alt: "B" },
      ]),
    );
    const { container } = await mountEditor(editor);

    expect(screen.queryByRole("toolbar", { name: "图库工具" })).toBeNull();

    act(() => {
      editor.commands.setNodeSelection(0);
    });

    const wrapper = await waitFor(() => {
      const element = container.querySelector('[data-node-view-wrapper][data-type="gallery"]');
      expect(element).toHaveAttribute("data-selected", "true");
      return element as HTMLElement;
    });
    expect(wrapper).toHaveClass("border-hairline-strong");

    const button = await screen.findByRole("button", { name: "删除图库" });
    expect(button).toHaveClass("focus-visible:ring-2");
    button.focus();
    expect(button).toHaveFocus();

    await user.click(button);

    await waitFor(() => expect(container.querySelector(".node-gallery")).toBeNull());
    expect(editor.getJSON().content ?? []).not.toContainEqual(
      expect.objectContaining({ type: "gallery" }),
    );

    act(() => {
      editor.commands.undo();
    });

    await waitFor(() => expect(container.querySelector(".node-gallery")).not.toBeNull());
    expect(container.querySelectorAll('figure[data-type="gallery-item"]')).toHaveLength(2);
  });

  it("selects the gallery node when an image is clicked", async () => {
    const editor = makeEditor(galleryDoc(3, [{ src: "/media/photo.jpg", alt: "鸭川" }]));
    const { container } = await mountEditor(editor);
    const image = await waitFor(() => {
      const element = container.querySelector('figure[data-type="gallery-item"] img');
      expect(element).not.toBeNull();
      return element as HTMLImageElement;
    });

    fireEvent.click(image);

    await waitFor(() => {
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      expect((editor.state.selection as NodeSelection).node.type.name).toBe("gallery");
    });
    expect(await screen.findByRole("button", { name: "删除图库" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "照片查看" })).toBeNull();
  });

  it("previews the whole gallery from the selected toolbar", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(
      galleryDoc(3, [
        { src: "/media/a.jpg", alt: "鸭川", caption: "清晨的鸭川" },
        { src: "/media/b.jpg", alt: "" },
        { src: "/media/c.jpg", alt: "南禅寺" },
      ]),
    );
    await mountEditor(editor);

    act(() => {
      editor.commands.setNodeSelection(0);
    });
    const before = editor.getHTML();

    await user.click(await screen.findByRole("button", { name: "预览图库" }));

    const dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(dialog).toHaveAttribute("data-index", "0");
    expect(dialog).toHaveAttribute("data-count", "3");
    expect(within(dialog).getByText("鸭川")).toBeInTheDocument();
    expect(within(dialog).getByText("南禅寺")).toBeInTheDocument();
    expect(editor.getHTML()).toBe(before);

    await user.click(within(dialog).getByRole("button", { name: "关闭测试灯箱" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "照片查看" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "预览图库" })).toHaveFocus());
  });

  it("scopes the Escape listener to the open preview without window globals", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(
      galleryDoc(3, [
        { src: "/media/a.jpg", alt: "鸭川" },
        { src: "/media/b.jpg", alt: "南禅寺" },
      ]),
    );
    await mountEditor(editor);

    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");

    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await user.click(await screen.findByRole("button", { name: "预览图库" }));
    expect(await screen.findByRole("dialog", { name: "照片查看" })).toBeInTheDocument();

    const added = addListener.mock.calls.find(
      ([type, , capture]) => type === "keydown" && capture === true,
    );
    expect(added).toBeTruthy();
    expect(
      (window as Window & { __roamlogGalleryPreviewEscape?: unknown })
        .__roamlogGalleryPreviewEscape,
    ).toBeUndefined();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "照片查看" })).toBeNull());
    expect(
      removeListener.mock.calls.some(
        ([type, handler, capture]) =>
          type === "keydown" && handler === added?.[1] && capture === true,
      ),
    ).toBe(true);

    addListener.mockRestore();
    removeListener.mockRestore();
  });

  it("restores gallery selection and preview focus after the selection was lost", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(
      galleryDoc(3, [
        { src: "/media/a.jpg", alt: "鸭川" },
        { src: "/media/b.jpg", alt: "南禅寺" },
      ]),
    );
    await mountEditor(editor);

    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await user.click(await screen.findByRole("button", { name: "预览图库" }));
    expect(await screen.findByRole("dialog", { name: "照片查看" })).toBeInTheDocument();

    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size);
    });
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "图库工具" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "关闭测试灯箱" }));

    const restoredPreview = await screen.findByRole("button", { name: "预览图库" });
    await waitFor(() => expect(restoredPreview).toHaveFocus());
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe("gallery");
  });

  it("opens a read-only gallery at the clicked image and restores focus", async () => {
    const editor = makeEditor(
      galleryDoc(3, [
        { src: "/media/a.jpg", alt: "鸭川" },
        { src: "/media/b.jpg", alt: "", caption: "南禅寺的清晨" },
      ]),
      false,
    );
    const { container } = await mountEditor(editor);
    const images = container.querySelectorAll<HTMLImageElement>(
      'figure[data-type="gallery-item"] img',
    );

    fireEvent.click(images[1] as HTMLImageElement);

    const dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(dialog).toHaveAttribute("data-index", "1");
    expect(dialog).toHaveAttribute("data-count", "2");
    expect(within(dialog).getByText("南禅寺的清晨")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭测试灯箱" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "照片查看" })).toBeNull());
    await waitFor(() => expect(images[1]).toHaveFocus());
  });

  it("skips invalid sources while preserving the clicked gallery order", async () => {
    const editor = makeEditor(
      galleryDoc(3, [
        { src: "javascript:alert(1)", alt: "坏图" },
        { src: "/media/b.jpg", alt: "鸭川" },
        { src: "/media/c.jpg", alt: "南禅寺" },
      ]),
      false,
    );
    const { container } = await mountEditor(editor);
    const thirdImage = container.querySelectorAll<HTMLImageElement>(
      'figure[data-type="gallery-item"] img',
    )[1];

    fireEvent.click(thirdImage as HTMLImageElement);

    const dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(dialog).toHaveAttribute("data-index", "1");
    expect(dialog).toHaveAttribute("data-count", "2");
  });

  it("opens gallery settings in a popover and closes it with Escape", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(
      galleryDoc(3, [
        { src: "/media/a.jpg", alt: "A" },
        { src: "/media/b.jpg", alt: "B" },
      ]),
    );
    await mountEditor(editor);

    act(() => {
      editor.commands.setNodeSelection(0);
    });

    const trigger = await screen.findByRole("button", { name: "图库设置" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const panel = await screen.findByRole("dialog", { name: "图库设置" });
    expect(panel).toHaveClass("max-w-[calc(100vw_-_24px)]");
    expect(within(panel).getByText("2 张图片")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "图库设置" })).toBeNull());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes gallery settings when the gallery is deselected and does not reopen on reselect", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "gallery",
          attrs: { columns: 3 },
          content: [
            {
              type: "galleryImage",
              attrs: { src: "/media/a.jpg", alt: "A" },
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "after" }],
        },
      ],
    });
    await mountEditor(editor);

    act(() => {
      editor.commands.setNodeSelection(0);
    });
    const trigger = await screen.findByRole("button", { name: "图库设置" });
    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "图库设置" })).toBeInTheDocument();

    let textPosition: number | null = null;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === "after") {
        textPosition = position;
        return false;
      }
      return true;
    });
    expect(textPosition).not.toBeNull();
    act(() => {
      editor.commands.setTextSelection(textPosition as number);
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "图库设置" })).toBeNull());

    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await screen.findByRole("button", { name: "图库设置" });
    expect(screen.queryByRole("dialog", { name: "图库设置" })).toBeNull();
  });

  it("updates gallery columns from the toolbar with aria-pressed and undo support", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(galleryDoc(3, [{ src: "/media/a.jpg" }]));
    const { container } = await mountEditor(editor);

    act(() => {
      editor.commands.setNodeSelection(0);
    });

    const fiveColumns = await screen.findByRole("button", { name: "5 列" });
    expect(screen.getByRole("button", { name: "3 列" })).toHaveAttribute("aria-pressed", "true");

    await user.click(fiveColumns);

    await waitFor(() => {
      expect(editor.getJSON().content?.[0]?.attrs?.columns).toBe(5);
      expect(
        container.querySelector('[data-node-view-wrapper][data-type="gallery"]'),
      ).toHaveAttribute("data-columns", "5");
    });
    expect(screen.getByRole("button", { name: "5 列" })).toHaveAttribute("aria-pressed", "true");

    act(() => {
      editor.commands.undo();
    });

    await waitFor(() => {
      expect(editor.getJSON().content?.[0]?.attrs?.columns).toBe(3);
      expect(
        container.querySelector('[data-node-view-wrapper][data-type="gallery"]'),
      ).toHaveAttribute("data-columns", "3");
    });

    act(() => {
      editor.commands.redo();
    });

    await waitFor(() => {
      expect(editor.getJSON().content?.[0]?.attrs?.columns).toBe(5);
      expect(
        container.querySelector('[data-node-view-wrapper][data-type="gallery"]'),
      ).toHaveAttribute("data-columns", "5");
    });
  });

  it("updates alt and caption through galleryImage transactions", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(
      galleryDoc(3, [{ src: "/media/a.jpg", alt: "A", caption: "旧说明" }]),
    );
    const { container } = await mountEditor(editor);
    await openGallerySettings(editor, user);

    const altInput = screen.getByRole("textbox", { name: "第 1 张图片的替代文本" });
    await user.clear(altInput);
    await user.type(altInput, "河原町 清晨");

    await waitFor(() => {
      expect(galleryImageNodes(editor)[0]?.attrs?.alt).toBe("河原町 清晨");
      expect(container.querySelector('figure[data-type="gallery-item"] img')).toHaveAttribute(
        "alt",
        "河原町 清晨",
      );
    });
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe("gallery");

    const captionInput = screen.getByRole("textbox", { name: "第 1 张图片的说明" });
    await user.clear(captionInput);
    await user.type(captionInput, "夜晚 的街角");

    await waitFor(() => {
      expect(galleryImageNodes(editor)[0]?.attrs?.caption).toBe("夜晚 的街角");
      expect(container.querySelector("figcaption")).toHaveTextContent("夜晚 的街角");
    });
    expect(screen.getByRole("dialog", { name: "图库设置" })).toBeInTheDocument();
    expect(captionInput).toHaveFocus();

    await user.clear(captionInput);

    await waitFor(() => {
      expect(galleryImageNodes(editor)[0]?.attrs?.caption).toBeNull();
      expect(container.querySelector("figcaption")).toBeNull();
    });
  });

  it("moves images up and down while keeping DOM and JSON order aligned", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(
      galleryDoc(3, [
        { src: "/media/a.jpg", alt: "A" },
        { src: "/media/b.jpg", alt: "B" },
        { src: "/media/c.jpg", alt: "C" },
      ]),
    );
    const { container } = await mountEditor(editor);
    await openGallerySettings(editor, user);

    expect(screen.getByRole("button", { name: "上移第 1 张图片" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移第 3 张图片" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "下移第 1 张图片" }));

    await waitFor(() => {
      expect(galleryImageAlts(editor)).toEqual(["B", "A", "C"]);
      expect(
        Array.from(container.querySelectorAll('figure[data-type="gallery-item"] img')).map(
          (image) => image.getAttribute("alt"),
        ),
      ).toEqual(["B", "A", "C"]);
    });
    expect(screen.getByRole("button", { name: "上移第 1 张图片" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上移第 2 张图片" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "上移第 2 张图片" }));

    await waitFor(() => {
      expect(galleryImageAlts(editor)).toEqual(["A", "B", "C"]);
      expect(
        Array.from(container.querySelectorAll('figure[data-type="gallery-item"] img')).map(
          (image) => image.getAttribute("alt"),
        ),
      ).toEqual(["A", "B", "C"]);
    });
  });

  it("removes a single image and keeps the remaining images", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(
      galleryDoc(3, [
        { src: "/media/a.jpg", alt: "A" },
        { src: "/media/b.jpg", alt: "B" },
      ]),
    );
    const { container } = await mountEditor(editor);
    await openGallerySettings(editor, user);

    await user.click(screen.getByRole("button", { name: "删除第 1 张图片" }));

    await waitFor(() => {
      expect(galleryImageAlts(editor)).toEqual(["B"]);
      expect(container.querySelectorAll('figure[data-type="gallery-item"]')).toHaveLength(1);
      expect(container.querySelector('figure[data-type="gallery-item"] img')).toHaveAttribute(
        "alt",
        "B",
      );
    });

    act(() => {
      editor.commands.undo();
    });

    await waitFor(() => {
      expect(galleryImageAlts(editor)).toEqual(["A", "B"]);
      expect(container.querySelectorAll('figure[data-type="gallery-item"]')).toHaveLength(2);
    });
  });

  it("deletes the whole gallery with the last image and restores it with undo", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(galleryDoc(3, [{ src: "/media/a.jpg", alt: "A" }]));
    const { container } = await mountEditor(editor);
    await openGallerySettings(editor, user);

    await user.click(screen.getByRole("button", { name: "删除第 1 张图片" }));

    await waitFor(() => expect(container.querySelector(".node-gallery")).toBeNull());
    expect(editor.getJSON().content ?? []).not.toContainEqual(
      expect.objectContaining({ type: "gallery" }),
    );

    act(() => {
      editor.commands.undo();
    });

    await waitFor(() => {
      expect(container.querySelector(".node-gallery")).not.toBeNull();
      expect(container.querySelectorAll('figure[data-type="gallery-item"]')).toHaveLength(1);
    });
  });

  it("appends multiple uploaded images to the current gallery with undo support", async () => {
    const user = userEvent.setup();
    let resolveUpload!: (images: JournalGalleryUploadImage[]) => void;
    const uploadImages = vi.fn(
      (_files: File[], _signal: AbortSignal) =>
        new Promise<JournalGalleryUploadImage[]>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const editor = makeEditor(galleryDoc(3, [{ src: "/media/a.jpg", alt: "A" }]), true, {
      uploadImages,
    });
    const { container } = await mountEditor(editor);

    act(() => {
      editor.commands.setNodeSelection(0);
    });

    const addButton = await screen.findByRole("button", { name: "添加图片" });
    const input = galleryFileInput(container);
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {
      fireEvent.change(input, {
        target: { files: [uploadedFile("one.png"), uploadedFile("two.png")] },
      });
    });
    await user.click(addButton);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(uploadImages).toHaveBeenCalledTimes(1);
    expect(uploadImages.mock.calls[0]?.[0]).toHaveLength(2);

    expect(await screen.findByRole("status")).toHaveTextContent("正在上传 2 张图片…");
    expect(screen.getByRole("button", { name: "正在上传 2 张图片…" })).toBeDisabled();

    resolveUpload([
      {
        src: "/media/one.jpg",
        mediaId: "0193f6a0-7c00-7000-8000-000000000001",
        alt: "one.png",
        width: 640,
        height: 480,
      },
      {
        src: "/media/two.jpg",
        mediaId: "0193f6a0-7c00-7000-8000-000000000002",
        alt: "two.png",
      },
    ]);

    await waitFor(() => {
      expect(galleryImageNodes(editor)).toHaveLength(3);
      expect(galleryImageAlts(editor)).toEqual(["A", "one.png", "two.png"]);
    });
    expect(
      Array.from(container.querySelectorAll('figure[data-type="gallery-item"] img')).map((image) =>
        image.getAttribute("data-media-id"),
      ),
    ).toEqual([
      null,
      "0193f6a0-7c00-7000-8000-000000000001",
      "0193f6a0-7c00-7000-8000-000000000002",
    ]);
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => {
      editor.commands.undo();
    });

    await waitFor(() => {
      expect(galleryImageNodes(editor)).toHaveLength(1);
      expect(container.querySelectorAll('figure[data-type="gallery-item"]')).toHaveLength(1);
    });
  });

  it("shows an alert and leaves the gallery unchanged when adding images fails", async () => {
    const user = userEvent.setup();
    const uploadImages = vi.fn(async () => {
      throw new Error("图片处理失败，请重试。");
    });
    const editor = makeEditor(galleryDoc(3, [{ src: "/media/a.jpg", alt: "A" }]), true, {
      uploadImages,
    });
    const { container } = await mountEditor(editor);

    act(() => {
      editor.commands.setNodeSelection(0);
    });

    const addButton = await screen.findByRole("button", { name: "添加图片" });
    const input = galleryFileInput(container);
    vi.spyOn(input, "click").mockImplementation(() => {
      fireEvent.change(input, {
        target: { files: [uploadedFile("one.png"), uploadedFile("two.png")] },
      });
    });
    await user.click(addButton);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("图片处理失败，请重试。");
    expect(galleryImageNodes(editor)).toHaveLength(1);
    expect(galleryImageAlts(editor)).toEqual(["A"]);
    expect(container.querySelectorAll('figure[data-type="gallery-item"]')).toHaveLength(1);
  });

  it("aborts an in-flight add when the node view unmounts", async () => {
    const user = userEvent.setup();
    let resolveUpload!: (images: JournalGalleryUploadImage[]) => void;
    let uploadSignal: AbortSignal | undefined;
    const uploadImages = vi.fn(
      (_files: File[], signal: AbortSignal) =>
        new Promise<JournalGalleryUploadImage[]>((resolve) => {
          uploadSignal = signal;
          resolveUpload = resolve;
        }),
    );
    const editor = makeEditor(galleryDoc(3, [{ src: "/media/a.jpg", alt: "A" }]), true, {
      uploadImages,
    });
    const result = await mountEditor(editor);

    act(() => {
      editor.commands.setNodeSelection(0);
    });
    const dispatchSpy = vi.spyOn(editor.view, "dispatch");

    const addButton = await screen.findByRole("button", { name: "添加图片" });
    const input = galleryFileInput(result.container);
    vi.spyOn(input, "click").mockImplementation(() => {
      fireEvent.change(input, {
        target: { files: [uploadedFile("one.png"), uploadedFile("two.png")] },
      });
    });
    await user.click(addButton);
    await waitFor(() => expect(uploadImages).toHaveBeenCalledTimes(1));
    expect(uploadSignal?.aborted).toBe(false);

    result.unmount();
    expect(uploadSignal?.aborted).toBe(true);

    resolveUpload([
      {
        src: "/media/one.jpg",
        mediaId: "0193f6a0-7c00-7000-8000-000000000001",
        alt: "one.png",
      },
    ]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(galleryImageNodes(editor)).toHaveLength(1);
  });
});
