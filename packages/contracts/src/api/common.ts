import { z } from "zod";

import { UuidV7Schema } from "../common/ids";

export const MessageResponseSchema = z.object({ message: z.string().min(1) }).strict();
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const EmptyBodySchema = z.object({}).strict();

export const IdempotencyKeySchema = z.string().min(8).max(128);

export const BooleanQuerySchema = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean(),
);

export const WorkspaceParamsSchema = z.object({ workspaceId: UuidV7Schema });
export const TripParamsSchema = z.object({ tripId: UuidV7Schema });
export const EntryParamsSchema = z.object({ entryId: UuidV7Schema });
export const StopParamsSchema = z.object({ stopId: UuidV7Schema });
export const ItineraryItemParamsSchema = z.object({ itemId: UuidV7Schema });
export const CommentParamsSchema = z.object({ commentId: UuidV7Schema });
export const MediaParamsSchema = z.object({ mediaId: UuidV7Schema });
export const ExpenseParamsSchema = z.object({ expenseId: UuidV7Schema });
export const PackingItemParamsSchema = z.object({ itemId: UuidV7Schema });
export const ShareLinkParamsSchema = z.object({ shareLinkId: UuidV7Schema });
export const ExportParamsSchema = z.object({ exportId: UuidV7Schema });
export const MemberParamsSchema = z.object({ workspaceId: UuidV7Schema, memberId: UuidV7Schema });
export const InvitationParamsSchema = z.object({
  workspaceId: UuidV7Schema,
  invitationId: UuidV7Schema,
});
export const NotificationParamsSchema = z.object({ id: UuidV7Schema });
export const SessionParamsSchema = z.object({ id: UuidV7Schema });
export const RevisionParamsSchema = z.object({
  entryId: UuidV7Schema,
  revisionId: UuidV7Schema,
});
export const TripParticipantParamsSchema = z.object({
  tripId: UuidV7Schema,
  userId: UuidV7Schema,
});
export const AdminIdParamsSchema = z.object({ id: UuidV7Schema });
export const AdminFlagParamsSchema = z.object({ key: z.string().min(1).max(80) });
export const AdminContentParamsSchema = z.object({
  type: z.enum(["trip", "entry", "comment"]),
  id: UuidV7Schema,
});
export const AdminJobParamsSchema = z.object({
  queue: z.string().min(1).max(80),
  jobId: z.string().min(1).max(120),
});
