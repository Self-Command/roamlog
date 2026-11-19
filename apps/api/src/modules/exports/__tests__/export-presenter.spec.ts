import { describe, expect, it } from "vitest";

import { ExportDetailSchema, ExportSchema } from "@roamlog/contracts";

import type { ExportRecord } from "../export-records.js";
import { presentExport, presentExportDetail } from "../export.presenter.js";

function validExportRow(): ExportRecord {
  return {
    id: "01942f30-1200-7000-8000-000000000001",
    workspaceId: "01942f30-1200-7000-8000-000000000002",
    tripId: null,
    requestedById: "01942f30-1200-7000-8000-000000000003",
    scope: "workspace",
    format: "zip",
    includeComments: false,
    includeExpenses: true,
    includeMedia: true,
    status: "queued",
    storageKey: null,
    bucket: "roamlog-bucket-a",
    error: null,
    expiresAt: null,
    createdAt: new Date("2026-11-19T08:00:00.000Z"),
    completedAt: null,
  };
}

/**
 * Regression guard: `ExportSchema` is `.strict()` and the presenter used to
 * spread the Prisma row into it. A new export column would 500
 * `GET /v1/exports` and `GET /v1/exports/{exportId}`.
 */
describe("presentExport ignores columns the contract does not declare", () => {
  it("does not throw or leak a future column", () => {
    const record = {
      ...validExportRow(),
      someFutureColumn: "x",
      moderatedAt: new Date("2026-11-19T08:00:00.000Z"),
    };

    const presented = presentExport(record);

    expect(() => presentExport(record)).not.toThrow();
    expect(ExportSchema.parse(presented)).toBeTruthy();
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented).not.toHaveProperty("moderatedAt");
  });

  it("detail keeps the download URL and ignores undeclared columns", () => {
    const record = {
      ...validExportRow(),
      status: "ready" as const,
      storageKey: "exports/w/e/export.zip",
      expiresAt: new Date("2026-11-26T08:00:00.000Z"),
      completedAt: new Date("2026-11-19T08:01:00.000Z"),
      someFutureColumn: "x",
    };
    const detail = presentExportDetail(record, "https://storage.example/signed");

    expect(() => ExportDetailSchema.parse(detail)).not.toThrow();
    expect(detail.downloadUrl).toBe("https://storage.example/signed");
    expect(detail).not.toHaveProperty("someFutureColumn");
  });

  it("reports expiry through overrides without rewriting the row", () => {
    const record = validExportRow();
    const detail = presentExportDetail(record, null, {
      status: "expired",
      error: "Export expired.",
    });

    expect(detail.status).toBe("expired");
    expect(detail.error).toBe("Export expired.");
    expect(record.status).toBe("queued");
    expect(record.error).toBeNull();
    expect(ExportDetailSchema.parse(detail)).toBeTruthy();
  });
});