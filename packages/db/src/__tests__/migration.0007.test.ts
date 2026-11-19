import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0007_stop_provider_geoapify";
const migrationPath = `${migrationsDir}/${migrationName}/migration.sql`;

const rawSql = readFileSync(migrationPath, "utf8");
const sql = rawSql
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .trim();

describe("0007_stop_provider_geoapify migration", () => {
  it("sorts after the migrations it builds on", () => {
    const index = migrations.indexOf(migrationName);
    expect(index).toBeGreaterThan(0);
    for (const earlier of ["0001_init", "0002_two_factor_state", "0003_w0_trip_stop_place_metadata", "0004_system_setting", "0005_platform_role_override", "0006_trip_stop_address_bbox"]) {
      expect(migrations.indexOf(earlier), earlier).toBeGreaterThanOrEqual(0);
      expect(migrations.indexOf(earlier), earlier).toBeLessThan(index);
    }
  });

  it("replaces the provider allow-list in place, retaining the constraint name", () => {
    // The old constraint is dropped, not duplicated: two CHECKs with the same
    // name cannot coexist, and a second differently-named one would make the
    // contract ambiguous.
    expect(sql).toContain('ALTER TABLE "Stop" DROP CONSTRAINT "Stop_provider_check"');
    expect(sql).toContain('ALTER TABLE "Stop" ADD CONSTRAINT "Stop_provider_check"');
    expect(sql).toContain(
      "CHECK (\"provider\" IS NULL OR \"provider\" IN ('geoapify', 'photon', 'local'))",
    );
    expect(sql.match(/ADD CONSTRAINT "Stop_provider_check"/g)).toHaveLength(1);
    expect(sql.match(/DROP CONSTRAINT "Stop_provider_check"/g)).toHaveLength(1);
    // The drop must precede the add so the sequence never ends without a check.
    expect(sql.indexOf("DROP CONSTRAINT")).toBeLessThan(sql.indexOf("ADD CONSTRAINT"));
  });

  it("is constraint-only: no column, type or data change", () => {
    expect(sql).not.toMatch(/\bADD\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bSET\s+(NOT\s+NULL|DEFAULT)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"Stop"\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+(UNIQUE\s+)?INDEX\b/i);
    // The constraint is validated immediately; otherwise bad existing rows
    // would only surface on a later write.
    expect(sql).not.toMatch(/NOT\s+VALID/i);
  });
});
