import { z } from "zod";

import { IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { PackingCategorySchema } from "./enums";

export const PackingItemSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema,
    category: PackingCategorySchema,
    name: z.string().min(1).max(160),
    quantity: z.number().int().min(1).max(999),
    packed: z.boolean(),
    assigneeId: UuidV7Schema.nullable(),
    order: z.number().int().nonnegative(),
    createdById: UuidV7Schema,
    updatedById: UuidV7Schema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
    version: z.number().int().min(1),
  })
  .strict();
export type PackingItem = z.infer<typeof PackingItemSchema>;
