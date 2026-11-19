import { describe, expect, it, vi } from "vitest";

import {
  IMAGE_QUALITY_STEPS,
  IMAGE_SKIP_MAX_BYTES,
  IMAGE_TARGET_BYTES,
  ImageCompressionError,
  computeTargetSize,
  computeThumbnailSize,
  createDecodeError,
  encodeQualityLadder,
  qualityLadderFrom,
  shouldSkipCompression,
  toWebpFileName,
} from "./compress-image";

function blobOfSize(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/webp" });
}

describe("computeTargetSize", () => {
  it("downscales the long edge to 2000px without changing aspect ratio", () => {
    expect(computeTargetSize(6000, 4000)).toEqual({ width: 2000, height: 1333 });
    expect(computeTargetSize(3000, 1000)).toEqual({ width: 2000, height: 667 });
    expect(computeTargetSize(1000, 3000)).toEqual({ width: 667, height: 2000 });
  });

  it("never upscales an image smaller than the long-edge limit", () => {
    expect(computeTargetSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(computeTargetSize(320, 200)).toEqual({ width: 320, height: 200 });
  });

  it("honours a custom long-edge limit", () => {
    expect(computeTargetSize(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 });
  });
});

describe("computeThumbnailSize", () => {
  it("fits inside a 320px square without upscaling", () => {
    expect(computeThumbnailSize(2000, 1333)).toEqual({ width: 320, height: 213 });
    expect(computeThumbnailSize(1000, 2000)).toEqual({ width: 160, height: 320 });
    expect(computeThumbnailSize(200, 100)).toEqual({ width: 200, height: 100 });
  });
});

describe("shouldSkipCompression", () => {
  it("skips a small file whose long edge is already within 2000px", () => {
    expect(shouldSkipCompression(120 * 1024, 1800, 1200)).toBe(true);
    expect(shouldSkipCompression(IMAGE_SKIP_MAX_BYTES - 1, 2000, 100)).toBe(true);
  });

  it("recompresses when either the file is 200KB or larger, or the long edge exceeds 2000px", () => {
    expect(shouldSkipCompression(IMAGE_SKIP_MAX_BYTES, 1800, 1200)).toBe(false);
    expect(shouldSkipCompression(20 * 1024, 2001, 1000)).toBe(false);
    expect(shouldSkipCompression(1024, 6000, 4000)).toBe(false);
  });
});

describe("encodeQualityLadder", () => {
  it("starts at q=0.82 and stops at the first result within the target", async () => {
    const encode = vi
      .fn<(quality: number) => Promise<Blob>>()
      .mockResolvedValueOnce(blobOfSize(200))
      .mockResolvedValueOnce(blobOfSize(90));

    const result = await encodeQualityLadder({ encode, targetBytes: 100 });

    expect(encode.mock.calls.map(([quality]) => quality)).toEqual([0.82, 0.7]);
    expect(result.quality).toBe(0.7);
    expect(result.iterations).toBe(2);
  });

  it("clamps at q=0.55 and fails with TOO_LARGE_AFTER_COMPRESSION after four encodes", async () => {
    const encode = vi.fn(async (_quality: number) => blobOfSize(200));

    await expect(encodeQualityLadder({ encode, targetBytes: 100 })).rejects.toMatchObject({
      name: "ImageCompressionError",
      code: "TOO_LARGE_AFTER_COMPRESSION",
    });
    expect(encode).toHaveBeenCalledTimes(4);
    expect(encode.mock.calls.map(([quality]) => quality)).toEqual([...IMAGE_QUALITY_STEPS]);
  });

  it("uses the production target of 1.5MB", () => {
    expect(IMAGE_TARGET_BYTES).toBe(1_500_000);
    expect([...IMAGE_QUALITY_STEPS]).toEqual([0.82, 0.7, 0.6, 0.55]);
  });
});

describe("qualityLadderFrom", () => {
  it("reproduces the historical ladder for the default 0.82 start", () => {
    expect([...qualityLadderFrom()]).toEqual([...IMAGE_QUALITY_STEPS]);
    expect([...qualityLadderFrom(IMAGE_QUALITY_STEPS[0])]).toEqual([...IMAGE_QUALITY_STEPS]);
  });

  it("starts at a configured quality and keeps the relative falloff", () => {
    const ladder = qualityLadderFrom(0.9);

    expect(ladder).toHaveLength(4);
    expect(ladder[0]).toBe(0.9);
    expect(ladder[1]).toBeCloseTo(0.9 * (0.7 / 0.82), 2);
    expect(ladder[2]).toBeCloseTo(0.9 * (0.6 / 0.82), 2);
    expect(ladder[3]).toBeCloseTo(0.9 * (0.55 / 0.82), 2);
  });

  it("clamps the start into the WebP-safe range", () => {
    expect(qualityLadderFrom(0.1)[0]).toBe(0.4);
    expect(qualityLadderFrom(1.5)[0]).toBe(1);
    expect([...qualityLadderFrom(Number.NaN)]).toEqual([...qualityLadderFrom()]);
  });

  it("feeds a custom start into the ladder actually encoded", async () => {
    const encode = vi.fn(async (_quality: number) => blobOfSize(10));

    await encodeQualityLadder({
      encode,
      targetBytes: 100,
      qualities: qualityLadderFrom(0.9),
    });

    expect(encode.mock.calls.map(([quality]) => quality)).toEqual([0.9]);
  });
});

describe("compression failures", () => {
  it("gives HEIC/HEIF a readable decode failure instead of failing silently", () => {
    const error = createDecodeError(new File([], "IMG_0001.HEIC", { type: "image/heic" }));

    expect(error).toBeInstanceOf(ImageCompressionError);
    expect(error.code).toBe("DECODE_FAILED");
    expect(error.message).toContain("该格式浏览器无法解码");
    expect(error.message).toContain("JPEG");
  });

  it("classifies a regular undecodable file as DECODE_FAILED too", () => {
    const error = createDecodeError(new File([], "broken.jpg", { type: "image/jpeg" }));

    expect(error.code).toBe("DECODE_FAILED");
    expect(error.message).toContain("浏览器无法解码");
  });
});

describe("toWebpFileName", () => {
  it("keeps the semantic filename and swaps the extension", () => {
    expect(toWebpFileName("cover.JPG")).toBe("cover.webp");
    expect(toWebpFileName("IMG_0001.HEIC")).toBe("IMG_0001.webp");
    expect(toWebpFileName("trip.photo.jpeg")).toBe("trip.photo.webp");
    expect(toWebpFileName("cover")).toBe("cover.webp");
  });
});