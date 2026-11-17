import type { WorkspaceRole } from "@roamlog/contracts";

import type { ExportRecord } from "./export-records.js";

export const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function canAccessExport(
  record: Pick<ExportRecord, "requestedById">,
  userId: string,
  role?: WorkspaceRole | null,
): boolean {
  return record.requestedById === userId || role === "owner" || role === "admin";
}

export function isExportExpired(
  record: Pick<ExportRecord, "expiresAt">,
  now: Date = new Date(),
): boolean {
  return record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime();
}

export function canDownloadExport(
  record: Pick<ExportRecord, "status" | "storageKey" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  return (
    record.status === "ready" &&
    typeof record.storageKey === "string" &&
    record.storageKey.length > 0 &&
    record.expiresAt !== null &&
    !isExportExpired(record, now)
  );
}

export function exportStorageKey(args: {
  workspaceId: string;
  exportId: string;
  format: "zip" | "json";
}): string {
  return `exports/${args.workspaceId}/${args.exportId}/export.${args.format}`;
}
