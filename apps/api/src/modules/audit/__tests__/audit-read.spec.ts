import { AuditLogSchema } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AuditLogReadSchema } from "../audit-read.js";

const PG_UUID = "726d652a-fcfc-877c-f34f-593a6ec94c59";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "019b798c-e5dc-709f-935e-1a9f420b208c",
    actorId: "019b7b7d-2e02-7a5d-ab91-f6f211e0b8b3",
    actorType: "user",
    action: "expense.custom_split.saved",
    targetType: "expense",
    targetId: "019b7cca-489a-7b9f-a3d8-3bc3e864448c",
    workspaceId: "019b7946-1c12-72e5-b2f5-ba152dee90d6",
    ip: "127.0.0.1",
    userAgent: "vitest",
    metadata: { currency: "JPY" },
    createdAt: "2026-11-27T10:16:00.000Z",
    ...overrides,
  };
}

describe("AuditLogReadSchema", () => {
  it("accepts a canonical UUIDv7 audit row", () => {
    expect(AuditLogReadSchema.safeParse(row()).success).toBe(true);
    expect(AuditLogSchema.safeParse(row()).success).toBe(true);
  });

  it("accepts a PostgreSQL uuid that RFC 4122 rejects as targetId", () => {
    const legacy = row({ targetId: PG_UUID });

    // The contract now encodes what the column actually stores, so the read
    // path accepts it. RFC 4122 rejects this value, which is exactly how the
    // whole admin audit page used to become a 500.
    expect(z.uuid().safeParse(PG_UUID).success).toBe(false);
    expect(AuditLogSchema.safeParse(legacy).success).toBe(true);
    const parsed = AuditLogReadSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.targetId).toBe(PG_UUID);
  });

  it("is the contract itself: the read rule has a single source of truth", () => {
    // Guards the convergence: a second, locally-defined uuid rule must not
    // reappear here, because a divergence between writer and reader contracts
    // is how the audit page broke in the first place.
    expect(AuditLogReadSchema).toBe(AuditLogSchema);
  });

  it("accepts a non-RFC uuid in every uuid reference, still rejecting junk", () => {
    expect(
      AuditLogReadSchema.safeParse(
        row({ id: PG_UUID, actorId: PG_UUID, workspaceId: PG_UUID, targetId: PG_UUID }),
      ).success,
    ).toBe(true);

    for (const bad of [
      "",
      "726d652afcfc877cf34f593a6ec94c59",
      "726d652a-fcfc-877c-f34f",
      "zzzzzzzz-fcfc-877c-f34f-593a6ec94c59",
      null,
    ]) {
      expect(AuditLogReadSchema.safeParse(row({ targetId: bad })).success).toBe(false);
    }
  });

  it("keeps the contract's strict unknown-key rejection", () => {
    expect(AuditLogReadSchema.safeParse(row({ unknownColumn: true })).success).toBe(false);
  });
});