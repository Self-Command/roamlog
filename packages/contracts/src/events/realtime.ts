import { z } from "zod";

import { IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { ExportStatusSchema } from "../entities/enums";

export const PresenceUserSchema = z
  .object({
    userId: UuidV7Schema,
    name: z.string().min(1).max(120),
    image: z.url().nullable(),
    tripId: UuidV7Schema.nullable(),
    lastSeen: IsoTimestampSchema,
  })
  .strict();
export type PresenceUser = z.infer<typeof PresenceUserSchema>;

const envelope = {
  eventId: UuidV7Schema,
  occurredAt: IsoTimestampSchema,
  workspaceId: UuidV7Schema,
  tripId: UuidV7Schema.optional(),
};

const PresenceJoinedSchema = z
  .object({
    ...envelope,
    type: z.literal("presence.joined"),
    payload: z.object({ user: PresenceUserSchema }).strict(),
  })
  .strict();

const PresenceLeftSchema = z
  .object({
    ...envelope,
    type: z.literal("presence.left"),
    payload: z.object({ user: PresenceUserSchema }).strict(),
  })
  .strict();

const PresenceUpdatedSchema = z
  .object({
    ...envelope,
    type: z.literal("presence.updated"),
    payload: z.object({ users: z.array(PresenceUserSchema) }).strict(),
  })
  .strict();

const WorkspaceUpdatedSchema = z
  .object({
    ...envelope,
    type: z.literal("workspace.updated"),
    payload: z.object({ actorId: UuidV7Schema }).strict(),
  })
  .strict();

const MemberChangedSchema = z
  .object({
    ...envelope,
    type: z.literal("member.changed"),
    payload: z
      .object({
        actorId: UuidV7Schema,
        memberId: UuidV7Schema,
      })
      .strict(),
  })
  .strict();

const TripChangedSchema = z
  .object({
    ...envelope,
    tripId: UuidV7Schema,
    type: z.literal("trip.changed"),
    payload: z
      .object({
        actorId: UuidV7Schema,
        version: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

const EntryChangedSchema = z
  .object({
    ...envelope,
    tripId: UuidV7Schema,
    type: z.literal("entry.changed"),
    payload: z
      .object({
        actorId: UuidV7Schema,
        entryId: UuidV7Schema,
        version: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

const ItineraryChangedSchema = z
  .object({
    ...envelope,
    tripId: UuidV7Schema,
    type: z.literal("itinerary.changed"),
    payload: z
      .object({
        actorId: UuidV7Schema,
        itemId: UuidV7Schema,
        version: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

const CommentChangedSchema = z
  .object({
    ...envelope,
    tripId: UuidV7Schema,
    type: z.literal("comment.changed"),
    payload: z
      .object({
        actorId: UuidV7Schema,
        commentId: UuidV7Schema,
      })
      .strict(),
  })
  .strict();

const ExpenseChangedSchema = z
  .object({
    ...envelope,
    tripId: UuidV7Schema,
    type: z.literal("expense.changed"),
    payload: z
      .object({
        actorId: UuidV7Schema,
        expenseId: UuidV7Schema,
        version: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

const PackingChangedSchema = z
  .object({
    ...envelope,
    tripId: UuidV7Schema,
    type: z.literal("packing.changed"),
    payload: z
      .object({
        actorId: UuidV7Schema,
        itemId: UuidV7Schema,
        version: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

const MediaReadySchema = z
  .object({
    ...envelope,
    type: z.literal("media.ready"),
    payload: z.object({ mediaId: UuidV7Schema }).strict(),
  })
  .strict();

const NotificationCreatedSchema = z
  .object({
    ...envelope,
    type: z.literal("notification.created"),
    payload: z
      .object({
        userId: UuidV7Schema,
        notificationId: UuidV7Schema,
      })
      .strict(),
  })
  .strict();

const ActivityCreatedSchema = z
  .object({
    ...envelope,
    type: z.literal("activity.created"),
    payload: z
      .object({
        activityId: UuidV7Schema,
        actorId: UuidV7Schema,
        verb: z.string().min(1).max(80),
      })
      .strict(),
  })
  .strict();

const ExportUpdatedSchema = z
  .object({
    ...envelope,
    type: z.literal("export.updated"),
    payload: z
      .object({
        exportId: UuidV7Schema,
        status: ExportStatusSchema,
      })
      .strict(),
  })
  .strict();

export const RealtimeEventSchema = z.discriminatedUnion("type", [
  PresenceJoinedSchema,
  PresenceLeftSchema,
  PresenceUpdatedSchema,
  WorkspaceUpdatedSchema,
  MemberChangedSchema,
  TripChangedSchema,
  EntryChangedSchema,
  ItineraryChangedSchema,
  CommentChangedSchema,
  ExpenseChangedSchema,
  PackingChangedSchema,
  MediaReadySchema,
  NotificationCreatedSchema,
  ActivityCreatedSchema,
  ExportUpdatedSchema,
]);
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
