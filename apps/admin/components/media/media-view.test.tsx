import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { sampleMedia } from "../../test/admin-sample-data";
import { MediaView } from "./media-view";

describe("MediaView", () => {
  it("shows storage usage and orphan detection while keeping delete disabled for analysts", () => {
    render(<MediaView role="analyst" media={sampleMedia} />);

    expect(screen.getByRole("heading", { name: "媒体库" })).toBeInTheDocument();
    const orphanCard = screen.getByText("孤儿对象").closest("article");
    expect(orphanCard).not.toBeNull();
    expect(within(orphanCard as HTMLElement).getByText("3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "删除媒体 naoshima-pier-rain.jpg" }),
    ).toBeDisabled();
    expect(
      screen.getByTestId("media-thumbnail-0199b0c1-2200-7000-8000-000000000001"),
    ).toBeInTheDocument();
  });
});
