import { ExportSchema, type Export, type ExportDetail } from "@roamlog/contracts";

import { iso, nullableIso } from "../trips/content-values.js";
import type { ExportRecord } from "./export-records.js";

/** Response-only status/error values that must not be written back to the row. */
export interface PresentExportOverrides {
  status?: Export["status"];
  error?: string | null;
}

/**
 * Explicit field list — the Prisma row is never spread into the contract.
 * `ExportSchema` is `.strict()`, so any column added to `Export` (or any future
 * column on the table) would otherwise fail validation and 500 `GET /v1/exports`.
 */
export function presentExport(
  record: ExportRecord,
  overrides: PresentExportOverrides = {},
): Export {
  return ExportSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    tripId: record.tripId,
    requestedById: record.requestedById,
    scope: record.scope,
    format: record.format,
    includeComments: record.includeComments,
    includeExpenses: record.includeExpenses,
    includeMedia: record.includeMedia,
    status: overrides.status ?? record.status,
    storageKey: record.storageKey,
    error: overrides.error ?? record.error,
    expiresAt: nullableIso(record.expiresAt),
    createdAt: iso(record.createdAt),
    completedAt: nullableIso(record.completedAt),
  });
}

export function presentExportDetail(
  record: ExportRecord,
  downloadUrl: string | null,
  overrides: PresentExportOverrides = {},
): ExportDetail {
  return {
    ...presentExport(record, overrides),
    downloadUrl,
  };
}
