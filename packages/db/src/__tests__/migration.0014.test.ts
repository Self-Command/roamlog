import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Shape checks for `0014_media_exif`.
 *
 * The column additions are additive by construction: every one is nullable (or
 * boolean-with-default), so an existing database migrates without a backfill and
 * every historical photo keeps `exif = NULL` — which is the honest value, since
 * the original file was never uploaded and cannot be re-read. The integration
 * test next door (`migration.0014.integration.test.ts`) proves the same SQL
 * against a real PostgreSQL.
 */
const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0014_media_exif";
const rawSql = readFileSync(`${migrationsDir}/${migrationName}/migration.sql`, "utf8");
const sql = rawSql
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const schema = readFileSync(
  fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)),
  "utf8",
);

function modelBody(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`${name} model not found in schema.prisma`);
  }
  return match[1] ?? "";
}

describe("0014_media_exif migration", () => {
  it("is the newest migration and follows the published chain", () => {
    expect(migrations.indexOf(migrationName)).toBe(13);
    expect(migrations.slice(0, 13)).toEqual([
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
      "0011_export_bucket",
      "0012_visibility_and_participants",
      "0013_stop_provider_tencent",
    ]);
  });

  it("adds the three nullable Media columns", () => {
    expect(sql).toContain('ALTER TABLE "Media" ADD COLUMN "exif" JSONB');
    expect(sql).toContain('ALTER TABLE "Media" ADD COLUMN "lat" DOUBLE PRECISION');
    expect(sql).toContain('ALTER TABLE "Media" ADD COLUMN "lng" DOUBLE PRECISION');
    // Nullable: no NOT NULL, no DEFAULT. History has no metadata to backfill,
    // because the source file that carried it was never uploaded.
    expect(sql).not.toMatch(/"exif"\s+JSONB\s+NOT\s+NULL/i);
    expect(sql).not.toMatch(/"lat"\s+DOUBLE PRECISION\s+(NOT\s+NULL|DEFAULT)/i);
    expect(sql).not.toMatch(/"lng"\s+DOUBLE PRECISION\s+(NOT\s+NULL|DEFAULT)/i);
  });

  it("defaults the Owner switch to true, so existing trips keep today's behaviour", () => {
    expect(sql).toContain(
      'ALTER TABLE "Trip" ADD COLUMN "showExactPhotoLocation" BOOLEAN NOT NULL DEFAULT true',
    );
  });

  it("keeps the coordinate pair atomic and in range at the catalog level", () => {
    expect(sql).toContain('CONSTRAINT "Media_exif_location_check" CHECK');
    expect(sql).toMatch(/lat IS NULL AND lng IS NULL/);
    expect(sql).toMatch(/lat IS NOT NULL AND lng IS NOT NULL/);
    expect(sql).toMatch(/lat BETWEEN -90 AND 90/);
    expect(sql).toMatch(/lng BETWEEN -180 AND 180/);
  });

  it("indexes the pair for the map queries the columns exist for", () => {
    expect(sql).toContain(
      'CREATE INDEX "Media_workspaceId_lat_lng_idx" ON "Media"("workspaceId", "lat", "lng")',
    );
    expect(sql).toContain('CREATE INDEX "Media_tripId_lat_lng_idx" ON "Media"("tripId", "lat", "lng")');
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
    const alteredTables = [...sql.matchAll(/ALTER\s+TABLE\s+"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(alteredTables)).toEqual(new Set(["Media", "Trip"]));
  });

  it("keeps the Prisma models in step with the SQL", () => {
    const media = modelBody("Media");
    expect(media).toMatch(/exif\s+Json\?\s+@db\.JsonB/);
    expect(media).toMatch(/lat\s+Float\?/);
    expect(media).toMatch(/lng\s+Float\?/);
    expect(media).toMatch(/@@index\(\[workspaceId, lat, lng\]\)/);
    expect(media).toMatch(/@@index\(\[tripId, lat, lng\]\)/);

    const trip = modelBody("Trip");
    expect(trip).toMatch(/showExactPhotoLocation\s+Boolean\s+@default\(true\)/);
  });

  it("never leaks the EXIF blob onto the public share contract", () => {
    const shareContract = readFileSync(
      fileURLToPath(new URL("../../../contracts/src/api/share-links.ts", import.meta.url)),
      "utf8",
    );
    const publicMedia = shareContract.slice(
      shareContract.indexOf("PublicMediaSchema"),
      shareContract.indexOf("PublicEntrySchema"),
    );
    // The public payload carries the coordinates the Owner opted into and
    // nothing else: device serial numbers and software versions are private.
    expect(publicMedia).toMatch(/lat:/);
    expect(publicMedia).toMatch(/lng:/);
    expect(publicMedia).not.toMatch(/\bexif\b/);
  });
});
