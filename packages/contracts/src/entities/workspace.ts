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

/**
 * Membership rows are read back from PostgreSQL, and a PostgreSQL `uuid`
 * column is wider than UUIDv7: it accepts any 128-bit value and canonicalises
 * it to 8-4-4-4-12 hex **without** rewriting the version or variant nibbles.
 * `WorkspaceMember.id` gets its `@default(uuid(7))` from the Prisma client, not
 * from a column default, so a row written outside Prisma — fixture/seed
 * scripts, raw SQL, imports — can carry a v4 id (or the legacy normalised
 * variant `f` form). Pinning these fields to `UuidV7Schema` made one such row
 * throw a `ZodError`, which turned the whole `GET /v1/workspaces/:id/members`
 * page into a 500 and made `PATCH`/`DELETE /members/:memberId` answer 400 for a
 * row the database happily stores and returns.
 *
 * The rule below is PostgreSQL's `uuid` rule, not RFC 4122's — the same rule
 * `AuditRecordUuidSchema` in `./audit-log.ts` already encodes for audit rows.
 * It widens *format* validation only: the field set, `.strict()`, and
 * nullability are untouched, and it grants nothing — route guards and the
 * membership/role checks still decide who may mutate which row. New rows keep
 * being minted as UUIDv7.
 */
export const MembershipRecordUuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID",
  )
  .describe("PostgreSQL uuid: 8-4-4-4-12 hex, any version/variant (legacy rows included).");

export const WorkspaceMemberSchema = z
  .object({
    id: MembershipRecordUuidSchema,
    workspaceId: MembershipRecordUuidSchema,
    userId: MembershipRecordUuidSchema,
    role: WorkspaceRoleSchema,
    status: MemberStatusSchema,
    joinedAt: IsoTimestampSchema,
    invitedById: MembershipRecordUuidSchema.nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const WorkspaceMemberWithUserSchema = WorkspaceMemberSchema.extend({
  user: UserSchema,
});
export type WorkspaceMemberWithUser = z.infer<typeof WorkspaceMemberWithUserSchema>;
