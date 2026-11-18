import { describe, expect, it } from "vitest";

import { COVER_MAX_BYTES } from "@/lib/api/media";

import { formatBytes, resolveCoverMimeType, validateCoverFile } from "./cover-upload-validation";

function makeFile(name: string, type: string, size: number): File {
  const file = new File(["preview-bytes"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateCoverFile", () => {
  it("accepts every mime type the server signs", () => {
    const accepted = [
      ["cover.jpg", "image/jpeg"],
      ["cover.png", "image/png"],
      ["cover.webp", "image/webp"],
      ["cover.avif", "image/avif"],
      ["cover.heic", "image/heic"],
      ["cover.heif", "image/heif"],
    ] as const;

    for (const [name, type] of accepted) {
      const result = validateCoverFile(makeFile(name, type, 2 * 1024 * 1024));
      expect(result, `${name} should be accepted`).toEqual({ ok: true, mimeType: type });
    }
  });

  it("rejects an explicitly declared unsupported type instead of guessing from the name", () => {
    const result = validateCoverFile(makeFile("cover.jpg", "image/gif", 1024));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COVER_TYPE_UNSUPPORTED");
    expect(result.error.message).toContain("JPEG");
    expect(result.error.retryable).toBe(false);
  });

  it("falls back to the extension when browsers report an empty mime type (HEIC)", () => {
    expect(resolveCoverMimeType({ name: "IMG_0001.HEIC", type: "" })).toBe("image/heic");
    expect(resolveCoverMimeType({ name: "photo.heif", type: "" })).toBe("image/heif");
    expect(resolveCoverMimeType({ name: "scan.tiff", type: "" })).toBeNull();
  });

  it("accepts exactly 25 MB and rejects one byte more", () => {
    expect(validateCoverFile(makeFile("cover.jpg", "image/jpeg", COVER_MAX_BYTES)).ok).toBe(true);

    const tooLarge = validateCoverFile(
      makeFile("cover.jpg", "image/jpeg", COVER_MAX_BYTES + 1),
    );
    expect(tooLarge.ok).toBe(false);
    if (tooLarge.ok) return;
    expect(tooLarge.error.code).toBe("COVER_TOO_LARGE");
    expect(tooLarge.error.message).toContain("25 MB");
  });

  it("rejects empty files", () => {
    const result = validateCoverFile(makeFile("cover.jpg", "image/jpeg", 0));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COVER_EMPTY_FILE");
  });

  it("rejects a file without a usable name", () => {
    const result = validateCoverFile(makeFile("   ", "image/jpeg", 1024));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COVER_FILE_NAME_INVALID");
  });

  it("formats byte sizes for the validation message", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatBytes(1024 * 1024 + 512 * 1024)).toBe("1.5 MB");
  });
});