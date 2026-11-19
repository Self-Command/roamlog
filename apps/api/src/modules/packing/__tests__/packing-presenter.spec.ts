import { describe, expect, it } from "vitest";

import { PackingItemSchema } from "@roamlog/contracts";

import type { PackingItemRecord } from "../packing-records.js";
import { presentPackingItem } from "../packing.presenter.js";

function validPackingRow(): PackingItemRecord {
  return {
    id: "01942f30-1200-7000-8000-000000000001",
    workspaceId: "01942f30-1200-7000-8000-000000000002",
    tripId: "01942f30-1200-7000-8000-000000000003",
    category: "gear",
    name: "Camera",
    quantity: 1,
    packed: false,
    assigneeId: null,
    order: 0,
    createdById: "01942f30-1200-7000-8000-000000000004",
    updatedById: "01942f30-1200-7000-8000-000000000004",
    createdAt: new Date("2026-11-19T08:00:00.000Z"),
    updatedAt: new Date("2026-11-19T08:00:00.000Z"),
    deletedAt: null,
    version: 1,
  };
}

/**
 * Regression guard: `PackingItemSchema` is `.strict()` and the presenter used
 * to spread the Prisma row into it. Any additive column on `PackingItem` would
 * then fail validation and 500 `GET /v1/trips/{tripId}/packing`.
 */
describe("presentPackingItem ignores columns the contract does not declare", () => {
  it("does not throw or leak a future column", () => {
    const record = {
      ...validPackingRow(),
      someFutureColumn: "x",
      moderatedAt: new Date("2026-11-19T08:00:00.000Z"),
    };

    const presented = presentPackingItem(record);

    expect(() => presentPackingItem(record)).not.toThrow();
    expect(PackingItemSchema.parse(presented)).toBeTruthy();
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented).not.toHaveProperty("moderatedAt");
  });

  it("keeps nullable columns present as null", () => {
    const presented = presentPackingItem(validPackingRow());

    expect(presented.assigneeId).toBeNull();
    expect(presented.deletedAt).toBeNull();
    expect(PackingItemSchema.parse(presented)).toEqual(presented);
  });
});