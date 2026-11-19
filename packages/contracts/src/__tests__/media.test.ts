import { describe, expect, it } from "vitest";

import { MediaListQuerySchema } from "../api/media";
import {
  CompleteMediaMotionRequestSchema,
  MEDIA_MOTION_MAX_BYTES,
  MEDIA_MOTION_MAX_DURATION_MS,
  MediaMotionPresignRequestSchema,
  MediaMotionPresignResponseSchema,
  MediaPageSchema,
} from "../api/media";
import { MediaMotionSchema, MediaSchema } from "../entities/media";
import { PublicMediaSchema } from "../api/share-links";

const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const NOW = "2026-11-19T08:00:00.000Z";

function media(overrides: Record<string, unknown> = {}) {
  return {
    id: MEDIA_ID,
    workspaceId: WORKSPACE_ID,
    tripId: null,
    uploaderId: "01942f30-1200-7000-8000-000000000002",
    bucket: "roamlog-test",
    key: `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/original.jpg`,
    mimeType: "image/jpeg",
    size: 4096,
    width: 1200,
    height: 800,
    blurhash: null,
    variants: {},
    status: "ready",
    error: null,
    caption: null,
    date: null,
    location: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

describe("Media live-photo contract", () => {
  it("accepts a plain photo without the new fields (backward compatible)", () => {
    const parsed = MediaSchema.parse(media());
    expect(parsed.livePhoto).toBeUndefined();
    expect(parsed.motion).toBeUndefined();
  });

  it("carries livePhoto=false and motion=null for a photo", () => {
    const parsed = MediaSchema.parse(media({ livePhoto: false, motion: null }));
    expect(parsed.livePhoto).toBe(false);
    expect(parsed.motion).toBeNull();
  });

  it("accepts a signed motion view and never requires a storage key", () => {
    const parsed = MediaSchema.parse(
      media({
        livePhoto: true,
        motion: {
          url: "https://media.example.test/motion.mov?sig=1",
          mimeType: "video/quicktime",
          durationMs: 2_400,
        },
      }),
    );
    expect(parsed.motion).toEqual({
      url: "https://media.example.test/motion.mov?sig=1",
      mimeType: "video/quicktime",
      durationMs: 2_400,
    });
  });

  it("rejects storage coordinates smuggled into the motion view (strict)", () => {
    expect(
      MediaMotionSchema.safeParse({
        url: null,
        mimeType: "video/quicktime",
        durationMs: null,
        storageKey: "leaked",
      }).success,
    ).toBe(false);
    expect(
      MediaSchema.safeParse(media({ motion: { url: null, mimeType: "video/webm", durationMs: 1 } }))
        .success,
    ).toBe(false);
  });

  it("is strict: unknown keys and storage coordinates must not reach the wire", () => {
    // `moderatedAt`/`moderatedById` are part of the contract (B4 admin reads) but
    // must stay nullable/optional; the motion payload has no such allowance.
    expect(MediaSchema.safeParse(media({ moderatedAt: NOW })).success).toBe(true);
    expect(MediaSchema.safeParse(media({ moderatedAt: "yesterday" })).success).toBe(false);
    expect(MediaSchema.safeParse(media({ motionKey: "x" })).success).toBe(false);
    expect(MediaSchema.safeParse(media({ bucketKey: "x" })).success).toBe(false);
    expect(
      MediaSchema.safeParse(media({ motion: { url: null, mimeType: "video/mp4", durationMs: 1, key: "x" } }))
        .success,
    ).toBe(false);
  });

  it("keeps MediaPage aligned with the entity", () => {
    const page = MediaPageSchema.parse({
      items: [media({ livePhoto: true, motion: { url: null, mimeType: "video/mp4", durationMs: 0 } })],
      nextCursor: null,
      hasMore: false,
    });
    expect(page.items[0]?.motion?.mimeType).toBe("video/mp4");
  });

  it("exposes livePhoto and a signed motion url on the public payload", () => {
    const parsed = PublicMediaSchema.parse({
      id: MEDIA_ID,
      url: "https://media.example.test/still.jpg?sig=1",
      thumbUrl: null,
      expiresAt: NOW,
      width: 1200,
      height: 800,
      blurhash: null,
      caption: null,
      date: null,
      location: null,
      livePhoto: true,
      motion: {
        url: "https://media.example.test/motion.mov?sig=1",
        mimeType: "video/quicktime",
        durationMs: 2_400,
      },
    });

    expect(parsed.motion?.url).toContain("/motion.mov");
    const encoded = JSON.stringify(parsed);
    expect(encoded).not.toContain("storageKey");
    expect(encoded).not.toContain("bucket");
    expect(encoded).not.toContain("variants");
    expect(encoded).not.toContain("moderatedAt");
    expect(
      PublicMediaSchema.safeParse({
        ...parsed,
        motion: { ...parsed.motion, storageKey: "leak" },
      }).success,
    ).toBe(false);
  });
});

describe("motion request contracts", () => {
  it("caps the presign request at 50 MB and 30 s", () => {
    const base = { fileName: "IMG_1.MOV", mimeType: "video/quicktime", size: 10 };
    expect(MediaMotionPresignRequestSchema.safeParse(base).success).toBe(true);
    expect(
      MediaMotionPresignRequestSchema.safeParse({ ...base, size: MEDIA_MOTION_MAX_BYTES + 1 })
        .success,
    ).toBe(false);
    expect(
      MediaMotionPresignRequestSchema.safeParse({
        ...base,
        durationMs: MEDIA_MOTION_MAX_DURATION_MS + 1,
      }).success,
    ).toBe(false);
    expect(
      MediaMotionPresignRequestSchema.safeParse({ ...base, mimeType: "image/jpeg" }).success,
    ).toBe(false);
  });

  it("requires the echoed storage key and a non-empty size on completion", () => {
    const complete = {
      storageKey: `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/motion.mov`,
      mimeType: "video/quicktime",
      sizeBytes: 10,
      durationMs: null,
    };
    expect(CompleteMediaMotionRequestSchema.safeParse(complete).success).toBe(true);
    expect(
      CompleteMediaMotionRequestSchema.safeParse({ ...complete, sizeBytes: 0 }).success,
    ).toBe(false);
    expect(
      CompleteMediaMotionRequestSchema.safeParse({ ...complete, storageKey: "" }).success,
    ).toBe(false);
    expect(
      CompleteMediaMotionRequestSchema.safeParse({ ...complete, extra: true }).success,
    ).toBe(false);
  });

  it("returns a strict presign response with the derived key", () => {
    const response = {
      mediaId: MEDIA_ID,
      storageKey: `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/motion.mov`,
      uploadUrl: "https://upload.example.test/put?sig=1",
      method: "PUT",
      headers: { "Content-Type": "video/quicktime" },
      expiresAt: NOW,
    };
    expect(MediaMotionPresignResponseSchema.safeParse(response).success).toBe(true);
    expect(
      MediaMotionPresignResponseSchema.safeParse({ ...response, bucket: "leak" }).success,
    ).toBe(false);
  });

  it("still accepts the trip media query after the media split", () => {
    expect(MediaListQuerySchema.safeParse({ tripId: MEDIA_ID }).success).toBe(true);
  });
});