import { z } from "zod";

import { IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { CommentTargetTypeSchema } from "./enums";

export const CommentSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema,
    targetType: CommentTargetTypeSchema,
    targetId: UuidV7Schema,
    parentId: UuidV7Schema.nullable(),
    authorId: UuidV7Schema,
    body: z.string().min(1).max(10_000),
    resolvedAt: IsoTimestampSchema.nullable(),
    resolvedById: UuidV7Schema.nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type Comment = z.infer<typeof CommentSchema>;

export const CommentMentionSchema = z
  .object({
    workspaceId: UuidV7Schema,
    commentId: UuidV7Schema,
    userId: UuidV7Schema,
  })
  .strict();
export type CommentMention = z.infer<typeof CommentMentionSchema>;
