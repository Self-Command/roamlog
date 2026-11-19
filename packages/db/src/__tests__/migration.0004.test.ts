import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0004_system_setting";
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

describe("0004_system_setting migration", () => {
  it("sorts after the migrations it builds on", () => {
    const index = migrations.indexOf(migrationName);
    expect(index).toBeGreaterThan(0);
    for (const earlier of ["0001_init", "0002_two_factor_state", "0003_w0_trip_stop_place_metadata"]) {
      expect(migrations.indexOf(earlier), earlier).toBeGreaterThanOrEqual(0);
      expect(migrations.indexOf(earlier), earlier).toBeLessThan(index);
    }
  });

  it("declares the SystemSetting model with the agreed keys and column types", () => {
    const body = modelBody("SystemSetting");
    expect(body).toMatch(/key\s+String\s+@id\s+@db\.VarChar\(120\)/);
    expect(body).toMatch(/group\s+String\s+@db\.VarChar\(40\)/);
    expect(body).toMatch(/valueType\s+String\s+@db\.VarChar\(16\)/);
    expect(body).toMatch(/value\s+Json\?\s+@db\.JsonB/);
    expect(body).toMatch(/secretCipher\s+String\?/);
    expect(body).toMatch(/secretLast4\s+String\?\s+@db\.VarChar\(8\)/);
    expect(body).toMatch(/keyVersion\s+Int\s+@default\(1\)/);
    expect(body).toMatch(/envLocked\s+Boolean\s+@default\(false\)/);
    expect(body).toMatch(/isPublic\s+Boolean\s+@default\(false\)/);
    expect(body).toMatch(/updatedById\s+String\?\s+@db\.Uuid/);
    expect(body).toMatch(/updatedAt\s+DateTime\s+@updatedAt\s+@db\.Timestamptz\(3\)/);
    expect(body).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/);
    expect(body).toMatch(/@@index\(\[group\]\)/);
    expect(body).toMatch(/@@map\("SystemSetting"\)/);
  });

  it("creates the same columns in PostgreSQL without seeding rows", () => {
    expect(sql).toContain('CREATE TABLE "SystemSetting"');
    for (const line of [
      '"key" VARCHAR(120) NOT NULL',
      '"group" VARCHAR(40) NOT NULL',
      '"valueType" VARCHAR(16) NOT NULL',
      '"value" JSONB',
      '"secretCipher" TEXT',
      '"secretLast4" VARCHAR(8)',
      '"keyVersion" INTEGER NOT NULL DEFAULT 1',
      '"envLocked" BOOLEAN NOT NULL DEFAULT false',
      '"isPublic" BOOLEAN NOT NULL DEFAULT false',
      '"updatedById" UUID',
      '"updatedAt" TIMESTAMPTZ(3) NOT NULL',
      '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      'CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")',
      'CREATE INDEX "SystemSetting_group_idx" ON "SystemSetting"("group")',
    ]) {
      expect(sql, line).toContain(line);
    }
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
    expect(sql).not.toMatch(/UPDATE\s+"?(User|Workspace|Trip)"?/i);
  });

  it("is additive only: no table/type drops and no destructive alters", () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|TYPE|SCHEMA|COLUMN)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+"?(?!SystemSetting)/i);
  });

  it("constrains valueType and keeps plaintext out of secret rows", () => {
    expect(sql).toContain(
      "CONSTRAINT \"SystemSetting_valueType_check\" CHECK (\"valueType\" IN ('string', 'number', 'boolean', 'json', 'secret'))",
    );
    expect(sql).toContain(
      '"valueType" = \'secret\' AND "secretCipher" IS NOT NULL AND "value" IS NULL',
    );
    expect(sql).toContain('"valueType" <> \'secret\' AND "secretCipher" IS NULL');
  });
});
