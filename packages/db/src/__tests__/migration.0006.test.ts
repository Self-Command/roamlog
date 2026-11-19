import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0006_trip_stop_address_bbox";
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

/** The four columns this migration owns, in one place for both assertions. */
const addedColumns = [
  {
    model: "Trip",
    column: "originAddress",
    prisma: /originAddress\s+String\?\s+@db\.VarChar\(400\)/,
    postgres: 'ADD COLUMN "originAddress" VARCHAR(400)',
  },
  {
    model: "Trip",
    column: "originBbox",
    prisma: /originBbox\s+Json\?\s+@db\.JsonB/,
    postgres: 'ADD COLUMN "originBbox" JSONB',
  },
  {
    model: "Stop",
    column: "address",
    prisma: /address\s+String\?\s+@db\.VarChar\(400\)/,
    postgres: 'ADD COLUMN "address" VARCHAR(400)',
  },
  {
    model: "Stop",
    column: "bbox",
    prisma: /bbox\s+Json\?\s+@db\.JsonB/,
    postgres: 'ADD COLUMN "bbox" JSONB',
  },
] as const;

describe("0006_trip_stop_address_bbox migration", () => {
  it("sorts after every existing migration", () => {
    expect(migrations).toEqual([
      "0001_init",
      "0002_two_factor_state",
      "0003_w0_trip_stop_place_metadata",
      "0004_system_setting",
      "0005_platform_role_override",
      migrationName,
    ]);
  });

  it("declares every new column as nullable in the Prisma schema", () => {
    for (const entry of addedColumns) {
      const body = modelBody(entry.model);
      expect(body, `${entry.model}.${entry.column}`).toMatch(entry.prisma);
      const line = body
        .split("\n")
        .find((candidate) => new RegExp(`^\\s+${entry.column}\\s`).test(candidate));
      expect(line, `${entry.model}.${entry.column} line`).toBeDefined();
      // Nullable, no default, no required marker: additive by construction.
      expect(line).not.toMatch(/@default/);
      expect(line).toMatch(/\?/);
    }
  });

  it("adds the same nullable columns in PostgreSQL without defaults", () => {
    for (const entry of addedColumns) {
      expect(sql, `${entry.model}.${entry.column}`).toContain(entry.postgres);
      expect(sql, `${entry.column} must not be NOT NULL`).not.toMatch(
        new RegExp(`ADD COLUMN "${entry.column}"[^,]*NOT NULL`),
      );
      expect(sql, `${entry.column} must not have a default`).not.toMatch(
        new RegExp(`ADD COLUMN "${entry.column}"[^,]*DEFAULT`),
      );
    }
  });

  it("constrains both bbox columns to a four-number JSON array", () => {
    for (const [constraint, column] of [
      ["Stop_bbox_shape_check", "bbox"],
      ["Trip_origin_bbox_shape_check", "originBbox"],
    ] as const) {
      expect(sql).toContain(`CONSTRAINT "${constraint}"`);
      expect(sql).toMatch(
        new RegExp(
          `CONSTRAINT "${constraint}" CHECK \\(\\s?"${column}" IS NULL OR \\( ` +
            `jsonb_typeof\\("${column}"\\) = 'array' AND jsonb_array_length\\("${column}"\\) = 4`,
        ),
      );
      // Every slot must be a JSON number, not a string or nested array.
      for (const index of [0, 1, 2, 3]) {
        expect(sql).toContain(`jsonb_typeof("${column}" -> ${index}) = 'number'`);
      }
    }
  });

  it("is additive only: no drops, rewrites or column type changes", () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|TYPE|SCHEMA|COLUMN|CONSTRAINT)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/SET\s+NOT\s+NULL/i);
    expect(sql).not.toMatch(/\bCREATE\s+(UNIQUE\s+)?INDEX\b/i);
  });
});