import { describe, expect, it } from "vitest";

import {
  LIVE_PHOTO_MOTION_MAX_BYTES,
  LIVE_PHOTO_MOTION_MAX_DURATION_MS,
  resolveMotionMimeType,
  validateMotionFile,
} from "./live-photo-motion";

function mov(size: number, name = "IMG_1.MOV", type = "video/quicktime") {
  return { name, type, size };
}

describe("validateMotionFile", () => {
  it("accepts a QuickTime clip inside both limits", () => {
    const result = validateMotionFile(mov(8 * 1024 * 1024), { durationMs: 2_400 });
    expect(result).toEqual({ ok: true, mimeType: "video/quicktime", durationMs: 2_400 });
  });

  it("resolves the container from the extension when the browser reports no MIME", () => {
    expect(resolveMotionMimeType(mov(1_000, "IMG_1.MOV", ""))).toBe("video/quicktime");
    expect(resolveMotionMimeType(mov(1_000, "clip.mp4", ""))).toBe("video/mp4");
    expect(resolveMotionMimeType({ name: "IMG_1.HEIC", type: "image/heic" })).toBeNull();
  });

  it("rejects a still file and explains what to pick", () => {
    const result = validateMotionFile({ name: "IMG_1.HEIC", type: "image/heic", size: 2_000 });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TYPE" },
    });
    expect(result.ok === false && result.error.message).toContain("MOV");
  });

  it("rejects a clip over the byte ceiling and reports decimal megabytes", () => {
    const result = validateMotionFile(mov(LIVE_PHOTO_MOTION_MAX_BYTES + 1));
    expect(result).toMatchObject({ ok: false, error: { code: "TOO_LARGE" } });

    // 50 MiB is 52,428,800 bytes: decimal units must say 52.4 MB, not the
    // binary "50 MB" that contradicted every other size in the product.
    const message = result.ok === false ? result.error.message : "";
    expect(message).toContain("52.4 MB");
    expect(message).not.toContain("50 MB");
  });

  it("rejects a clip over the duration ceiling", () => {
    const result = validateMotionFile(mov(1_000), {
      durationMs: LIVE_PHOTO_MOTION_MAX_DURATION_MS + 1_000,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "TOO_LONG" } });
  });

  it("accepts an unknown duration instead of blocking the upload", () => {
    // Browsers that cannot decode HEVC MOV report no duration; the server and a
        // Safari visitor may still play it, so this is not a rejection.
    const result = validateMotionFile(mov(1_000), { durationMs: null });
    expect(result).toEqual({ ok: true, mimeType: "video/quicktime", durationMs: null });
  });

  it("rejects an empty file", () => {
    expect(validateMotionFile(mov(0))).toMatchObject({ ok: false, error: { code: "TOO_LARGE" } });
  });
});