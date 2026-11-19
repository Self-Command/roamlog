import { describe, expect, it } from "vitest";

import { fileBasename, isMotionFile, isStillFile, pairLivePhotos } from "./live-photo-pair";

function file(name: string, type?: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: type ?? (isGuessType(name) as string),
  });
}

function isGuessType(name: string): string {
  if (/\.mov$/i.test(name)) return "video/quicktime";
  if (/\.heic$/i.test(name)) return "image/heic";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  return "";
}

describe("pairLivePhotos", () => {
  it("pairs a still and a movie that share a basename", () => {
    const still = file("IMG_1234.HEIC");
    const motion = file("IMG_1234.MOV");
    const { pairs, unpaired } = pairLivePhotos([still, motion]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.still).toBe(still);
    expect(pairs[0]?.motion).toBe(motion);
    expect(unpaired).toEqual([]);
  });

  it("matches basenames case-insensitively and ignores ordering", () => {
    const still = file("img_1234.jpg");
    const motion = file("IMG_1234.MOV");
    const { pairs, unpaired } = pairLivePhotos([motion, still]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.still).toBe(still);
    expect(pairs[0]?.motion).toBe(motion);
    expect(unpaired).not.toContain(motion);
  });

  it("returns every still as unpaired when the batch has no movie", () => {
    const a = file("A.JPG");
    const b = file("B.HEIC");
    const { pairs, unpaired } = pairLivePhotos([a, b]);

    expect(pairs).toEqual([]);
    expect(unpaired).toEqual([a, b]);
  });

  it("pairs one still with one movie and leaves the extra movie unpaired", () => {
    const still = file("IMG_1.HEIC");
    const first = file("IMG_1.MOV");
    const second = file("IMG_1.MOV");
    const { pairs, unpaired } = pairLivePhotos([still, first, second]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.motion).toBe(first);
    // The user's second file is surfaced, never dropped.
    expect(unpaired).toEqual([second]);
  });

  it("keeps movies without a matching still in unpaired", () => {
    const still = file("IMG_1.HEIC");
    const motion = file("IMG_1.MOV");
    const orphan = file("IMG_9999.MOV");
    const { pairs, unpaired } = pairLivePhotos([still, motion, orphan]);

    expect(pairs).toHaveLength(1);
    expect(unpaired).toEqual([orphan]);
  });

  it("returns an empty result for an empty selection", () => {
    expect(pairLivePhotos([])).toEqual({ pairs: [], unpaired: [] });
  });

  it("falls back to the single leftover movie when the still name says live", () => {
    const still = file("Live Photo 2026.JPG");
    const motion = file("clip-export.MOV");
    const { pairs, unpaired } = pairLivePhotos([still, motion]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.still).toBe(still);
    expect(pairs[0]?.motion).toBe(motion);
    expect(unpaired).toEqual([]);
  });

  it("does not use the lenient fallback when several movies are left", () => {
    const still = file("Live Photo 2026.JPG");
    const a = file("clip-a.MOV");
    const b = file("clip-b.MOV");
    const { pairs, unpaired } = pairLivePhotos([still, a, b]);

    expect(pairs).toEqual([]);
    expect(unpaired).toEqual([still, a, b]);
  });

  it("leaves non-media files untouched instead of dropping them", () => {
    const still = file("IMG_1.HEIC");
    const motion = file("IMG_1.MOV");
    const archive = file("IMG_1.livp", "application/zip");
    const { pairs, unpaired } = pairLivePhotos([still, motion, archive]);

    expect(pairs).toHaveLength(1);
    expect(unpaired).toEqual([archive]);
  });

  it("classifies by extension as well as by MIME type", () => {
    expect(isStillFile({ name: "IMG_1.HEIC", type: "" })).toBe(true);
    expect(isStillFile({ name: "clip.MOV", type: "" })).toBe(false);
    expect(isMotionFile({ name: "clip.MOV", type: "" })).toBe(true);
    expect(isMotionFile({ name: "clip.mov", type: "video/quicktime" })).toBe(true);
    expect(isMotionFile({ name: "IMG_1.jpg", type: "image/jpeg" })).toBe(false);
    expect(fileBasename("IMG_12.HEIC")).toBe("img_12");
  });
});