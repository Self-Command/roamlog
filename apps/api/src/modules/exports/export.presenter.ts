import { ExportSchema, type Export, type ExportDetail } from "@roamlog/contracts";

import { iso, nullableIso } from "../trips/content-values.js";
import type { ExportRecord } from "./export-records.js";

export function presentExport(record: ExportRecord): Export {
  return ExportSchema.parse({
    ...record,
    expiresAt: nullableIso(record.expiresAt),
    createdAt: iso(record.createdAt),
    completedAt: nullableIso(record.completedAt),
  });
}

export function presentExportDetail(
  record: ExportRecord,
  downloadUrl: string | null,
): ExportDetail {
  return {
    ...presentExport(record),
    downloadUrl,
  };
}
