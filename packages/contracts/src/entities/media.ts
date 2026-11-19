import { z } from "zod";

import {
  DateOnlySchema,
  IsoTimestampSchema,
  JsonObjectSchema,
  UuidV7Schema,
} from "../common/ids";
import { MediaStatusSchema } from "./enums";

/**
 * Container types a paired motion asset may use.
 *
 * iOS records `video/quicktime` (HEVC in a `.mov`); the worker may transcode to
 * `video/mp4` for browsers that cannot play HEVC, so both are accepted by the
 * contract and by the database CHECK.
 */
export const MEDIA_MOTION_MIME_TYPES = ["video/quicktime", "video/mp4"] as const;
export const MediaMotionMimeTypeSchema = z.enum(MEDIA_MOTION_MIME_TYPES);
export type MediaMotionMimeType = (typeof MEDIA_MOTION_MIME_TYPES)[number];

/**
 * The paired motion asset of a Live Photo, as the API exposes it.
 *
 * `url` is a signed read URL with the same expiry semantics as the still's
 * `url`/`thumbUrl`; the bucket, the storage key and the thumbnail key never
 * leave the server. `url` is `null` while nothing has been signed yet (for
 * example while the still is still processing), which is why the whole object
 * is nullable on `Media` rather than an object with empty fields.
 */
export const MediaMotionSchema = z
  .object({
    url: z.url().nullable().describe("Signed motion URL (video), same expiry as `expiresAt`."),
    mimeType: MediaMotionMimeTypeSchema,
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type MediaMotion = z.infer<typeof MediaMotionSchema>;

export const MediaSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema.nullable(),
    uploaderId: UuidV7Schema,
    bucket: z.string().min(1).max(120),
    key: z.string().min(1).max(500),
    mimeType: z.string().min(1).max(120),
    size: z.number().int().nonnegative(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    blurhash: z.string().max(200).nullable(),
    variants: JsonObjectSchema,
    status: MediaStatusSchema,
    error: z.string().max(1000).nullable(),
    caption: z.string().max(500).nullable(),
    date: DateOnlySchema.nullable(),
    location: z.string().max(200).nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
    /** Admin takedown marker; `deletedAt` remains the author's own delete. */
    moderatedAt: IsoTimestampSchema.nullable().optional(),
    moderatedById: UuidV7Schema.nullable().optional(),
    /**
     * `true` exactly when a live (non-deleted) motion row is paired with this
     * still. Optional so pre-Live-Photo fixtures and older clients keep parsing;
     * the API always sends it.
     */
    livePhoto: z
      .boolean()
      .optional()
      .describe("Whether a paired motion asset exists for this still."),
    motion: MediaMotionSchema.nullable()
      .optional()
      .describe("Paired motion asset; `null` for an ordinary image."),
  })
  .strict();
export type Media = z.infer<typeof MediaSchema>;