import { z } from "zod";

import {
  DateOnlySchema,
  IsoTimestampSchema,
  JsonObjectSchema,
  UuidV7Schema,
} from "../common/ids";
import { MoodSchema, WeatherSchema } from "./enums";

export const JournalEntrySchema = z
  .object({
    id: UuidV7Schema,
    tripId: UuidV7Schema,
    workspaceId: UuidV7Schema,
    title: z.string().min(1).max(180),
    date: DateOnlySchema,
    location: z.string().min(1).max(160),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    mood: MoodSchema.nullable(),
    weather: WeatherSchema.nullable(),
    contentJson: JsonObjectSchema,
    contentHtml: z.string().max(500_000),
    excerpt: z.string().max(600),
    tags: z.array(z.string().min(1).max(40)),
    favorite: z.boolean(),
    version: z.number().int().min(1),
    createdById: UuidV7Schema,
    updatedById: UuidV7Schema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const EntryRevisionSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    entryId: UuidV7Schema,
    version: z.number().int().min(1),
    title: z.string().min(1).max(180),
    contentJson: JsonObjectSchema,
    contentHtml: z.string().max(500_000),
    editedById: UuidV7Schema,
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type EntryRevision = z.infer<typeof EntryRevisionSchema>;

export const EntryMediaSchema = z
  .object({
    workspaceId: UuidV7Schema,
    entryId: UuidV7Schema,
    mediaId: UuidV7Schema,
    order: z.number().int().nonnegative(),
  })
  .strict();
export type EntryMedia = z.infer<typeof EntryMediaSchema>;
