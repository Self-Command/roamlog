import { z } from "zod";

import { DateOnlySchema, JsonObjectSchema, UuidV7Schema } from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { JournalEntrySchema, EntryRevisionSchema } from "../entities/journal";
import { MoodSchema, WeatherSchema } from "../entities/enums";
import { BooleanQuerySchema, MessageResponseSchema } from "./common";

export const EntryListQuerySchema = CursorQuerySchema.extend({
  tripId: UuidV7Schema.optional(),
  q: z.string().max(180).optional(),
  tag: z.string().max(40).optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  favorite: BooleanQuerySchema.optional(),
  sort: createSortSchema(["date", "updatedAt", "createdAt", "title"]).optional(),
});
export type EntryListQuery = z.infer<typeof EntryListQuerySchema>;

export const TripEntryListQuerySchema = EntryListQuerySchema.omit({ tripId: true });
export type TripEntryListQuery = z.infer<typeof TripEntryListQuerySchema>;

export const EntryPageSchema = CursorPageSchema(JournalEntrySchema);
export type EntryPage = z.infer<typeof EntryPageSchema>;

export const CreateJournalEntryRequestSchema = z
  .object({
    title: z.string().min(1).max(180),
    date: DateOnlySchema,
    location: z.string().min(1).max(160),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    mood: MoodSchema.nullable().optional(),
    weather: WeatherSchema.nullable().optional(),
    contentJson: JsonObjectSchema,
    contentHtml: z.string().max(500_000).optional(),
    excerpt: z.string().max(600).optional(),
    tags: z.array(z.string().min(1).max(40)).optional(),
    favorite: z.boolean().optional(),
  })
  .strict();
export type CreateJournalEntryRequest = z.infer<typeof CreateJournalEntryRequestSchema>;

export const UpdateJournalEntryRequestSchema = z
  .object({
    version: z.number().int().min(1),
    title: z.string().min(1).max(180).optional(),
    date: DateOnlySchema.optional(),
    location: z.string().min(1).max(160).optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    mood: MoodSchema.nullable().optional(),
    weather: WeatherSchema.nullable().optional(),
    contentJson: JsonObjectSchema.optional(),
    contentHtml: z.string().max(500_000).optional(),
    excerpt: z.string().max(600).optional(),
    tags: z.array(z.string().min(1).max(40)).optional(),
    favorite: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, {
    message: "At least one entry field must change.",
  });
export type UpdateJournalEntryRequest = z.infer<typeof UpdateJournalEntryRequestSchema>;

export const FavoriteEntryRequestSchema = z.object({ favorite: z.boolean() }).strict();
export type FavoriteEntryRequest = z.infer<typeof FavoriteEntryRequestSchema>;

export const RevisionListResponseSchema = z.array(EntryRevisionSchema);
export type RevisionListResponse = z.infer<typeof RevisionListResponseSchema>;

export const RestoreRevisionResponseSchema = JournalEntrySchema;
export type RestoreRevisionResponse = z.infer<typeof RestoreRevisionResponseSchema>;

export const DeleteEntryResponseSchema = MessageResponseSchema;
export type DeleteEntryResponse = z.infer<typeof DeleteEntryResponseSchema>;
