import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0009_media_motion";
const rawSql = readFileSync(`${migrationsDir}/${migrationName}/migration.sql`, "utf8");
const sql = rawSql
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const schema = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");

describe("0009_media_motion migration", () => {
  it("sorts after 0008 (0010 superseded it as the newest migration)", () => {
    expect(migrations.indexOf(migrationName)).toBe(8);
    expect(migrations.slice(0, 8)).toEqual([
      "0001_init",
      "0002_two_factor_state",
      "0003_w0_trip_stop_place_metadata",
      "0004_system_setting",
      "0005_platform_role_override",
      "0006_trip_stop_address_bbox",
      "0007_stop_provider_geoapify",
      "0008_report_moderation",
    ]);
  });

  it("creates the MediaMotion table with the documented columns", () => {
    expect(sql).toContain('CREATE TABLE "MediaMotion"');
    for (const column of [
      '"id" UUID NOT NULL',
      '"mediaId" UUID NOT NULL',
      '"storageKey" TEXT NOT NULL',
      '"thumbKey" TEXT',
      '"mimeType" TEXT NOT NULL',
      '"sizeBytes" INTEGER NOT NULL',
      '"durationMs" INTEGER',
      '"width" INTEGER',
      '"height" INTEGER',
      '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"deletedAt" TIMESTAMPTZ(3)',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('CONSTRAINT "MediaMotion_pkey" PRIMARY KEY ("id")');
  });

  it("enforces the 1:1 relation and the cascade delete", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "MediaMotion_mediaId_key" ON "MediaMotion"("mediaId")');
    expect(sql).toContain('FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE');
  });

  it("adds the size, duration and container CHECKs", () => {
    expect(sql).toContain('CONSTRAINT "MediaMotion_sizeBytes_check" CHECK ("sizeBytes" > 0)');
    expect(sql).toContain(
      'CONSTRAINT "MediaMotion_durationMs_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)',
    );
    expect(sql).toContain(
      `CONSTRAINT "MediaMotion_mimeType_check" CHECK ("mimeType" IN ('video/quicktime', 'video/mp4'))`,
    );
    // Every constraint is validated immediately: bad existing rows must fail the
    // migration instead of surfacing on a later write.
    expect(sql).not.toMatch(/NOT\s+VALID/i);
  });

  it("is additive: no existing table, column or row is rewritten", () => {
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+"(?!MediaMotion)/);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bSET\s+(NOT\s+NULL|DEFAULT)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"/i);
  });

  it("keeps the Prisma model in step with the SQL", () => {
    expect(schema).toContain("model MediaMotion {");
    expect(schema).toContain("mediaId      String    @unique @db.Uuid");
    expect(schema).toContain("motion          MediaMotion?");
    expect(schema).toContain('@@map("MediaMotion")');
  });
});