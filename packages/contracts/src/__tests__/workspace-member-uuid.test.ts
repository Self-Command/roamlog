import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemberParamsSchema } from "../api/common";
import {
  MembershipRecordUuidSchema,
  WorkspaceMemberSchema,
  WorkspaceMemberWithUserSchema,
} from "../entities/workspace";

/**
 * The value PostgreSQL really returns for a membership id written from the
 * legacy 32-hex form: canonical 8-4-4-4-12, but with variant nibble `f`, which
 * RFC 4122 forbids and `z.uuid()` therefore rejected. The `roamlog-crew`
 * Workspace holds rows that a fixture wrote as v4 (`83a7562c-…`), so the read
 * contract and the member route params must accept this wider shape.
 */
const PG_NORMALISED_VARIANT_F = "726d652a-fcfc-877c-f34f-593a6ec94c59";
const RFC_V4 = "83a7562c-4032-4de0-a33b-5ddc63b292ab";
const RFC_V7 = "0197e00d-0000-7000-8000-000000000001";

function memberRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "01942f30-1200-7000-8000-000000000201",
    workspaceId: "01942f30-1200-7000-8000-000000000101",
    userId: "01942f30-1200-7000-8000-000000000001",
    role: "editor",
    status: "active",
    joinedAt: "2026-11-17T08:00:00.000Z",
    invitedById: null,
    createdAt: "2026-11-17T08:00:00.000Z",
    updatedAt: "2026-11-17T08:00:00.000Z",
    ...overrides,
  };
}

describe("WorkspaceMemberSchema uuid contract", () => {
  it("accepts the v4 membership id a fixture wrote straight into PostgreSQL", () => {
    const parsed = WorkspaceMemberSchema.parse(memberRow({ id: RFC_V4 }));

    expect(parsed.id).toBe(RFC_V4);
    // Documents why this had to be widened: the v7 checker still rejects it.
    expect(z.uuid({ version: "v7" }).safeParse(RFC_V4).success).toBe(false);
    // …and so does the RFC checker for a PostgreSQL-normalised variant.
    expect(z.uuid().safeParse(PG_NORMALISED_VARIANT_F).success).toBe(false);
  });

  it("applies the widened rule to every uuid field of the row", () => {
    const parsed = WorkspaceMemberSchema.parse(
      memberRow({
        id: PG_NORMALISED_VARIANT_F,
        workspaceId: PG_NORMALISED_VARIANT_F,
        userId: PG_NORMALISED_VARIANT_F,
        invitedById: PG_NORMALISED_VARIANT_F,
      }),
    );

    expect(parsed.id).toBe(PG_NORMALISED_VARIANT_F);
    expect(parsed.workspaceId).toBe(PG_NORMALISED_VARIANT_F);
    expect(parsed.userId).toBe(PG_NORMALISED_VARIANT_F);
    expect(parsed.invitedById).toBe(PG_NORMALISED_VARIANT_F);
  });

  it("keeps accepting genuine RFC 4122 v4 and v7 values", () => {
    expect(WorkspaceMemberSchema.safeParse(memberRow({ id: RFC_V4 })).success).toBe(true);
    expect(WorkspaceMemberSchema.safeParse(memberRow({ id: RFC_V7 })).success).toBe(true);
  });

  it("still rejects anything a PostgreSQL uuid column could not return", () => {
    // 32 hyphenless hex digits are the *input* form, never the output form.
    for (const bad of [
      "83a7562c40324de0a33b5ddc63b292ab",
      "not-a-uuid",
      "83a7562c-4032-4de0-a33b-5ddc63b292a",
      "83a7562c-4032-4de0-a33b-5ddc63b292az",
      "",
    ]) {
      expect(WorkspaceMemberSchema.safeParse(memberRow({ id: bad })).success, bad).toBe(false);
    }
  });

  it("keeps the strict envelope: unknown keys are still rejected", () => {
    expect(WorkspaceMemberSchema.safeParse({ ...memberRow(), unexpected: true }).success).toBe(
      false,
    );
  });

  it("keeps nullability and the field set unchanged", () => {
    const parsed = WorkspaceMemberSchema.parse(memberRow({ invitedById: null }));
    expect(parsed.invitedById).toBeNull();

    // `invitedById` is nullable, not optional: the column is still present.
    expect(WorkspaceMemberSchema.safeParse(memberRow({ invitedById: undefined })).success).toBe(
      false,
    );

    expect(Object.keys(WorkspaceMemberSchema.shape)).toEqual([
      "id",
      "workspaceId",
      "userId",
      "role",
      "status",
      "joinedAt",
      "invitedById",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("is the one rule: the with-user projection reuses the same uuid schemas", () => {
    expect(MembershipRecordUuidSchema).toBe(WorkspaceMemberSchema.shape.id);
    expect(WorkspaceMemberWithUserSchema.shape.id).toBe(WorkspaceMemberSchema.shape.id);
    expect(WorkspaceMemberWithUserSchema.shape.workspaceId).toBe(
      WorkspaceMemberSchema.shape.workspaceId,
    );
    expect(WorkspaceMemberWithUserSchema.shape.userId).toBe(WorkspaceMemberSchema.shape.userId);
    expect(WorkspaceMemberWithUserSchema.shape.invitedById).toBe(
      WorkspaceMemberSchema.shape.invitedById,
    );
    expect(Object.keys(WorkspaceMemberWithUserSchema.shape)).toHaveLength(10);
  });
});

describe("MemberParamsSchema", () => {
  it("accepts a v4 memberId so PATCH/DELETE can address a legacy row", () => {
    const parsed = MemberParamsSchema.parse({
      workspaceId: RFC_V7,
      memberId: RFC_V4,
    });

    expect(parsed.memberId).toBe(RFC_V4);
  });

  it("still requires a uuid for memberId and a UUIDv7 for workspaceId", () => {
    expect(
      MemberParamsSchema.safeParse({
        workspaceId: RFC_V7,
        memberId: "83a7562c40324de0a33b5ddc63b292ab",
      }).success,
    ).toBe(false);
    // Workspace rows are minted by the API and the tenant guard re-validates
    // this id, so the path param stays strict.
    expect(
      MemberParamsSchema.safeParse({ workspaceId: RFC_V4, memberId: RFC_V4 }).success,
    ).toBe(false);
  });
});