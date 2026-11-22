import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShareGalleryLightbox } from "./share-gallery-lightbox";

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
      React.createElement(
        "div",
        { "data-testid": "photo-lightbox", "data-open": String(open) },
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
      ),
  };
});

const GALLERY_HTML = `
  <div data-type="gallery" data-columns="2">
    <figure data-type="gallery-item">
      <img src="/media/market.jpg" alt="锦市场" width="1200" height="800">
      <figcaption>锦市场的一碗热汤</figcaption>
    </figure>
    <figure data-type="gallery-item">
      <img src="/media/temple.jpg" alt="南禅寺">
    </figure>
  </div>
  <figure data-type="image">
    <img src="/media/regular.jpg" alt="普通正文图片">
  </figure>
`;

function renderBody(html = GALLERY_HTML) {
  return render(<ShareGalleryLightbox html={html} className="journal-layout" />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ShareGalleryLightbox", () => {
  it("annotates only gallery images and opens the clicked image with its gallery items", async () => {
    const { container } = renderBody();
    const galleryImages = container.querySelectorAll<HTMLImageElement>(
      'div[data-type="gallery"] img',
    );
    const regularImage = container.querySelector<HTMLImageElement>('figure[data-type="image"] img');

    expect(galleryImages[0]).toHaveAttribute("role", "button");
    expect(galleryImages[0]).toHaveAttribute("tabindex", "0");
    expect(galleryImages[0]).toHaveAttribute("aria-label", "查看图片：锦市场");
    expect(galleryImages[1]).toHaveAttribute("aria-label", "查看图片：南禅寺");
    expect(regularImage).not.toHaveAttribute("role");
    expect(regularImage?.tabIndex).toBe(-1);
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();

    fireEvent.click(galleryImages[0]!);

    const dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(screen.getByTestId("photo-lightbox")).toHaveAttribute("data-open", "true");
    expect(dialog).toHaveAttribute("data-index", "0");
    expect(dialog).toHaveAttribute("data-count", "2");
    expect(within(dialog).getByText("锦市场")).toBeInTheDocument();
    expect(within(dialog).getByText("南禅寺")).toBeInTheDocument();
  });

  it("opens with Enter and Space, and keeps the image as the dialog trigger", async () => {
    const { container } = renderBody();
    const images = container.querySelectorAll<HTMLImageElement>('div[data-type="gallery"] img');

    fireEvent.keyDown(images[1]!, { key: "Enter" });
    let dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(dialog).toHaveAttribute("data-index", "1");

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭测试灯箱" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();
    await waitFor(() => expect(images[1]).toHaveFocus());

    fireEvent.keyDown(images[0]!, { key: " " });
    dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(dialog).toHaveAttribute("data-index", "0");
  });

  it("opens a single-image gallery and restores focus on close", async () => {
    const { container } = renderBody(`
      <div data-type="gallery" data-columns="1">
        <figure data-type="gallery-item">
          <img src="/media/only.jpg" alt="唯一一张">
        </figure>
      </div>
    `);
    const image = container.querySelector<HTMLImageElement>("img");

    fireEvent.click(image!);
    const dialog = await screen.findByRole("dialog", { name: "照片查看" });
    expect(dialog).toHaveAttribute("data-index", "0");
    expect(dialog).toHaveAttribute("data-count", "1");

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭测试灯箱" }));
    await waitFor(() => expect(image).toHaveFocus());
  });

  it("does not open a lightbox for an ordinary body image", () => {
    renderBody(`
      <figure data-type="image">
        <img src="/media/regular.jpg" alt="普通图片">
      </figure>
    `);

    fireEvent.click(screen.getByAltText("普通图片"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
