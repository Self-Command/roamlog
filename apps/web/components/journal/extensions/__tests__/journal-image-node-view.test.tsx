import { Editor, type Content } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JournalImage, type JournalImageUpload } from "../journal-image";

const { fetchMedia } = vi.hoisted(() => ({
  fetchMedia: vi.fn(),
}));

vi.mock("@/lib/api/media", () => ({
  COVER_ACCEPT_ATTRIBUTE: "image/png",
  createCoverMediaClient: () => ({ fetchMedia }),
  isSignedUrlUploadError: () => false,
}));

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
      items: Array<{
        id: string;
        src: string;
        alt: string;
        width?: number | null;
        height?: number | null;
      }>;
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
              "data-first-src": items[0]?.src ?? "",
              "data-first-width": items[0]?.width ?? "",
              "data-first-height": items[0]?.height ?? "",
            },
            items.map((item) => React.createElement("span", { key: item.id }, item.alt)),
            React.createElement("button", { type: "button", onClick: onClose }, "关闭测试灯箱"),
          )
        : null,
  };
});

const MEDIA_ID = "0193f6a0-7c00-7000-8000-000000000001";
const REPLACEMENT_MEDIA_ID = "0193f6a0-7c00-7000-8000-000000000002";
const STALE_SRC = "https://media.example.test/stale.jpg";
const FRESH_SRC = "https://media.example.test/fresh.jpg";

const IMAGE_HTML = `<figure data-type="image" data-align="right">
  <img src="${STALE_SRC}" alt="晨雾中的鸭川" title="京都" width="480" height="320" data-media-id="${MEDIA_ID}">
  <figcaption>鸭川边的清晨</figcaption>
</figure>`;

const LINKED_IMAGE_HTML = `<figure data-type="image">
  <a href="https://example.test/kyoto">
    <img src="${STALE_SRC}" alt="晨雾中的鸭川" data-media-id="${MEDIA_ID}">
  </a>
</figure>`;

const SETTINGS_IMAGE_HTML = `<figure data-type="image" data-align="right">
  <a href="https://example.test/kyoto" target="_blank">
    <img src="${STALE_SRC}" alt="晨雾中的鸭川" title="京都" width="480" height="320">
  </a>
  <figcaption>鸭川边的清晨</figcaption>
</figure>`;

function imageHtml(alignment?: "left" | "center" | "right"): string {
  const dataAlign = alignment ? ` data-align="${alignment}"` : "";
  return `<figure data-type="image"${dataAlign}>
    <img src="${STALE_SRC}" alt="晨雾中的鸭川">
    <figcaption>鸭川边的清晨</figcaption>
  </figure>`;
}

function EditorHarness({
  content,
  editable = true,
  uploadImage,
  onReady,
}: {
  content: Content;
  editable?: boolean;
  uploadImage?: JournalImageUpload;
  onReady: (editor: Editor) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit, JournalImage.configure({ uploadImage })],
    content,
    editable,
    immediatelyRender: true,
  });

  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}

async function renderEditor(
  content: Content,
  { editable = true, uploadImage }: { editable?: boolean; uploadImage?: JournalImageUpload } = {},
) {
  const editorRef: { current: Editor | null } = { current: null };
  const result = render(
    <EditorHarness
      content={content}
      editable={editable}
      uploadImage={uploadImage}
      onReady={(editor) => {
        editorRef.current = editor;
      }}
    />,
  );

  await waitFor(() => expect(editorRef.current).not.toBeNull());
  await waitFor(() =>
    expect(
      result.container.querySelector('figure[data-node-view-wrapper][data-type="image"]'),
    ).not.toBeNull(),
  );

  return { ...result, editor: editorRef.current as Editor };
}

function imageNode(editor: Editor) {
  return editor.getJSON().content?.[0] ?? null;
}

async function selectImage(editor: Editor, container: HTMLElement) {
  act(() => {
    editor.commands.setNodeSelection(0);
  });

  await waitFor(() =>
    expect(
      container.querySelector('figure[data-node-view-wrapper][data-type="image"]'),
    ).toHaveAttribute("data-selected", "true"),
  );
}

async function openImageSettings(
  editor: Editor,
  container: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
) {
  await selectImage(editor, container);
  await user.click(await screen.findByRole("button", { name: "图片设置" }));
  return screen.findByRole("dialog", { name: "图片设置" });
}

