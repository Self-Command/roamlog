import { WorkspaceMemberWithUserSchema } from "@roamlog/contracts";
import { ZodError } from "zod";
import { describe, expect, it } from "vitest";

import * as presenterModule from "../workspace-presenter.js";
import { presentMember } from "../workspace-presenter.js";

const NOW = new Date("2026-11-17T08:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "01942f30-1200-7000-8000-000000000201",
    workspaceId: "01942f30-1200-7000-8000-000000000101",
    userId: "01942f30-1200-7000-8000-000000000001",
    role: "editor",
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    user: {
      id: "01942f30-1200-7000-8000-000000000001",
      email: "member@roamlog.test",
      emailVerified: true,
      name: "Member",
      image: null,
      platformRole: "user",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      lastActiveAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
    ...overrides,
  };
}

describe("presentMember", () => {
  /**
   * MEMBER_UUID_CONTRACT: `workspace-presenter.ts` used to declare a local
   * `StoredUuidSchema` plus `WorkspaceMemberWithUserReadSchema` — a second copy
   * of a rule the contract must own (the `AuditLogReadSchema` / `AuditLogSchema`
   * split that `apps/api/src/modules/audit/audit-read.ts` had already collapsed).
   * The local schemas are gone; this guard fails if a read-side variant comes
   * back, and the round-trip below proves the presentation is produced by the
   * one exported contract schema.
   */
  it("has no second membership read schema", () => {
    expect(Object.keys(presenterModule)).not.toContain("WorkspaceMemberWithUserReadSchema");
    expect(Object.keys(presenterModule)).not.toContain("StoredUuidSchema");
  });

  it("presents exactly what the contract schema parses", () => {
    const presented = presentMember(row());
    expect(WorkspaceMemberWithUserSchema.parse(presented)).toEqual(presented);
  });

  it("keeps the contract shape for a UUIDv7 row", () => {
    const member = presentMember(row());
    expect(member.id).toBe("01942f30-1200-7000-8000-000000000201");
    expect(member.user.email).toBe("member@roamlog.test");
  });

  /**
   * MEMBERS_500: the seeded `roamlog-crew` workspace holds membership rows that
   * a fixture script created with a v4 id. The PostgreSQL `uuid` column accepts
   * them, the contract's `UuidV7Schema` did not, and the resulting `ZodError`
   * turned `GET /v1/workspaces/:id/members` into a 500.
   */
  it("reads a member whose stored uuid is not version 7", () => {
    const member = presentMember(
      row({ id: "83a7562c-4032-4de0-a33b-5ddc63b292ab", role: "viewer" }),
    );
    expect(member.id).toBe("83a7562c-4032-4de0-a33b-5ddc63b292ab");
    expect(member.role).toBe("viewer");
  });

  it("accepts the canonical PostgreSQL form for any referenced uuid", () => {
    const member = presentMember(
      row({
        id: "e7aa8557-6e54-45f8-b8cf-b2735314cdce",
        workspaceId: "83a7562c-4032-4de0-a33b-5ddc63b292ab",
        userId: "f7aa8557-6e54-45f8-b8cf-b2735314cdce",
        invitedById: "f7aa8557-6e54-45f8-b8cf-b2735314cdce",
      }),
    );
    expect(member.invitedById).toBe("f7aa8557-6e54-45f8-b8cf-b2735314cdce");
  });

  it("still rejects an id that is not a uuid at all", () => {
    expect(() => presentMember(row({ id: "not-a-uuid" }))).toThrow(ZodError);
    expect(() => presentMember(row({ id: "83a7562c40324de0a33b5ddc63b292ab" }))).toThrow(
      ZodError,
    );
  });

  it("still rejects a user whose fields violate the contract", () => {
    expect(() =>
      presentMember(row({ user: { ...row().user, name: "", email: "not-an-email" } })),
    ).toThrow(ZodError);
  });
});