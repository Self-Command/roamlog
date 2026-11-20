import { describe, expect, it } from "vitest";

import { isAvatarMediaId, mediaIdFromAvatarUrl } from "../avatar-image.js";

const MEDIA_ID = "01942f30-1200-7000-8000-000000000901";
const WORKSPACE_ID = "01942f30-1200-7000-8000-0000000000aa";

function signedVariantUrl(): string {
  return [
    "http://127.0.0.1:9000/roamlog-local",
    WORKSPACE_ID,
    "2026",
    "11",
    MEDIA_ID,
    "thumb.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900",
  ].join("/");
}

describe("avatar image storage form", () => {
  it("recognises the media id a new avatar stores", () => {
    expect(isAvatarMediaId(MEDIA_ID)).toBe(true);
    expect(isAvatarMediaId(` ${MEDIA_ID} `)).toBe(true);
    expect(isAvatarMediaId(signedVariantUrl())).toBe(false);
    expect(isAvatarMediaId(null)).toBe(false);
    expect(isAvatarMediaId("")).toBe(false);
  });

  it("recovers the media id from the object key of a signed upload URL", () => {
    expect(mediaIdFromAvatarUrl(signedVariantUrl())).toBe(MEDIA_ID);
  });

  it("recovers the id for every produced variant and both path layouts", () => {
    for (const variant of ["original.webp", "large.webp", "thumb.webp"]) {
      const url = `https://cdn.example.com/${WORKSPACE_ID}/2026/11/${MEDIA_ID}/${variant}`;
      expect(mediaIdFromAvatarUrl(url)).toBe(MEDIA_ID);
    }
    // Virtual-host style still carries the key path.
    expect(
      mediaIdFromAvatarUrl(
        `https://bucket.example.com/${WORKSPACE_ID}/2026/11/${MEDIA_ID}/thumb.jpg?X-Amz-Signature=abc`,
      ),
    ).toBe(MEDIA_ID);
  });

  it("returns null for URLs that are not media keys", () => {
    expect(mediaIdFromAvatarUrl("https://cdn.example.com/avatar.png")).toBeNull();
    expect(mediaIdFromAvatarUrl("https://example.com/" + MEDIA_ID)).toBeNull();
    expect(mediaIdFromAvatarUrl(null)).toBeNull();
    expect(mediaIdFromAvatarUrl("")).toBeNull();
  });
});