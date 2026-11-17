import { z } from "zod";

import { IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { NotificationTypeSchema } from "./enums";

export const NotificationSchema = z
  .object({
    id: UuidV7Schema,
    userId: UuidV7Schema,
    workspaceId: UuidV7Schema.nullable(),
    tripId: UuidV7Schema.nullable(),
    actorId: UuidV7Schema.nullable(),
    type: NotificationTypeSchema,
    title: z.string().min(1).max(180),
    body: z.string().max(2000),
    entityType: z.string().min(1).max(60).nullable(),
    entityId: UuidV7Schema.nullable(),
    readAt: IsoTimestampSchema.nullable(),
    emailedAt: IsoTimestampSchema.nullable(),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationPreferenceSchema = z
  .object({
    userId: UuidV7Schema,
    type: NotificationTypeSchema,
    inApp: z.boolean(),
    email: z.boolean(),
  })
  .strict();
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;
