import { describe, expect, it } from "vitest";

import { AdminMediaPageSchema } from "../api/admin";
import { MediaListQuerySchema } from "../api/media";
import {
  CompleteMediaMotionRequestSchema,
  CompleteMediaRequestSchema,
  MEDIA_ERROR_CODES,
  MEDIA_MOTION_MAX_BYTES,
  MEDIA_MOTION_MAX_DURATION_MS,
  MEDIA_PRESIGN_BATCH_MAX_FILES,
  MEDIA_UPLOAD_MAX_WIRE_BYTES,
  MediaMotionPresignRequestSchema,
  MediaMotionPresignResponseSchema,
  MediaPageSchema,
  MediaPresignBatchRequestSchema,
  MediaPresignBatchResponseSchema,
  MediaPresignRequestSchema,
  MediaUploadLimitsSchema,
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
      MediaSchema.safeParse(
        media({ motion: { url: null, mimeType: "video/mp4", durationMs: 1, key: "x" } }),
      ).success,
    ).toBe(false);
  });

  it("keeps MediaPage aligned with the entity", () => {
    const page = MediaPageSchema.parse({
      items: [
        media({ livePhoto: true, motion: { url: null, mimeType: "video/mp4", durationMs: 0 } }),
      ],
      nextCursor: null,
      hasMore: false,
    });
    expect(page.items[0]?.motion?.mimeType).toBe("video/mp4");
  });

  it("requires the Admin page to carry the uploader-facing filename", () => {
    const page = AdminMediaPageSchema.parse({
      items: [media({ originalFileName: "旅行 京都.jpg" })],
      nextCursor: null,
      hasMore: false,
    });
    expect(page.items[0]?.originalFileName).toBe("旅行 京都.jpg");
    expect(
      AdminMediaPageSchema.safeParse({ items: [media()], nextCursor: null, hasMore: false })
        .success,
    ).toBe(false);
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
    expect(CompleteMediaMotionRequestSchema.safeParse({ ...complete, sizeBytes: 0 }).success).toBe(
      false,
    );
    expect(
      CompleteMediaMotionRequestSchema.safeParse({ ...complete, storageKey: "" }).success,
    ).toBe(false);
    expect(CompleteMediaMotionRequestSchema.safeParse({ ...complete, extra: true }).success).toBe(
      false,
    );
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
describe("upload ceilings contract (UPLOAD_LIMITS_WIRED)", () => {
  const presign = {
    fileName: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    size: 2048,
  };

  it("moves the size cap off the business value and keeps a loose wire ceiling", () => {
    // The old hardcoded `25 * 1024 * 1024` must be gone: the real ceiling is the
    // `limits.uploadMaxFileBytes` setting, answered with 422, not a schema error.
    expect(
      MediaPresignRequestSchema.safeParse({ ...presign, size: 25 * 1024 * 1024 + 1 }).success,
    ).toBe(true);
    expect(
      MediaPresignRequestSchema.safeParse({ ...presign, size: MEDIA_UPLOAD_MAX_WIRE_BYTES })
        .success,
    ).toBe(true);
    expect(
      MediaPresignRequestSchema.safeParse({ ...presign, size: MEDIA_UPLOAD_MAX_WIRE_BYTES + 1 })
        .success,
    ).toBe(false);
    expect(MediaPresignRequestSchema.safeParse({ ...presign, size: 0 }).success).toBe(false);
    // Same wire cap on the completion callback.
    expect(
      CompleteMediaRequestSchema.safeParse({ size: MEDIA_UPLOAD_MAX_WIRE_BYTES + 1 }).success,
    ).toBe(false);
  });

  it("keeps the batch wire cap at the registry maximum", () => {
    expect(MEDIA_PRESIGN_BATCH_MAX_FILES).toBe(100);
    const files = Array.from({ length: 3 }, () => presign);
    expect(MediaPresignBatchRequestSchema.safeParse({ files }).success).toBe(true);
    expect(MediaPresignBatchRequestSchema.safeParse({ files: [] }).success).toBe(false);
    expect(
      MediaPresignBatchRequestSchema.safeParse({
        files: Array.from({ length: MEDIA_PRESIGN_BATCH_MAX_FILES + 1 }, () => presign),
      }).success,
    ).toBe(false);
    // Per-file legality is still checked by the shared file schema.
    expect(
      MediaPresignBatchRequestSchema.safeParse({ files: [{ ...presign, mimeType: "image/gif" }] })
        .success,
    ).toBe(false);
    // Trip belongs to the batch, not to each file.
    expect(MediaPresignBatchRequestSchema.safeParse({ files }).success).toBe(true);
    expect(MediaPresignBatchRequestSchema.safeParse({ files, extra: true }).success).toBe(false);
  });

  it("returns a strict batch response in request order", () => {
    const item = {
      mediaId: MEDIA_ID,
      uploadUrl: "https://upload.example.test/put?sig=1",
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      expiresAt: NOW,
    };
    expect(MediaPresignBatchResponseSchema.safeParse({ items: [item, item] }).success).toBe(true);
    expect(MediaPresignBatchResponseSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      MediaPresignBatchResponseSchema.safeParse({ items: [item], bucket: "leak" }).success,
    ).toBe(false);
  });

  it("publishes the limits shape the authenticated endpoint answers", () => {
    const limits = {
      maxFilesPerBatch: 20,
      maxFileBytes: 26_214_400,
      maxBatchBytes: 157_286_400,
      presignPerMinute: 20,
    };
    expect(MediaUploadLimitsSchema.safeParse(limits).success).toBe(true);
    expect(MediaUploadLimitsSchema.safeParse({ ...limits, maxFileBytes: 0 }).success).toBe(false);
    expect(MediaUploadLimitsSchema.safeParse({ ...limits, extra: true }).success).toBe(false);
    expect(Object.values(MEDIA_ERROR_CODES)).toEqual([
      "MEDIA_FILE_TOO_LARGE",
      "MEDIA_BATCH_TOO_MANY_FILES",
      "MEDIA_BATCH_TOO_LARGE",
      "MEDIA_BATCH_EMPTY",
      "RATE_LIMITED",
    ]);
  });
});