beforeEach(() => {
  fetchMedia.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JournalImageNodeView", () => {
  it("renders the figure, image attributes and non-empty caption", async () => {
    const { container } = await renderEditor(IMAGE_HTML);
    const figure = container.querySelector('figure[data-type="image"]');
    const image = figure?.querySelector("img");

    expect(figure).toHaveAttribute("data-align", "right");
    expect(image).toHaveAttribute("src", STALE_SRC);
    expect(image).toHaveAttribute("alt", "晨雾中的鸭川");
    expect(image).toHaveAttribute("title", "京都");
    expect(image).toHaveAttribute("width", "480");
    expect(image).toHaveAttribute("height", "320");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveAttribute("data-media-id", MEDIA_ID);
    expect(figure?.querySelector("figcaption")).toBeNull();
    const caption = screen.getByRole("textbox", { name: "图片图注" });
    expect(caption).toHaveValue("鸭川边的清晨");
    expect(caption).toHaveAttribute("rows", "1");
    expect(caption).toHaveAttribute("maxlength", "280");
    expect(caption).toHaveAttribute("placeholder", "添加图注…");
  });

  it("adds selected styling without changing HTML serialization", async () => {
    const { container, editor } = await renderEditor(IMAGE_HTML);
    const before = editor.getHTML();
    const beforeFigure = new DOMParser()
      .parseFromString(before, "text/html")
      .querySelector('figure[data-type="image"]')?.outerHTML;

    act(() => {
      editor.commands.setNodeSelection(0);
    });

    await waitFor(() =>
      expect(container.querySelector('figure[data-type="image"]')).toHaveAttribute(
        "data-selected",
        "true",
      ),
    );

    const figure = container.querySelector('figure[data-type="image"]');
    expect(figure?.className).toContain("outline");
    const after = editor.getHTML();
    const afterFigure = new DOMParser()
      .parseFromString(after, "text/html")
      .querySelector('figure[data-type="image"]')?.outerHTML;
    expect(afterFigure).toBe(beforeFigure);
    expect(after).not.toContain("data-node-view-wrapper");
    expect(after).not.toContain("data-selected");
  });

  it("shows the image actions only while selected and editable", async () => {
    const { container, editor } = await renderEditor(`${IMAGE_HTML}<p>正文</p>`);

    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "图片工具" })).toBeNull());

    await selectImage(editor, container);

    const toolbar = await screen.findByRole("toolbar", { name: "图片工具" });
    expect(toolbar).toHaveClass("absolute", "right-2", "top-2", "flex-wrap");
    expect(screen.getByRole("textbox", { name: "图片图注" })).toHaveValue("鸭川边的清晨");

    const left = screen.getByRole("button", { name: "左浮动" });
    const center = screen.getByRole("button", { name: "居中" });
    const right = screen.getByRole("button", { name: "右浮动" });
    const settings = screen.getByRole("button", { name: "图片设置" });
    const preview = screen.getByRole("button", { name: "预览图片" });
    const remove = screen.getByRole("button", { name: "删除图片" });

    expect(left).toHaveAttribute("aria-pressed", "false");
    expect(center).toHaveAttribute("aria-pressed", "false");
    expect(right).toHaveAttribute("aria-pressed", "true");
    expect(settings).toHaveAttribute("aria-expanded", "false");
    expect(preview).toHaveClass("focus-visible:ring-2");
    expect(remove).not.toHaveAttribute("aria-pressed");
    expect(left).toHaveClass("focus-visible:ring-2");
    expect(settings).toHaveClass("focus-visible:ring-2");

    const mouseDown = createEvent.mouseDown(left);
    fireEvent(left, mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);

    const settingsMouseDown = createEvent.mouseDown(settings);
    fireEvent(settings, settingsMouseDown);
    expect(settingsMouseDown.defaultPrevented).toBe(true);

    left.focus();
    expect(left).toHaveFocus();
  });

  it("hides the image actions in read-only mode even when the node is selected", async () => {
    const { container, editor } = await renderEditor(IMAGE_HTML, { editable: false });

    await selectImage(editor, container);

    expect(screen.queryByRole("toolbar", { name: "图片工具" })).toBeNull();
    expect(screen.queryByRole("button", { name: "图片设置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "预览图片" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除图片" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "图片图注" })).toBeNull();
    expect(container.querySelector("figcaption")).toHaveTextContent("鸭川边的清晨");
  });

  it("opens image settings with the current attrs and Escape closes without writing", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(SETTINGS_IMAGE_HTML);
    const before = { ...imageNode(editor)?.attrs };

    const panel = await openImageSettings(editor, container, user);
    expect(Object.prototype.hasOwnProperty.call(window, "__roamlogImageSettingsEscape")).toBe(
      false,
    );
    expect(panel).toHaveClass("max-w-[calc(100vw_-_24px)]", "overflow-y-auto");
    expect(screen.getByRole("textbox", { name: "替代文本" })).toHaveValue("晨雾中的鸭川");
    expect(screen.getByRole("textbox", { name: "图片标题" })).toHaveValue("京都");
    expect(screen.getByRole("textbox", { name: "图片说明" })).toHaveValue("鸭川边的清晨");
    expect(screen.getByRole("textbox", { name: "图片链接" })).toHaveValue(
      "https://example.test/kyoto",
    );
    expect(screen.getByRole("checkbox", { name: "新窗口打开" })).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "显示宽度" })).toHaveValue(480);
    expect(screen.getByRole("spinbutton", { name: "显示高度" })).toHaveValue(320);

    fireEvent.change(screen.getByRole("textbox", { name: "替代文本" }), {
      target: { value: "不会保存的替代文本" },
    });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "图片设置" })).toBeNull());
    expect(imageNode(editor)?.attrs).toEqual(before);
    expect(screen.getByRole("button", { name: "图片设置" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "图片设置" })).toHaveFocus());
    expect(Object.prototype.hasOwnProperty.call(window, "__roamlogImageSettingsEscape")).toBe(
      false,
    );

    await openImageSettings(editor, container, user);
    expect(screen.getByRole("textbox", { name: "替代文本" })).toHaveValue("晨雾中的鸭川");
  });

  it("keeps the toolbar and settings mounted when the portal clears node selection", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(`${SETTINGS_IMAGE_HTML}<p>正文</p>`);

    await openImageSettings(editor, container, user);
    expect(screen.getByRole("toolbar", { name: "图片工具" })).toBeVisible();
    expect(screen.getByRole("dialog", { name: "图片设置" })).toBeVisible();

    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });

    await waitFor(() =>
      expect(container.querySelector('figure[data-type="image"]')).not.toHaveAttribute(
        "data-selected",
        "true",
      ),
    );
    expect(screen.getByRole("toolbar", { name: "图片工具" })).toBeVisible();
    expect(screen.getByRole("dialog", { name: "图片设置" })).toBeVisible();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "图片设置" })).toBeNull());
    expect(screen.getByRole("toolbar", { name: "图片工具" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "图片设置" })).toHaveFocus());
  });

  it("opens the current image from the toolbar preview and restores button focus on close", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(IMAGE_HTML);

    await selectImage(editor, container);
    const preview = screen.getByRole("button", { name: "预览图片" });
    await user.click(preview);

    const dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(dialog).toHaveAttribute("data-index", "0");
    expect(dialog).toHaveAttribute("data-count", "1");
    expect(dialog).toHaveAttribute("data-first-src", STALE_SRC);
    expect(dialog).toHaveAttribute("data-first-width", "480");
    expect(dialog).toHaveAttribute("data-first-height", "320");
    expect(within(dialog).getByText("晨雾中的鸭川")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "关闭测试灯箱" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(preview).toHaveFocus());
  });

  it("opens an unlinked image by click and keyboard in read-only mode and restores image focus", async () => {
    const { container } = await renderEditor(IMAGE_HTML, { editable: false });
    const image = screen.getByRole("button", { name: "预览图片：晨雾中的鸭川" });
    expect(image).toHaveAttribute("tabindex", "0");
    expect(image).toHaveClass("cursor-zoom-in");

    fireEvent.click(image);
    let dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(dialog).toHaveAttribute("data-count", "1");

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭测试灯箱" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(image).toHaveFocus());

    fireEvent.keyDown(image, { key: "Enter" });
    dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(dialog).toHaveAttribute("data-first-src", STALE_SRC);

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭测试灯箱" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.keyDown(image, { key: " " });
    expect(await screen.findByRole("dialog", { name: "照片查看" })).toBeInTheDocument();
    expect(container.querySelector('figure[data-type="image"]')).toHaveAttribute(
      "data-align",
      "right",
    );
  });

  it("keeps a linked image as a normal link in read-only mode", async () => {
    const { container } = await renderEditor(LINKED_IMAGE_HTML, { editable: false });
    const image = container.querySelector("img");
    const anchor = container.querySelector("a");
    const followLink = vi.fn((event: Event) => event.preventDefault());
    anchor?.addEventListener("click", followLink);

    expect(image).not.toHaveAttribute("role");
    expect(image).not.toHaveAttribute("tabindex");

    fireEvent.click(image as HTMLImageElement);

    expect(followLink).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "照片查看" })).not.toBeInTheDocument();
  });

  it("previews a linked image from the toolbar without following the link", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(LINKED_IMAGE_HTML);
    const anchorClick = vi.fn();
    container.querySelector("a")?.addEventListener("click", anchorClick);

    await selectImage(editor, container);
    await user.click(screen.getByRole("button", { name: "预览图片" }));

    expect(await screen.findByRole("dialog", { name: "照片查看" })).toHaveAttribute(
      "data-first-src",
      STALE_SRC,
    );
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("does not open preview from the failed-image placeholder", async () => {
    fetchMedia.mockRejectedValue(new Error("media unavailable"));
    const { container } = await renderEditor(IMAGE_HTML, { editable: false });

    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    const placeholder = await screen.findByRole("img", {
      name: "图片加载失败：晨雾中的鸭川",
    });

    fireEvent.click(placeholder);
    expect(screen.queryByRole("dialog", { name: "照片查看" })).not.toBeInTheDocument();
  });

  it("closes image settings on an outside click without writing", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(SETTINGS_IMAGE_HTML);
    const before = { ...imageNode(editor)?.attrs };

    await openImageSettings(editor, container, user);
    fireEvent.change(screen.getByRole("textbox", { name: "替代文本" }), {
      target: { value: "外部点击不会保存" },
    });
    await user.click(document.body);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "图片设置" })).toBeNull());
    expect(imageNode(editor)?.attrs).toEqual(before);
  });

  it("applies accessibility, link and display-size settings without serializing style or class", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(LINKED_IMAGE_HTML);
    const followLink = vi.fn();
    container.querySelector('figure[data-type="image"] > a')?.addEventListener("click", followLink);

    await openImageSettings(editor, container, user);
    fireEvent.change(screen.getByRole("textbox", { name: "替代文本" }), {
      target: { value: "新的替代文本" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "图片标题" }), {
      target: { value: "新的标题" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "图片说明" }), {
      target: { value: "新的图注" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "图片链接" }), {
      target: { value: "https://example.test/new" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "显示宽度" }), {
      target: { value: "1200" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "显示高度" }), {
      target: { value: "900" },
    });
    await user.click(screen.getByRole("checkbox", { name: "新窗口打开" }));
    await user.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "图片设置" })).toBeNull());
    expect(imageNode(editor)?.attrs).toMatchObject({
      alt: "新的替代文本",
      title: "新的标题",
      caption: "新的图注",
      linkHref: "https://example.test/new",
      linkBlank: true,
      displayWidth: 1200,
      displayHeight: 900,
      alignment: null,
      mediaId: MEDIA_ID,
    });

    const figure = container.querySelector('figure[data-type="image"]');
    const image = figure?.querySelector("img");
    const anchor = figure?.querySelector("a");
    expect(image).toHaveAttribute("alt", "新的替代文本");
    expect(image).toHaveAttribute("title", "新的标题");
    expect(image).toHaveAttribute("width", "1200");
    expect(image).toHaveAttribute("height", "900");
    expect(screen.getByRole("textbox", { name: "图片图注" })).toHaveValue("新的图注");
    expect(anchor).toHaveAttribute("href", "https://example.test/new");
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(followLink).not.toHaveBeenCalled();

    const html = editor.getHTML();
    expect(html).toContain('alt="新的替代文本"');
    expect(html).toContain('title="新的标题"');
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="900"');
    expect(html).toContain("<figcaption>新的图注</figcaption>");
    expect(html).toContain('href="https://example.test/new"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("style=");
    expect(html).not.toContain("class=");
  });

  it("removes an existing link through the settings action", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(SETTINGS_IMAGE_HTML);

    await openImageSettings(editor, container, user);
    const removeLink = screen.getByRole("button", { name: "移除链接" });
    expect(removeLink).toBeEnabled();

    await user.click(removeLink);
    expect(screen.getByRole("textbox", { name: "图片链接" })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "新窗口打开" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() =>
      expect(imageNode(editor)?.attrs).toMatchObject({ linkHref: null, linkBlank: false }),
    );
    expect(container.querySelector('figure[data-type="image"] > a')).toBeNull();
  });

  it("clears a link when the link field is blank", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(SETTINGS_IMAGE_HTML);

    await openImageSettings(editor, container, user);
    fireEvent.change(screen.getByRole("textbox", { name: "图片链接" }), {
      target: { value: "   " },
    });
    expect(screen.getByRole("checkbox", { name: "新窗口打开" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "新窗口打开" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() =>
      expect(imageNode(editor)?.attrs).toMatchObject({ linkHref: null, linkBlank: false }),
    );
    expect(container.querySelector('figure[data-type="image"] > a')).toBeNull();
  });

  it("sanitizes unsafe links and out-of-range dimensions before writing attrs", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(IMAGE_HTML);

    await openImageSettings(editor, container, user);
    fireEvent.change(screen.getByRole("textbox", { name: "图片链接" }), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "显示宽度" }), {
      target: { value: "3000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "显示高度" }), {
      target: { value: "" },
    });
    await user.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() =>
      expect(imageNode(editor)?.attrs).toMatchObject({
        linkHref: null,
        linkBlank: false,
        displayWidth: 2400,
        displayHeight: null,
      }),
    );
    expect(container.querySelector('figure[data-type="image"] > a')).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("width", "2400");
    expect(container.querySelector("img")).not.toHaveAttribute("height");
    expect(editor.getHTML()).not.toContain("javascript:");
  });

  it.each([
    ["left", "左浮动"],
    ["center", "居中"],
    ["right", "右浮动"],
    [null, "默认对齐"],
  ] as const)(
    "reflects the %s alignment in aria-pressed without marking default as floating",
    async (alignment, activeLabel) => {
      const { container, editor } = await renderEditor(imageHtml(alignment ?? undefined));
      await selectImage(editor, container);

      for (const label of ["左浮动", "居中", "右浮动", "默认对齐"]) {
        expect(screen.getByRole("button", { name: label })).toHaveAttribute(
          "aria-pressed",
          label === activeLabel ? "true" : "false",
        );
      }
    },
  );

  it("updates only the alignment attribute and never serializes style or class", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(IMAGE_HTML);
    const initialAttrs = imageNode(editor)?.attrs;

    await selectImage(editor, container);

    await user.click(screen.getByRole("button", { name: "左浮动" }));
    await waitFor(() => expect(imageNode(editor)?.attrs?.alignment).toBe("left"));
    expect(container.querySelector('figure[data-type="image"]')).toHaveAttribute(
      "data-align",
      "left",
    );
    expect(screen.getByRole("button", { name: "左浮动" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "居中" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "右浮动" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "居中" }));
    await waitFor(() => expect(imageNode(editor)?.attrs?.alignment).toBe("center"));
    expect(container.querySelector('figure[data-type="image"]')).toHaveAttribute(
      "data-align",
      "center",
    );
    expect(screen.getByRole("button", { name: "居中" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "左浮动" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "右浮动" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "右浮动" }));
    await waitFor(() => expect(imageNode(editor)?.attrs?.alignment).toBe("right"));
    expect(container.querySelector('figure[data-type="image"]')).toHaveAttribute(
      "data-align",
      "right",
    );
    expect(screen.getByRole("button", { name: "右浮动" })).toHaveAttribute("aria-pressed", "true");
    expect(editor.getHTML()).toContain('data-align="right"');
    expect(editor.getHTML()).not.toMatch(/\s(?:style|class)=/);

    await user.click(screen.getByRole("button", { name: "默认对齐" }));
    await waitFor(() => expect(imageNode(editor)?.attrs?.alignment).toBeNull());
    expect(container.querySelector('figure[data-type="image"]')).not.toHaveAttribute("data-align");
    expect(screen.getByRole("button", { name: "默认对齐" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "左浮动" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "居中" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "右浮动" })).toHaveAttribute("aria-pressed", "false");

    expect(imageNode(editor)?.attrs).toMatchObject({
      src: initialAttrs?.src,
      alt: initialAttrs?.alt,
      title: initialAttrs?.title,
      caption: initialAttrs?.caption,
      mediaId: initialAttrs?.mediaId,
    });
    expect(editor.getHTML()).not.toContain('data-align="right"');
    expect(editor.getHTML()).not.toMatch(/\s(?:style|class)=/);
  });

  it("deletes the image through the node view transaction and restores it with undo", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(IMAGE_HTML);
    await selectImage(editor, container);

    await user.click(screen.getByRole("button", { name: "删除图片" }));

    await waitFor(() => expect(container.querySelector('figure[data-type="image"]')).toBeNull());
    expect(editor.getJSON().content ?? []).not.toContainEqual(
      expect.objectContaining({ type: "image" }),
    );
    expect(editor.can().undo()).toBe(true);

    act(() => {
      editor.commands.undo();
    });

    await waitFor(() =>
      expect(container.querySelector('figure[data-type="image"]')).not.toBeNull(),
    );
    expect(screen.getByRole("textbox", { name: "图片图注" })).toHaveValue("鸭川边的清晨");
    expect(imageNode(editor)?.attrs?.alignment).toBe("right");
  });

  it("selects a linked image without navigating and keeps toolbar clicks off the link", async () => {
    const user = userEvent.setup();
    const { container, editor } = await renderEditor(LINKED_IMAGE_HTML);
    const image = container.querySelector("img");
    expect(image).not.toBeNull();

    const imageClick = createEvent.click(image as HTMLImageElement);
    fireEvent(image as HTMLImageElement, imageClick);

    expect(imageClick.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      expect((editor.state.selection as NodeSelection).node.type.name).toBe("image");
    });

    const anchorClick = vi.fn();
    container.querySelector("a")?.addEventListener("click", anchorClick);

    await user.click(await screen.findByRole("button", { name: "左浮动" }));

    await waitFor(() => expect(imageNode(editor)?.attrs?.alignment).toBe("left"));
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("refreshes an expired src once through mediaId and displays the new src", async () => {
    fetchMedia.mockResolvedValue({
      url: FRESH_SRC,
      thumbUrl: null,
      width: 800,
      height: 600,
    });

    const { container, editor } = await renderEditor(IMAGE_HTML);
    const staleImage = container.querySelector("img");
    expect(staleImage).not.toBeNull();

    fireEvent.error(staleImage as HTMLImageElement);

    expect(fetchMedia).toHaveBeenCalledTimes(1);
    expect(fetchMedia).toHaveBeenCalledWith(MEDIA_ID, {
      signal: expect.any(AbortSignal),
    });

    await waitFor(() => {
      const image = container.querySelector("img");
      expect(image).toHaveAttribute("src", FRESH_SRC);
      expect(image).toHaveAttribute("width", "800");
      expect(image).toHaveAttribute("height", "600");
    });
    expect(imageNode(editor)?.attrs?.src).toBe(FRESH_SRC);
    expect(editor.can().undo()).toBe(false);
  });

  it("does not retry the same mediaId after the refreshed URL also fails", async () => {
    fetchMedia.mockResolvedValue({
      url: FRESH_SRC,
      thumbUrl: null,
      width: 800,
      height: 600,
    });

    const { container } = await renderEditor(IMAGE_HTML);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    await waitFor(() => {
      expect(container.querySelector("img")).toHaveAttribute("src", FRESH_SRC);
    });

    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    expect(await screen.findByText("图片加载失败")).toBeInTheDocument();
    expect(fetchMedia).toHaveBeenCalledTimes(1);
  });

  it("does not request media when mediaId is absent or invalid", async () => {
    const withoutMediaId = `<figure data-type="image">
      <img src="${STALE_SRC}" alt="旧图">
    </figure>`;
    const first = await renderEditor(withoutMediaId);

    fireEvent.error(first.container.querySelector("img") as HTMLImageElement);
    expect(await screen.findByText("图片加载失败")).toBeInTheDocument();
    expect(fetchMedia).not.toHaveBeenCalled();

    first.unmount();

    const invalidMediaId = `<figure data-type="image">
      <img src="${STALE_SRC}" alt="旧图" data-media-id="not-a-uuid">
    </figure>`;
    const second = await renderEditor(invalidMediaId);

    fireEvent.error(second.container.querySelector("img") as HTMLImageElement);
    expect(await screen.findByText("图片加载失败")).toBeInTheDocument();
    expect(fetchMedia).not.toHaveBeenCalled();
  });

  it("shows the error placeholder and alt when the refresh fails", async () => {
    fetchMedia.mockRejectedValue(new Error("media unavailable"));
    const { container, editor } = await renderEditor(IMAGE_HTML);

    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    expect(
      await screen.findByRole("img", { name: "图片加载失败：晨雾中的鸭川" }),
    ).toBeInTheDocument();
    expect(screen.getByText("晨雾中的鸭川")).toBeInTheDocument();
    expect(fetchMedia).toHaveBeenCalledTimes(1);
    expect(imageNode(editor)?.attrs?.src).toBe(STALE_SRC);
  });

  it("does not render an empty figcaption", async () => {
    const { container } = await renderEditor(
      `<figure data-type="image"><img src="${STALE_SRC}" alt="无图注"></figure>`,
    );

    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("edits the caption inline without losing a trailing space while typing", async () => {
    const { container, editor } = await renderEditor(IMAGE_HTML);
    const caption = screen.getByRole("textbox", { name: "图片图注" });

    fireEvent.focus(caption);
    fireEvent.change(caption, { target: { value: "新的图注 " } });

    expect(caption).toHaveValue("新的图注 ");
    expect(imageNode(editor)?.attrs?.caption).toBe("新的图注 ");
    expect(editor.getHTML()).toContain("<figcaption>新的图注</figcaption>");
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("turns a blank caption into null and omits figcaption after blur", async () => {
    const { container, editor } = await renderEditor(IMAGE_HTML);
    const caption = screen.getByRole("textbox", { name: "图片图注" });

    fireEvent.focus(caption);
    fireEvent.change(caption, { target: { value: "   " } });
    expect(imageNode(editor)?.attrs?.caption).toBeNull();
    expect(editor.getHTML()).not.toContain("<figcaption>");

    fireEvent.blur(caption);
    expect(caption).toHaveValue("");
    expect(imageNode(editor)?.attrs?.caption).toBeNull();
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("limits inline captions to 280 characters", async () => {
    const { editor } = await renderEditor(IMAGE_HTML);
    const caption = screen.getByRole("textbox", { name: "图片图注" });
    const longCaption = "长".repeat(300);

    fireEvent.focus(caption);
    fireEvent.change(caption, { target: { value: longCaption } });

    expect(caption).toHaveValue("长".repeat(280));
    expect(imageNode(editor)?.attrs?.caption).toBe("长".repeat(280));
  });

  it("keeps caption clicks from navigating the image link or selecting the node", async () => {
    const { container, editor } = await renderEditor(`${LINKED_IMAGE_HTML}<p>正文</p>`);
    const anchorClick = vi.fn();
    container.querySelector("a")?.addEventListener("click", anchorClick);
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    const caption = screen.getByRole("textbox", { name: "图片图注" });

    const click = createEvent.click(caption);
    fireEvent(caption, click);

    expect(click.defaultPrevented).toBe(false);
    expect(anchorClick).not.toHaveBeenCalled();
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
  });

  it("replaces the image through the configured uploader and clears the old caption/title", async () => {
    const replacement = new File([new Uint8Array([137, 80, 78, 71])], "replacement.png", {
      type: "image/png",
    });
    const uploadImage = vi.fn(async (_file: File, _signal: AbortSignal) => ({
      src: FRESH_SRC,
      mediaId: REPLACEMENT_MEDIA_ID,
      alt: "replacement.png",
      width: 1200,
      height: 800,
    }));
    const { container, editor } = await renderEditor(SETTINGS_IMAGE_HTML, { uploadImage });
    await selectImage(editor, container);

    const input = container.querySelector<HTMLInputElement>('input[aria-label="选择替换图片"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { files: [replacement] } });

    await waitFor(() =>
      expect(imageNode(editor)?.attrs).toMatchObject({
        src: FRESH_SRC,
        mediaId: REPLACEMENT_MEDIA_ID,
        alt: "replacement.png",
        caption: null,
        title: null,
        displayWidth: 1200,
        displayHeight: 800,
        alignment: "right",
        linkHref: "https://example.test/kyoto",
        linkBlank: true,
      }),
    );
    expect(uploadImage).toHaveBeenCalledWith(replacement, expect.any(AbortSignal));
    expect(await screen.findByRole("button", { name: "替换图片" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const html = editor.getHTML();
    expect(html).toContain(`src="${FRESH_SRC}"`);
    expect(html).toContain(`data-media-id="${REPLACEMENT_MEDIA_ID}"`);
    expect(html).not.toContain("鸭川边的清晨");
    expect(html).not.toContain("title=");
    expect(html).toContain('href="https://example.test/kyoto"');
    expect(html).not.toContain("style=");
    expect(html).not.toContain("class=");
  });

  it("disables the replace action while the upload is pending", async () => {
    let resolveUpload!: (value: {
      src: string;
      mediaId: string;
      alt: string;
      width: number;
      height: number;
    }) => void;
    const uploadImage = vi.fn(
      () =>
        new Promise<{
          src: string;
          mediaId: string;
          alt: string;
          width: number;
          height: number;
        }>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const replacement = new File([new Uint8Array([137, 80, 78, 71])], "pending.png", {
      type: "image/png",
    });
    const { container, editor } = await renderEditor(IMAGE_HTML, { uploadImage });
    await selectImage(editor, container);
    fireEvent.change(
      container.querySelector<HTMLInputElement>('input[aria-label="选择替换图片"]')!,
      { target: { files: [replacement] } },
    );

    expect(await screen.findByRole("button", { name: "正在替换图片" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在替换图片…");

    resolveUpload({
      src: FRESH_SRC,
      mediaId: REPLACEMENT_MEDIA_ID,
      alt: "pending.png",
      width: 640,
      height: 480,
    });
    expect(await screen.findByRole("button", { name: "替换图片" })).toBeEnabled();
  });

  it("keeps the original image and reports an alert when replacement fails", async () => {
    const uploadImage = vi.fn(async () => {
      throw new Error("替换失败：对象存储不可用");
    });
    const { container, editor } = await renderEditor(IMAGE_HTML, { uploadImage });
    await selectImage(editor, container);

    fireEvent.change(
      container.querySelector<HTMLInputElement>('input[aria-label="选择替换图片"]')!,
      {
        target: {
          files: [
            new File([new Uint8Array([137, 80, 78, 71])], "failed.png", {
              type: "image/png",
            }),
          ],
        },
      },
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("替换失败：对象存储不可用");
    expect(imageNode(editor)?.attrs?.src).toBe(STALE_SRC);
    expect(container.querySelector("img")).toHaveAttribute("src", STALE_SRC);
  });

  it("aborts an in-flight replacement when the node unmounts", async () => {
    let capturedSignal: AbortSignal | null = null;
    const uploadImage = vi.fn((_file: File, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<never>(() => undefined);
    });
    const { container, editor, unmount } = await renderEditor(IMAGE_HTML, { uploadImage });
    await selectImage(editor, container);

    fireEvent.change(
      container.querySelector<HTMLInputElement>('input[aria-label="选择替换图片"]')!,
      {
        target: {
          files: [
            new File([new Uint8Array([137, 80, 78, 71])], "pending.png", {
              type: "image/png",
            }),
          ],
        },
      },
    );
    await waitFor(() => expect(uploadImage).toHaveBeenCalledOnce());
    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);

    unmount();
    expect(capturedSignal!.aborted).toBe(true);
  });

  it("shows a configuration error when no replacement uploader is configured", async () => {
    const { container, editor } = await renderEditor(IMAGE_HTML);
    await selectImage(editor, container);

    fireEvent.change(
      container.querySelector<HTMLInputElement>('input[aria-label="选择替换图片"]')!,
      {
        target: {
          files: [
            new File([new Uint8Array([137, 80, 78, 71])], "photo.png", {
              type: "image/png",
            }),
          ],
        },
      },
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("当前编辑器未配置图片替换。");
    expect(imageNode(editor)?.attrs?.src).toBe(STALE_SRC);
  });
});
