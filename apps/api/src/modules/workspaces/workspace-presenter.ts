import {
  InvitationSchema,
  WorkspaceMemberWithUserSchema,
  WorkspaceSchema,
  WorkspaceSettingsSchema,
  WorkspaceWithRoleSchema,
  type Invitation,
  type Workspace,
  type WorkspaceMemberWithUser,
  type WorkspaceRole,
  type WorkspaceWithRole,
} from "@roamlog/contracts";
import { z } from "zod";

import { presentUser, type UserRecordInput } from "../../common/services/user-presenter.js";

/**
 * Read-side UUID rule for Workspace membership rows.
 *
 * `WorkspaceMemberSchema` pins every id to `UuidV7Schema`, because that is what
 * `@default(uuid(7))` mints. A PostgreSQL `uuid` column is wider than that: it
 * stores any 128-bit value and returns the canonical 8-4-4-4-12 form without
 * rewriting the version nibble. Rows created outside Prisma — fixture/seed
 * scripts, raw SQL, imports — can therefore carry a v4 id, and the strict read
 * schema then threw a `ZodError` for the whole page:
 *
 *   GET /v1/workspaces/:id/members -> 500 INTERNAL_SERVER_ERROR
 *
 * The failing rows were two members added to the seeded `roamlog-crew`
 * workspace by an e2e fixture script. Every other field, and every *request*
 * schema (`MemberParamsSchema`, `WorkspaceMemberQuerySchema`), still enforces
 * UUIDv7: only reading an existing row is tolerant, mirroring
 * `AuditRecordUuidSchema` in `packages/contracts/src/entities/audit-log.ts`.
 */
const StoredUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid UUID")
  .describe("PostgreSQL uuid: 8-4-4-4-12 hex, any version/variant (non-Prisma rows included).");

export const WorkspaceMemberWithUserReadSchema = WorkspaceMemberWithUserSchema.extend({
  id: StoredUuidSchema,
  workspaceId: StoredUuidSchema,
  userId: StoredUuidSchema,
  invitedById: StoredUuidSchema.nullable(),
});

export interface WorkspaceRecordInput {
  id: string;
  name: string;
  slug: string;
  logoMediaId: string | null;
  ownerId: string;
  plan: string;
  status: string;
  defaultCurrency: string;
  timezone: string;
  weekStartsOn: number;
  settings: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

export interface MembershipRecordInput {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: Date | string;
  invitedById: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface MembershipWithUserRecordInput extends MembershipRecordInput {
  user: UserRecordInput;
}

export interface InvitationRecordInput {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  invitedById: string;
  expiresAt: Date | string;
  acceptedAt: Date | string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

export function presentWorkspace(record: WorkspaceRecordInput): Workspace {
  const settings = WorkspaceSettingsSchema.safeParse(record.settings);
  return WorkspaceSchema.parse({
    id: record.id,
    name: record.name,
    slug: record.slug,
    logoMediaId: record.logoMediaId,
    ownerId: record.ownerId,
    plan: record.plan,
    status: record.status,
    defaultCurrency: record.defaultCurrency,
    timezone: record.timezone,
    weekStartsOn: record.weekStartsOn,
    settings: settings.success ? settings.data : {},
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
  });
}

export function presentWorkspaceWithRole(
  record: WorkspaceRecordInput,
  role: WorkspaceRole,
): WorkspaceWithRole {
  return WorkspaceWithRoleSchema.parse({
    ...presentWorkspace(record),
    role,
  });
}

export function presentMember(record: MembershipWithUserRecordInput): WorkspaceMemberWithUser {
  return WorkspaceMemberWithUserReadSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    userId: record.userId,
    role: record.role,
    status: record.status,
    joinedAt: iso(record.joinedAt),
    invitedById: record.invitedById,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    user: presentUser(record.user),
  });
}

export function presentInvitation(record: InvitationRecordInput): Invitation {
  return InvitationSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    email: record.email,
    role: record.role,
    invitedById: record.invitedById,
    expiresAt: iso(record.expiresAt),
    acceptedAt: nullableIso(record.acceptedAt),
    revokedAt: nullableIso(record.revokedAt),
    createdAt: iso(record.createdAt),
  });
}
