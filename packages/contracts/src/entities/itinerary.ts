import { z } from "zod";

import { DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { ItineraryItemTypeSchema, TimeOfDaySchema } from "./enums";

export const ItineraryItemSchema = z
  .object({
    id: UuidV7Schema,
    tripId: UuidV7Schema,
    workspaceId: UuidV7Schema,
    date: DateOnlySchema,
    startTime: TimeOfDaySchema.nullable(),
    endTime: TimeOfDaySchema.nullable(),
    title: z.string().min(1).max(180),
    type: ItineraryItemTypeSchema,
    location: z.string().min(1).max(200),
    notes: z.string().max(4000),
    done: z.boolean(),
    order: z.number().int().nonnegative(),
    assigneeId: UuidV7Schema.nullable(),
    version: z.number().int().min(1),
    createdById: UuidV7Schema,
    updatedById: UuidV7Schema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type ItineraryItem = z.infer<typeof ItineraryItemSchema>;
