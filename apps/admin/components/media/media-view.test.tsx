import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { sampleMedia } from "../../test/admin-sample-data";
import { MediaView } from "./media-view";

describe("MediaView", () => {
  it("shows storage usage and orphan detection while keeping delete disabled for analysts", () => {
    render(<MediaView role="analyst" media={sampleMedia} />);

    expect(screen.getByRole("heading", { name: "媒体库" })).toBeInTheDocument();
    const orphanCard = screen.getByText("未引用文件").closest("article");
    expect(orphanCard).not.toBeNull();
    expect(within(orphanCard as HTMLElement).getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除媒体 naoshima-pier-rain.jpg" })).toBeDisabled();
    expect(
      screen.getByTestId("media-thumbnail-0199b0c1-2200-7000-8000-000000000001"),
    ).toBeInTheDocument();
  });

  it("refreshes a failed signed thumbnail once and shows a retry action if it still fails", async () => {
    const onRefresh = vi.fn();
    render(<MediaView role="admin" media={sampleMedia} onRefresh={onRefresh} />);

    const image = screen.getByTestId("media-thumbnail-0199b0c1-2200-7000-8000-000000000001");
    fireEvent.error(image);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("media-preview-error-0199b0c1-2200-7000-8000-000000000001"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("restores thumbnails when refreshed media supplies a new signed URL", async () => {
    const first = sampleMedia[0]!;
    const { rerender } = render(<MediaView role="admin" media={[first]} />);
    fireEvent.error(screen.getByTestId(`media-thumbnail-${first.id}`));
    expect(screen.getByTestId(`media-preview-error-${first.id}`)).toBeInTheDocument();

    const refreshed = {
      ...first,
      thumbnailUrl: "https://cdn.example.test/refreshed-thumb.jpg",
    };
    rerender(<MediaView role="admin" media={[refreshed]} />);

    await waitFor(() => {
      expect(screen.getByTestId(`media-thumbnail-${first.id}`)).toHaveAttribute(
        "src",
        refreshed.thumbnailUrl,
      );
    });
    expect(screen.queryByTestId(`media-preview-error-${first.id}`)).not.toBeInTheDocument();
  });

  it("filters by the uploader-facing Unicode filename", () => {
    const media = { ...sampleMedia[0]!, fileName: "旅行 京都.jpg" };
    render(<MediaView role="admin" media={[media]} />);

    const search = screen.getByPlaceholderText("文件名或工作区");
    fireEvent.change(search, { target: { value: "京都" } });
    expect(screen.getByRole("article", { name: "媒体 旅行 京都.jpg" })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配媒体")).toBeInTheDocument();
  });
});
