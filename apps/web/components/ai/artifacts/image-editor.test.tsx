import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactImageEditor } from "./image-editor";

const fetchMediaMock = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api/media", () => ({
  createCoverMediaClient: () => ({ fetchMedia: fetchMediaMock }),
}));

const MEDIA_ID = "01942f30-1200-7000-8000-000000000b01";

beforeEach(() => {
  fetchMediaMock.mockReset();
});

describe("ArtifactImageEditor", () => {
  it("resolves a media-backed image through the real media API", async () => {
    fetchMediaMock.mockResolvedValue({
      id: MEDIA_ID,
      url: "https://media.example/signed/full.webp",
      thumbUrl: "https://media.example/signed/thumb.webp",
    });

    render(<ArtifactImageEditor content="" mediaId={MEDIA_ID} title="京都街景" />);

    const image = await screen.findByRole("img", { name: "京都街景" });
    expect(image).toHaveAttribute("src", "https://media.example/signed/full.webp");
    expect(fetchMediaMock).toHaveBeenCalledWith(MEDIA_ID);
  });

  it("shows an actionable retry when the signed URL cannot be loaded", async () => {
    fetchMediaMock.mockRejectedValueOnce(new Error("expired")).mockResolvedValueOnce({
      id: MEDIA_ID,
      url: "https://media.example/signed/recovered.webp",
    });
    const user = userEvent.setup();

    render(<ArtifactImageEditor content="" mediaId={MEDIA_ID} title="海边" />);

    expect(await screen.findByText("图片加载失败，请重试。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重新加载" }));

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "海边" })).toHaveAttribute(
        "src",
        "https://media.example/signed/recovered.webp",
      ),
    );
    expect(fetchMediaMock).toHaveBeenCalledTimes(2);
  });

  it("keeps upstream's raw base64 artifact content displayable", () => {
    render(<ArtifactImageEditor content="aW1hZ2U=" mediaId={null} title="内联图片" />);

    expect(screen.getByRole("img", { name: "内联图片" })).toHaveAttribute(
      "src",
      "data:image/png;base64,aW1hZ2U=",
    );
  });
});
