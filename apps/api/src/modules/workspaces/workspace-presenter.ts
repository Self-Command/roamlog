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

import { presentUser, type UserRecordInput } from "../../common/services/user-presenter.js";

/*
 * Membership rows are presented through the contract schema directly.
 *
 * Up to MEMBER_UUID_CONTRACT this file carried a local `StoredUuidSchema` plus
 * a `WorkspaceMemberWithUserReadSchema` that re-declared four uuid fields as
 * PostgreSQL-shaped. That was a second copy of a rule the contract must own,
 * so it is gone: `WorkspaceMemberSchema` now encodes the PostgreSQL `uuid`
 * rule itself (`MembershipRecordUuidSchema` in
 * `packages/contracts/src/entities/workspace.ts`), and the presenter parses
 * with the one exported contract schema. Adding a read-side variant here again
 * would reintroduce the divergence guarded against in
 * `__tests__/workspace-presenter.spec.ts`.
 */

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
  return WorkspaceMemberWithUserSchema.parse({
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
