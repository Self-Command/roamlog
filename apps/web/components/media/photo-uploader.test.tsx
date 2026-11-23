import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MediaUploadLimits } from "@/lib/api/media";
import { uploadLimitHint } from "@/lib/upload/photo-upload-limits";
import { renderWithQuery } from "@/test/query-harness";

import { PhotoUploader } from "./photo-uploader";

vi.mock("./photo-upload-panel", () => ({
  default: () => (
    <div className="uppy-Dashboard" data-ready="true" data-testid="photo-upload-dashboard" />
  ),
}));

const { LIMITS } = vi.hoisted(() => ({
  LIMITS: {
    maxFilesPerBatch: 20,
    maxFileBytes: 26_214_400,
    maxBatchBytes: 157_286_400,
    presignPerMinute: 20,
  } as MediaUploadLimits,
}));

vi.mock("@/lib/upload/roamlog-uploader", () => ({
  RoamlogUploader: class FakeRoamlogUploader {
    id = "RoamlogUploader";
    type = "uploader";

    install() {}
    update() {}
    afterUpdate() {}
    uninstall() {}
  },
}));

vi.mock("@/lib/upload/use-media-upload-limits", () => ({
  useMediaUploadLimits: () => ({
    limits: LIMITS,
    isLoading: false,
    refresh: () => {},
  }),
}));

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    useMediaCompressionPolicy: () => actual.MEDIA_COMPRESSION_DEFAULTS,
  };
});

describe("PhotoUploader upload limits", () => {
  it("renders the limit hint once and leaves the Dashboard without a note", async () => {
    const user = userEvent.setup();
    renderWithQuery(<PhotoUploader workspaceId="workspace-1" tripId="trip-1" canUpload />);

    await user.click(screen.getByRole("button", { name: "上传照片" }));
    const dashboard = await screen.findByTestId("photo-upload-dashboard");
    await waitFor(() => expect(dashboard).toHaveAttribute("data-ready", "true"));
    await waitFor(() => expect(document.querySelector(".uppy-Dashboard")).not.toBeNull());

    const hint = uploadLimitHint(LIMITS);
    expect(screen.getByTestId("photo-upload-limit")).toHaveTextContent(hint);
    expect(screen.getAllByText(hint)).toHaveLength(1);
    expect(document.querySelector(".uppy-Dashboard-note")).toBeNull();
  });
});
