import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));

function migrationSql(name: string): string {
  return readFileSync(`${migrationsDir}/${name}/migration.sql`, "utf8")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("map provider contract migrations", () => {
  it("widens the destination provider constraint to the complete public enum", () => {
    const sql = migrationSql("0030_trip_destination_tencent_provider");

    expect(sql).toContain('DROP CONSTRAINT "TripDestination_provider_check"');
    expect(sql).toContain(
      `CHECK ("provider" IS NULL OR "provider" IN ('geoapify', 'photon', 'tencent', 'local', 'map_pin'))`,
    );
    expect(sql).not.toMatch(/\b(DELETE|INSERT|UPDATE)\b/i);
  });

  it("raises only active Geoapify rows below the measured timeout floor", () => {
    const sql = migrationSql("0031_geoapify_timeout_floor");

    expect(sql).toContain(`jsonb_set("config", '{timeoutMs}', to_jsonb(5000), true)`);
    expect(sql).toContain(`"group" = 'places'`);
    expect(sql).toContain(`"adapter" = 'geoapify'`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
    expect(sql).toContain(`jsonb_typeof("config"->'timeoutMs') = 'number'`);
    expect(sql).toContain(`("config"->>'timeoutMs')::numeric < 5000`);
    expect(sql).toContain(`"healthStatus" = 'unknown'`);
  });
});
