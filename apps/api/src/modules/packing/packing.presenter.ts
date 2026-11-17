import { PackingItemSchema, type PackingItem } from "@roamlog/contracts";

import { iso, nullableIso } from "../trips/content-values.js";
import type { PackingItemRecord } from "./packing-records.js";

export function presentPackingItem(record: PackingItemRecord): PackingItem {
  return PackingItemSchema.parse({
    ...record,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
  });
}
