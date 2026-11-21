import { describe, expect, it, vi } from "vitest";

import type { MediaUploadLimits } from "@/lib/api/media";

import { uploadLimitHint } from "./photo-upload-limits";
import { createPhotoUppy } from "./photo-uppy";

const LIMITS: MediaUploadLimits = {
  maxFilesPerBatch: 20,
  maxFileBytes: 26_214_400,
  maxBatchBytes: 157_286_400,
  presignPerMinute: 20,
};

vi.mock("./roamlog-uploader", () => ({
  RoamlogUploader: class FakeRoamlogUploader {
    id = "RoamlogUploader";
    type = "uploader";

    install() {}
    update() {}
    afterUpdate() {}
    uninstall() {}
  },
}));

describe("createPhotoUppy dashboard note", () => {
  it("keeps restrictions and the batch guard while omitting the Dashboard note", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const onNotice = vi.fn();
    const handle = createPhotoUppy({
      target,
      workspaceId: "workspace-1",
      tripId: "trip-1",
      mediaPolicy: {
        maxEdge: 2000,
        targetBytes: 1_500_000,
        quality: 0.82,
        maxUploadBytes: 25_000_000,
      },
      limits: LIMITS,
      onNotice,
    });

    try {
      expect(target.textContent).not.toContain(uploadLimitHint(LIMITS));
      expect(target.querySelector(".uppy-Dashboard-note")).toBeNull();
      expect(handle.uppy.opts.restrictions).toMatchObject({
        maxNumberOfFiles: LIMITS.maxFilesPerBatch,
        maxFileSize: LIMITS.maxFileBytes,
        maxTotalFileSize: LIMITS.maxBatchBytes,
        minNumberOfFiles: 1,
      });

      const guard = handle.uppy.opts.onBeforeFileAdded as
        | ((
            file: { name: string; isGhost?: boolean },
            files: Record<string, { isGhost?: boolean }>,
          ) => boolean | undefined)
        | undefined;
      const queued = Object.fromEntries(
        Array.from({ length: LIMITS.maxFilesPerBatch }, (_, index) => [
          String(index),
          { isGhost: false },
        ]),
      );

      expect(guard?.({ name: "under-limit.jpg", isGhost: false }, {})).toBeUndefined();
      expect(guard?.({ name: "over-limit.jpg", isGhost: false }, queued)).toBe(false);
      expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("一次最多上传 20 张"));
    } finally {
      handle.destroy();
      target.remove();
    }
  });
});
