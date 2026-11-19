import { z } from "zod";

import { DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { MediaStatusSchema } from "../entities/enums";
import {
  MediaMotionMimeTypeSchema,
  MediaSchema,
} from "../entities/media";
import { TripSchema } from "../entities/trip";
import { MessageResponseSchema } from "./common";

/**
 * Limits for the paired motion asset. The still is compressed in the browser
 * (D1); the motion is deliberately *not* re-encoded there — a second pass over
 * a `.mov` risks the `moov` atom and the Apple still-image-time metadata — so
 * the size and duration caps are the only client-side guards besides magic-byte
 * checks on the server. Kept here so the API, the web uploader and the tests
 * read one number.
 */
export const MEDIA_MOTION_MAX_BYTES = 50 * 1024 * 1024;
export const MEDIA_MOTION_MAX_DURATION_MS = 30_000;

export const MediaPresignRequestSchema = z
  .object({
    tripId: UuidV7Schema.optional(),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().regex(/^image\/(jpeg|png|webp|avif|heic|heif)$/),
    size: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    caption: z.string().max(500).optional(),
    date: DateOnlySchema.optional(),
    location: z.string().max(200).optional(),
  })
  .strict();
export type MediaPresignRequest = z.infer<typeof MediaPresignRequestSchema>;

export const MediaPresignResponseSchema = z
  .object({
    mediaId: UuidV7Schema,
    uploadUrl: z.url(),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string()),
    expiresAt: IsoTimestampSchema,
  })
  .strict();
export type MediaPresignResponse = z.infer<typeof MediaPresignResponseSchema>;

export const CompleteMediaRequestSchema = z
  .object({
    size: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024)
      .optional(),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    blurhash: z.string().max(200).optional(),
  })
  .strict();
export type CompleteMediaRequest = z.infer<typeof CompleteMediaRequestSchema>;

/**
 * Ask the API for a presigned PUT of the paired motion asset.
 *
 * Same presign machinery as the still (`StorageService.createPresignedUpload`,
 * one signed URL, one `Content-Type` header); the only difference is the video
 * content type and the tighter size ceiling. The response also carries the
 * server-generated `storageKey` because the completion callback has to prove
 * which object it is completing — the key is always derived from the media
 * folder, never accepted from the client.
 */
export const MediaMotionPresignRequestSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: MediaMotionMimeTypeSchema,
    size: z.number().int().positive().max(MEDIA_MOTION_MAX_BYTES),
    durationMs: z.number().int().nonnegative().max(MEDIA_MOTION_MAX_DURATION_MS).optional(),
  })
  .strict();
export type MediaMotionPresignRequest = z.infer<typeof MediaMotionPresignRequestSchema>;

export const MediaMotionPresignResponseSchema = z
  .object({
    mediaId: UuidV7Schema,
    storageKey: z
      .string()
      .min(1)
      .max(500)
      .describe("Server-derived object key; echoed back on completion."),
    uploadUrl: z.url(),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string()),
    expiresAt: IsoTimestampSchema,
  })
  .strict();
export type MediaMotionPresignResponse = z.infer<typeof MediaMotionPresignResponseSchema>;

/**
 * Completion callback after the motion PUT succeeded.
 *
 * `sizeBytes` is the client's view; the API still HEADs the object and refuses a
 * mismatch, so a client cannot register a motion row that points at nothing.
 */
export const CompleteMediaMotionRequestSchema = z
  .object({
    storageKey: z.string().min(1).max(500),
    mimeType: MediaMotionMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(MEDIA_MOTION_MAX_BYTES),
    durationMs: z.number().int().nonnegative().max(MEDIA_MOTION_MAX_DURATION_MS).nullable(),
  })
  .strict();
export type CompleteMediaMotionRequest = z.infer<typeof CompleteMediaMotionRequestSchema>;

export const MediaListQuerySchema = CursorQuerySchema.extend({
  tripId: UuidV7Schema.optional(),
  status: MediaStatusSchema.optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type MediaListQuery = z.infer<typeof MediaListQuerySchema>;

export const TripMediaListQuerySchema = MediaListQuerySchema.omit({ tripId: true });
export type TripMediaListQuery = z.infer<typeof TripMediaListQuerySchema>;

export const MediaPageSchema = CursorPageSchema(MediaSchema);
export type MediaPage = z.infer<typeof MediaPageSchema>;

export const MediaReadSchema = MediaSchema.omit({
  bucket: true,
  key: true,
  variants: true,
})
  .extend({
    url: z.url().nullable().describe("Signed display URL, preferring the large variant."),
    thumbUrl: z.url().nullable().describe("Signed thumbnail URL for cards and compact layouts."),
    expiresAt: IsoTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((media, ctx) => {
    if (media.status === "ready" && media.url === null) {
      ctx.addIssue({
        code: "custom",
        message: "A ready media asset must include a display URL.",
        path: ["url"],
      });
    }
    const hasUrl = media.url !== null || media.thumbUrl !== null;
    if (hasUrl && media.expiresAt === null) {
      ctx.addIssue({
        code: "custom",
        message: "Signed media URLs must include an expiry.",
        path: ["expiresAt"],
      });
    }
  });
export type MediaRead = z.infer<typeof MediaReadSchema>;

export const GetMediaResponseSchema = MediaReadSchema;
export type GetMediaResponse = MediaRead;

export const UpdateMediaRequestSchema = z
  .object({
    caption: z.string().max(500).nullable().optional(),
    date: DateOnlySchema.nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    tripId: UuidV7Schema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one media field is required.",
  });
export type UpdateMediaRequest = z.infer<typeof UpdateMediaRequestSchema>;

export const SetTripCoverRequestSchema = z.object({ mediaId: UuidV7Schema }).strict();
export type SetTripCoverRequest = z.infer<typeof SetTripCoverRequestSchema>;

export const SetTripCoverResponseSchema = TripSchema;
export type SetTripCoverResponse = z.infer<typeof SetTripCoverResponseSchema>;

export const DeleteMediaResponseSchema = MessageResponseSchema;
export type DeleteMediaResponse = z.infer<typeof DeleteMediaResponseSchema>;
