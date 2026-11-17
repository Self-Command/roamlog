import { describe, expect, it } from "vitest";

import {
  EXPORT_TTL_MS,
  canAccessExport,
  canDownloadExport,
  exportStorageKey,
  isExportExpired,
} from "../export-rules.js";

const NOW = new Date("2026-11-17T00:00:00.000Z");

describe("export access and expiry", () => {
  it("allows the requester and Workspace administrators but not viewers", () => {
    const record = { requestedById: "user-1" };
    expect(canAccessExport(record, "user-1")).toBe(true);
    expect(canAccessExport(record, "user-2", "owner")).toBe(true);
    expect(canAccessExport(record, "user-2", "admin")).toBe(true);
    expect(canAccessExport(record, "user-2", "editor")).toBe(false);
    expect(canAccessExport(record, "user-2", "viewer")).toBe(false);
  });

  it("only exposes a download URL while ready and inside the seven-day window", () => {
    const ready = {
      status: "ready" as const,
      storageKey: "exports/w/e/export.zip",
      expiresAt: new Date(NOW.getTime() + EXPORT_TTL_MS),
    };
    expect(canDownloadExport(ready, NOW)).toBe(true);
    expect(canDownloadExport({ ...ready, status: "processing" }, NOW)).toBe(false);
    expect(canDownloadExport({ ...ready, expiresAt: NOW }, NOW)).toBe(false);
    expect(isExportExpired({ expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(true);
  });

  it("uses a private export key scoped by workspace and export id", () => {
    expect(
      exportStorageKey({ workspaceId: "w1", exportId: "e1", format: "zip" }),
    ).toBe("exports/w1/e1/export.zip");
  });
});
