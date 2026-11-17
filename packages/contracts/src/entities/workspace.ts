import { z } from "zod";

import { IsoTimestampSchema, SlugSchema, UuidV7Schema } from "../common/ids";
import { CurrencyCodeSchema } from "../common/money";
import { WorkspaceRoleSchema } from "../permissions";
import { AccountStatusSchema, MemberStatusSchema, TripVisibilitySchema, WorkspacePlanSchema } from "./enums";
import { UserSchema } from "./user";

export const WorkspaceSettingsSchema = z
  .object({
    defaultVisibility: TripVisibilitySchema.optional(),
    notificationDefaults: z
      .object({
        inApp: z.boolean(),
        email: z.boolean(),
      })
      .strict()
      .optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
  })
  .strict();
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const WorkspaceSchema = z
  .object({
    id: UuidV7Schema,
    name: z.string().min(1).max(120),
    slug: SlugSchema,
    logoMediaId: UuidV7Schema.nullable(),
    ownerId: UuidV7Schema,
    plan: WorkspacePlanSchema,
    status: AccountStatusSchema,
    defaultCurrency: CurrencyCodeSchema,
    timezone: z.string().min(1).max(64),
    weekStartsOn: z.number().int().min(0).max(6),
    settings: WorkspaceSettingsSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceWithRoleSchema = WorkspaceSchema.extend({
  role: WorkspaceRoleSchema,
});
export type WorkspaceWithRole = z.infer<typeof WorkspaceWithRoleSchema>;

export const WorkspaceMemberSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    userId: UuidV7Schema,
    role: WorkspaceRoleSchema,
    status: MemberStatusSchema,
    joinedAt: IsoTimestampSchema,
    invitedById: UuidV7Schema.nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const WorkspaceMemberWithUserSchema = WorkspaceMemberSchema.extend({
  user: UserSchema,
});
export type WorkspaceMemberWithUser = z.infer<typeof WorkspaceMemberWithUserSchema>;
