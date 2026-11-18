import { z } from "zod";

import { DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { MediaStatusSchema } from "../entities/enums";
import { MediaSchema } from "../entities/media";
import { TripSchema } from "../entities/trip";
import { MessageResponseSchema } from "./common";

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
