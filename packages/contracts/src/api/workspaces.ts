import { z } from "zod";

import { DateOnlySchema, EmailSchema, UuidV7Schema } from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { ActivitySchema } from "../entities/activity";
import { AuditLogSchema } from "../entities/audit-log";
import { InvitationSchema } from "../entities/invitation";
import { MemberStatusSchema } from "../entities/enums";
import {
  WorkspaceMemberSchema,
  WorkspaceMemberWithUserSchema,
  WorkspaceSchema,
  WorkspaceSettingsSchema,
  WorkspaceWithRoleSchema,
} from "../entities/workspace";
import { WorkspaceRoleSchema } from "../permissions";
import { MessageResponseSchema } from "./common";

export const CreateWorkspaceRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    logoMediaId: UuidV7Schema.nullable().optional(),
    defaultCurrency: z.string().length(3).regex(/^[A-Z]{3}$/),
    timezone: z.string().min(1).max(64),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    settings: WorkspaceSettingsSchema.optional(),
  })
  .strict();
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>;

export const UpdateWorkspaceRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    logoMediaId: UuidV7Schema.nullable().optional(),
    defaultCurrency: z.string().length(3).regex(/^[A-Z]{3}$/).optional(),
    timezone: z.string().min(1).max(64).optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    settings: WorkspaceSettingsSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one workspace field is required.",
  });
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequestSchema>;

export const WorkspaceListResponseSchema = z.array(WorkspaceWithRoleSchema);
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;

export const WorkspaceMemberQuerySchema = CursorQuerySchema.extend({
  role: WorkspaceRoleSchema.optional(),
  status: MemberStatusSchema.optional(),
  q: z.string().max(120).optional(),
  sort: createSortSchema(["joinedAt", "name"]).optional(),
});
export type WorkspaceMemberQuery = z.infer<typeof WorkspaceMemberQuerySchema>;

export const WorkspaceMemberPageSchema = CursorPageSchema(WorkspaceMemberWithUserSchema);
export type WorkspaceMemberPage = z.infer<typeof WorkspaceMemberPageSchema>;

export const InviteMemberRequestSchema = z
  .object({
    email: EmailSchema,
    role: WorkspaceRoleSchema,
    message: z.string().max(1000).optional(),
  })
  .strict()
  .refine((value) => value.role !== "owner", {
    message: "Ownership cannot be granted through an invitation.",
    path: ["role"],
  });
export type InviteMemberRequest = z.infer<typeof InviteMemberRequestSchema>;

export const InvitationPageSchema = CursorPageSchema(InvitationSchema);
export type InvitationPage = z.infer<typeof InvitationPageSchema>;

export const InvitationListQuerySchema = CursorQuerySchema.extend({
  status: z.enum(["pending", "accepted", "revoked", "expired"]).optional(),
  sort: createSortSchema(["createdAt", "expiresAt"]).optional(),
});
export type InvitationListQuery = z.infer<typeof InvitationListQuerySchema>;

export const AcceptInvitationRequestSchema = z.object({}).strict();
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

export const AcceptInvitationResponseSchema = WorkspaceMemberSchema;
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>;

export const UpdateMemberRequestSchema = z
  .object({
    role: WorkspaceRoleSchema.optional(),
    status: MemberStatusSchema.optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "A role or status is required.",
  })
  .refine((value) => value.role !== "owner", {
    message: "Use the ownership transfer endpoint to assign owner.",
    path: ["role"],
  });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequestSchema>;

export const UpdateMemberResponseSchema = WorkspaceMemberWithUserSchema;
export type UpdateMemberResponse = z.infer<typeof UpdateMemberResponseSchema>;

export const TransferOwnershipRequestSchema = z.object({ toUserId: UuidV7Schema }).strict();
export type TransferOwnershipRequest = z.infer<typeof TransferOwnershipRequestSchema>;

export const TransferOwnershipResponseSchema = WorkspaceSchema;
export type TransferOwnershipResponse = z.infer<typeof TransferOwnershipResponseSchema>;

export const WorkspaceAuditQuerySchema = CursorQuerySchema.extend({
  action: z.string().max(120).optional(),
  actorId: UuidV7Schema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type WorkspaceAuditQuery = z.infer<typeof WorkspaceAuditQuerySchema>;

export const WorkspaceAuditPageSchema = CursorPageSchema(AuditLogSchema);
export type WorkspaceAuditPage = z.infer<typeof WorkspaceAuditPageSchema>;

export const WorkspaceActivityQuerySchema = CursorQuerySchema.extend({
  actorId: UuidV7Schema.optional(),
  entityType: z.string().max(60).optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type WorkspaceActivityQuery = z.infer<typeof WorkspaceActivityQuerySchema>;

export const WorkspaceActivityPageSchema = CursorPageSchema(ActivitySchema);
export type WorkspaceActivityPage = z.infer<typeof WorkspaceActivityPageSchema>;

export const DeleteWorkspaceResponseSchema = MessageResponseSchema;
export type DeleteWorkspaceResponse = z.infer<typeof DeleteWorkspaceResponseSchema>;

export const DeleteMemberResponseSchema = MessageResponseSchema;
export type DeleteMemberResponse = z.infer<typeof DeleteMemberResponseSchema>;

export const RevokeInvitationResponseSchema = MessageResponseSchema;
export type RevokeInvitationResponse = z.infer<typeof RevokeInvitationResponseSchema>;
