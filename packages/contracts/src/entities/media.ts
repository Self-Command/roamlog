import { z } from "zod";

import {
  DateOnlySchema,
  IsoTimestampSchema,
  JsonObjectSchema,
  UuidV7Schema,
} from "../common/ids";
import { MediaStatusSchema } from "./enums";

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
  })
  .strict();
export type Media = z.infer<typeof MediaSchema>;
