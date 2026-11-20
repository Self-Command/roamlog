import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AuditLogSchema } from "../entities/audit-log";

/**
 * The real value PostgreSQL stored for `AuditLog.targetId` when a writer handed
 * it the legacy 32-hyphenless-hex `runId`: canonicalised to 8-4-4-4-12 but with
 * variant nibble `f`, which RFC 4122 forbids. Ten such immutable `ai.tool_call`
 * rows exist, so the read contract must accept this shape.
 */
const PG_NORMALISED_VARIANT_F = "726d652a-fcfc-877c-f34f-593a6ec94c59";
const RFC_V4 = "550e8400-e29b-41d4-a716-446655440000";
const RFC_V7 = "0197e00d-0000-7000-8000-000000000001";

function auditRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "01a1f7f7-42b3-75d3-9e74-273039e92fec",
    actorId: null,
    actorType: "system",
    action: "ai.tool_call",
    targetType: "ai_tool",
    targetId: PG_NORMALISED_VARIANT_F,
    workspaceId: null,
    ip: null,
    userAgent: null,
    metadata: {},
    createdAt: "2026-11-19T05:00:00.000Z",
    ...overrides,
  };
}

describe("AuditLogSchema", () => {
  it("accepts the PostgreSQL-normalised non-RFC uuid a legacy writer produced", () => {
    const parsed = AuditLogSchema.parse(auditRow());

    expect(parsed.targetId).toBe(PG_NORMALISED_VARIANT_F);
    // Documents why this had to be widened: the RFC checker still rejects it.
    expect(z.uuid().safeParse(PG_NORMALISED_VARIANT_F).success).toBe(false);
  });

  it("applies the widened rule to every uuid field, not just targetId", () => {
    const parsed = AuditLogSchema.parse(
      auditRow({
        id: PG_NORMALISED_VARIANT_F,
        actorId: PG_NORMALISED_VARIANT_F,
        workspaceId: PG_NORMALISED_VARIANT_F,
      }),
    );

    expect(parsed.id).toBe(PG_NORMALISED_VARIANT_F);
    expect(parsed.actorId).toBe(PG_NORMALISED_VARIANT_F);
    expect(parsed.workspaceId).toBe(PG_NORMALISED_VARIANT_F);
  });

  it("keeps accepting genuine RFC 4122 v4 and v7 values", () => {
    expect(AuditLogSchema.safeParse(auditRow({ targetId: RFC_V4 })).success).toBe(true);
    expect(AuditLogSchema.safeParse(auditRow({ targetId: RFC_V7 })).success).toBe(true);
  });

  it("still rejects anything a PostgreSQL uuid column could not return", () => {
    // 32 hyphenless hex digits are the *input* form, never the output form.
    expect(
      AuditLogSchema.safeParse(auditRow({ targetId: "726d652afcfc877cf34f593a6ec94c59" })).success,
    ).toBe(false);
    expect(AuditLogSchema.safeParse(auditRow({ targetId: "not-a-uuid" })).success).toBe(false);
    expect(
      AuditLogSchema.safeParse(auditRow({ targetId: "726d652a-fcfc-877c-f34f-593a6ec94c5" }))
        .success,
    ).toBe(false);
    expect(
      AuditLogSchema.safeParse(auditRow({ targetId: "726d652a-fcfc-877c-f34f-593a6ec94c5z" }))
        .success,
    ).toBe(false);
  });

  it("keeps the strict envelope: unknown keys are still rejected", () => {
    expect(AuditLogSchema.safeParse({ ...auditRow(), unexpected: true }).success).toBe(false);
  });

  it("keeps nullability unchanged: null uuid fields stay allowed", () => {
    const parsed = AuditLogSchema.parse(auditRow({ actorId: null, workspaceId: null }));

    expect(parsed.actorId).toBeNull();
    expect(parsed.workspaceId).toBeNull();
  });
});