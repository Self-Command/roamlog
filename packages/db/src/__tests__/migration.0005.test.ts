import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0005_platform_role_override";
const migrationPath = `${migrationsDir}/${migrationName}/migration.sql`;
const schemaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));

const rawSql = readFileSync(migrationPath, "utf8");
const sql = rawSql
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const schema = readFileSync(schemaPath, "utf8");

function modelBody(model: string): string {
  const match = schema.match(new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) {
    throw new Error(`Missing model ${model}`);
  }
  return match[1];
}

describe("0005_platform_role_override migration", () => {
  it("sorts after every existing migration", () => {
    expect(migrations).toEqual([
      "0001_init",
      "0002_two_factor_state",
      "0003_w0_trip_stop_place_metadata",
      "0004_system_setting",
      migrationName,
      "0006_trip_stop_address_bbox",
      "0007_stop_provider_geoapify",
    ]);
  });

  it("declares the PlatformRoleOverride model as a role/action diff table", () => {
    const body = modelBody("PlatformRoleOverride");
    expect(body).toMatch(/role\s+PlatformRole\b/);
    expect(body).toMatch(/action\s+String\s+@db\.VarChar\(80\)/);
    expect(body).toMatch(/granted\s+Boolean\s+@default\(true\)/);
    expect(body).toMatch(/updatedById\s+String\?\s+@db\.Uuid/);
    expect(body).toMatch(/updatedAt\s+DateTime\s+@updatedAt\s+@db\.Timestamptz\(3\)/);
    expect(body).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/);
    expect(body).toMatch(/@@id\(\[role, action\]\)/);
    expect(body).toMatch(/@@index\(\[updatedById\]\)/);
    expect(body).toMatch(/@@map\("PlatformRoleOverride"\)/);
  });

  it("creates the same table in PostgreSQL without seeding rows", () => {
    expect(sql).toContain('CREATE TABLE "PlatformRoleOverride"');
    for (const line of [
      '"role" "PlatformRole" NOT NULL',
      '"action" VARCHAR(80) NOT NULL',
      '"granted" BOOLEAN NOT NULL DEFAULT true',
      '"updatedById" UUID',
      '"updatedAt" TIMESTAMPTZ(3) NOT NULL',
      '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      'CONSTRAINT "PlatformRoleOverride_pkey" PRIMARY KEY ("role", "action")',
      'CREATE INDEX "PlatformRoleOverride_updatedById_idx" ON "PlatformRoleOverride"("updatedById")',
    ]) {
      expect(sql, line).toContain(line);
    }
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
  });

  it("is additive only: no table/type drops and no destructive alters", () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|TYPE|SCHEMA|COLUMN)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
  });
});