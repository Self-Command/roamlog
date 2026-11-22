import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { JournalGalleryImageAttrs } from "../journal-gallery";
import {
  galleryReorderTarget,
  JournalGalleryPanel,
  reorderGalleryByDrag,
} from "../journal-gallery-panel";

function makeImage(overrides: Partial<JournalGalleryImageAttrs> = {}): JournalGalleryImageAttrs {
  return {
    src: "/media/photo.jpg",
    alt: "",
    title: null,
    caption: null,
    width: null,
    height: null,
    mediaId: null,
    ...overrides,
  };
}

function renderPanel(images: JournalGalleryImageAttrs[]) {
  const onImageChange = vi.fn();
  const onMove = vi.fn();
  const onReorder = vi.fn();
  const onRemove = vi.fn();
  const onClose = vi.fn();

  const result = render(
    <JournalGalleryPanel
      images={images}
      onImageChange={onImageChange}
      onMove={onMove}
      onReorder={onReorder}
      onRemove={onRemove}
      onClose={onClose}
    />,
  );

  return { ...result, onImageChange, onMove, onReorder, onRemove, onClose };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JournalGalleryPanel", () => {
  it("renders numbered thumbnails, alt/caption inputs, and safe placeholders", () => {
    const { container } = renderPanel([
      makeImage({ src: "/media/a.jpg", alt: "鸭川", caption: "清晨的鸭川" }),
      makeImage({ src: "javascript:alert(1)", alt: "", caption: null }),
    ]);

    expect(screen.getByText("2 张图片")).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "第 1 张图片缩略图" })).toHaveAttribute(
      "src",
      "/media/a.jpg",
    );
    expect(screen.getByRole("img", { name: "第 2 张图片无缩略图" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "第 1 张图片的替代文本" })).toHaveValue("鸭川");
    expect(screen.getByRole("textbox", { name: "第 1 张图片的说明" })).toHaveValue("清晨的鸭川");
  });

  it("emits alt, caption, move, remove, and close actions", () => {
    const { onImageChange, onMove, onRemove, onClose } = renderPanel([
      makeImage({ alt: "A" }),
      makeImage({ alt: "B" }),
    ]);

    fireEvent.change(screen.getByRole("textbox", { name: "第 1 张图片的替代文本" }), {
      target: { value: "新的替代文本" },
    });
    expect(onImageChange).toHaveBeenLastCalledWith(0, { alt: "新的替代文本" });

    fireEvent.change(screen.getByRole("textbox", { name: "第 1 张图片的说明" }), {
      target: { value: "新的说明" },
    });
    expect(onImageChange).toHaveBeenLastCalledWith(0, { caption: "新的说明" });

    expect(screen.getByRole("button", { name: "上移第 1 张图片" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移第 2 张图片" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下移第 1 张图片" }));
    expect(onMove).toHaveBeenLastCalledWith(0, 1);

    fireEvent.click(screen.getByRole("button", { name: "上移第 2 张图片" }));
    expect(onMove).toHaveBeenLastCalledWith(1, -1);

    fireEvent.click(screen.getByRole("button", { name: "删除第 1 张图片" }));
    expect(onRemove).toHaveBeenLastCalledWith(0);

    fireEvent.click(screen.getByRole("button", { name: "关闭图库设置" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("exposes keyboard drag handles and resolves reorder targets", () => {
    const { onReorder } = renderPanel([
      makeImage({ src: "/media/a.jpg" }),
      makeImage({ src: "/media/b.jpg" }),
    ]);

    const handle = screen.getByRole("button", { name: "拖动第 1 张图片" });
    expect(handle).toHaveAttribute("data-dnd-handle");
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    const instructions = document.getElementById(handle.getAttribute("aria-describedby") ?? "");
    expect(instructions).toHaveTextContent("按空格拿起图片");

    expect(
      galleryReorderTarget(
        ["0:/media/a.jpg", "1:/media/b.jpg"],
        "0:/media/a.jpg",
        "1:/media/b.jpg",
      ),
    ).toEqual({
      from: 0,
      to: 1,
    });
    expect(
      galleryReorderTarget(["0:/media/a.jpg", "1:/media/b.jpg"], "0:/media/a.jpg", null),
    ).toBeNull();
    expect(
      galleryReorderTarget(
        ["0:/media/a.jpg", "1:/media/b.jpg"],
        "0:/media/a.jpg",
        "0:/media/a.jpg",
      ),
    ).toBeNull();
    expect(galleryReorderTarget(["0:/media/a.jpg"], "missing", "0:/media/a.jpg")).toBeNull();

    expect(
      reorderGalleryByDrag(
        ["0:/media/a.jpg", "1:/media/b.jpg"],
        "0:/media/a.jpg",
        "1:/media/b.jpg",
        onReorder,
      ),
    ).toBe(true);
    expect(onReorder).toHaveBeenCalledWith(0, 1);
    expect(
      reorderGalleryByDrag(["0:/media/a.jpg", "1:/media/b.jpg"], "0:/media/a.jpg", null, onReorder),
    ).toBe(false);
  });

  it("keeps the up/down buttons as a keyboard-accessible fallback", async () => {
    const user = userEvent.setup();
    const { onMove } = renderPanel([
      makeImage({ src: "/media/a.jpg", alt: "A" }),
      makeImage({ src: "/media/b.jpg", alt: "B" }),
    ]);
    const down = screen.getByRole("button", { name: "下移第 1 张图片" });
    down.focus();
    expect(down).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(onMove).toHaveBeenCalledWith(0, 1);
  });

  it("uses unique sortable ids when two gallery images share a mediaId", () => {
    const { container } = renderPanel([
      makeImage({
        src: "/media/a.jpg",
        mediaId: "0193f6a0-7c00-7000-8000-000000000001",
      }),
      makeImage({
        src: "/media/b.jpg",
        mediaId: "0193f6a0-7c00-7000-8000-000000000001",
      }),
    ]);

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("li[data-gallery-sortable-id]"),
    );
    const ids = rows.map((row) => row.getAttribute("data-gallery-sortable-id"));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toMatch(/^0:/);
    expect(ids[1]).toMatch(/^1:/);
  });

  it("renders an empty state when the gallery has no images", () => {
    renderPanel([]);

    expect(screen.getByText("图库中没有图片。")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "图库图片列表" })).toBeNull();
  });
});
