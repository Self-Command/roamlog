import { z } from "zod";

import { DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { MediaStatusSchema } from "../entities/enums";
import {
  MediaExifSchema,
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

/**
 * Completion callback for the still.
 *
 * `exif`/`lat`/`lng` ride along with the *existing* callback on purpose: the
 * uploader already posts here once, so metadata costs no extra request and no
 * extra upload. They are read in the browser from the source `File` **before**
 * `compress()` — the canvas re-encode that produces the uploaded WebP drops the
 * source EXIF, and the original is never uploaded, so this is the only
 * opportunity to keep the camera data (see `MediaExifSchema`).
 *
 * All three are genuinely `.optional()` on the request side: absence means
 * "nothing readable", which is a normal outcome (a screenshot, a stripped
 * export, a corrupt file) and must not fail an upload. They are never
 * `.nullable()` here — sending an explicit `null` is a client bug, and this
 * repository has already been burned by blurring optional with nullable.
 * `exif` is a metadata blob, not a security boundary: the reader strips what it
 * cannot normalize, and the pair rule below keeps a half-written position out
 * of the database.
 */
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
    exif: MediaExifSchema.optional(),
    lat: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe("WGS-84 latitude lifted from the EXIF GPS pair."),
    lng: z
      .number()
      .min(-180)
      .max(180)
      .optional()
      .describe("WGS-84 longitude lifted from the EXIF GPS pair."),
  })
  .strict()
  .superRefine((value, ctx) => {
    // `Media.lat`/`Media.lng` are written together and the database CHECK
    // rejects a half-position. Reject it here as a 400 instead of letting it
    // reach PostgreSQL as SQLSTATE 23514 and surface as a 500.
    if ((value.lat === undefined) !== (value.lng === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "`lat` and `lng` must be provided together.",
        path: [value.lat === undefined ? "lat" : "lng"],
      });
    }
  });
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
