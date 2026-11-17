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
    size: z.number().int().positive().max(25 * 1024 * 1024),
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
    size: z.number().int().positive().max(25 * 1024 * 1024).optional(),
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
