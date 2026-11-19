import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0011_export_bucket";
const rawSql = readFileSync(`${migrationsDir}/${migrationName}/migration.sql`, "utf8");
const sql = rawSql
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const schema = readFileSync(
  fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)),
  "utf8",
);

function exportModelBody(): string {
  const match = schema.match(/model Export \{([\s\S]*?)\n\}/);
  if (!match) {
    throw new Error("Export model not found in schema.prisma");
  }
  return match[1] ?? "";
}

describe("0011_export_bucket migration", () => {
  it("is the newest migration and follows the published chain", () => {
    expect(migrations.indexOf(migrationName)).toBe(10);
    expect(migrations.slice(0, 10)).toEqual([
      "0001_init",
      "0002_two_factor_state",
      "0003_w0_trip_stop_place_metadata",
      "0004_system_setting",
      "0005_platform_role_override",
      "0006_trip_stop_address_bbox",
      "0007_stop_provider_geoapify",
      "0008_report_moderation",
      "0009_media_motion",
      "0010_trip_destinations",
    ]);
  });

  it("adds one nullable bucket column to Export", () => {
    expect(sql).toContain('ALTER TABLE "Export" ADD COLUMN "bucket" TEXT');
    // Nullable: no NOT NULL, no DEFAULT. Historical rows must migrate as NULL.
    expect(sql).not.toMatch(/"bucket"\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).not.toMatch(/"bucket"\s+TEXT\s+DEFAULT/i);
  });

  it("keeps NULL legal but rejects an empty recorded bucket", () => {
    expect(sql).toContain(
      'CONSTRAINT "Export_bucket_check" CHECK ("bucket" IS NULL OR length("bucket") BETWEEN 1 AND 255)',
    );
  });

  it("is additive: nothing existing is rewritten or dropped", () => {
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bSET\s+(NOT\s+NULL|DEFAULT)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"/i);
    // The only table touched is Export; no Media/other table is modified.
    const alteredTables = [...sql.matchAll(/ALTER\s+TABLE\s+"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(alteredTables)).toEqual(new Set(["Export"]));
  });

  it("keeps the Prisma model in step with the SQL", () => {
    const body = exportModelBody();
    expect(body).toMatch(/bucket\s+String\?/);
    expect(body).not.toMatch(/bucket\s+String\s+@/);
    // No index is added for bucket: it is read per row, never filtered on.
    expect(body).not.toMatch(/@@index\(\[bucket/);
    // The bucket is storage-internal and must never reach the public contract.
    expect(schema).not.toMatch(/ExportSchema[\s\S]*bucket/);
  });
});