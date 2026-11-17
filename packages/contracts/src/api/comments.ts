import { z } from "zod";

import { UuidV7Schema } from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { CommentSchema, CommentMentionSchema } from "../entities/comment";
import { CommentTargetTypeSchema } from "../entities/enums";
import { MessageResponseSchema } from "./common";

export const CommentTargetQuerySchema = CursorQuerySchema.extend({
  targetType: CommentTargetTypeSchema,
  targetId: UuidV7Schema,
  sort: createSortSchema(["createdAt"]).optional(),
});
export type CommentTargetQuery = z.infer<typeof CommentTargetQuerySchema>;

export const CommentPageSchema = CursorPageSchema(CommentSchema);
export type CommentPage = z.infer<typeof CommentPageSchema>;

export const CreateCommentRequestSchema = z
  .object({
    tripId: UuidV7Schema,
    targetType: CommentTargetTypeSchema,
    targetId: UuidV7Schema,
    parentId: UuidV7Schema.nullable().optional(),
    body: z.string().min(1).max(10_000),
    mentionUserIds: z.array(UuidV7Schema).max(50).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.mentionUserIds === undefined ||
      new Set(value.mentionUserIds).size === value.mentionUserIds.length,
    { message: "Mentioned users must be unique.", path: ["mentionUserIds"] },
  );
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;

export const UpdateCommentRequestSchema = z.object({ body: z.string().min(1).max(10_000) }).strict();
export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequestSchema>;

export const CommentMentionListResponseSchema = z.array(CommentMentionSchema);
export type CommentMentionListResponse = z.infer<typeof CommentMentionListResponseSchema>;

export const DeleteCommentResponseSchema = MessageResponseSchema;
export type DeleteCommentResponse = z.infer<typeof DeleteCommentResponseSchema>;
