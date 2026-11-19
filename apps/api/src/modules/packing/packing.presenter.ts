import { PackingItemSchema, type PackingItem } from "@roamlog/contracts";

import { iso, nullableIso } from "../trips/content-values.js";
import type { PackingItemRecord } from "./packing-records.js";

/**
 * Explicit field list — the database row is never spread into the contract.
 * The row carries columns the public contract does not declare (and will keep
 * gaining them), while `PackingItemSchema` is `.strict()`. Spreading a row here
 * used to turn every additive migration into a 500 on
 * `GET /v1/trips/{tripId}/packing`.
 */
export function presentPackingItem(record: PackingItemRecord): PackingItem {
  return PackingItemSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    tripId: record.tripId,
    category: record.category,
    name: record.name,
    quantity: record.quantity,
    packed: record.packed,
    assigneeId: record.assigneeId,
    order: record.order,
    createdById: record.createdById,
    updatedById: record.updatedById,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
    version: record.version,
  });
}
