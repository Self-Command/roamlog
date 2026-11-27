import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const rawSql = readFileSync(`${migrationsDir}/0029_media_original_filename/migration.sql`, "utf8");
const sql = rawSql
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const schema = readFileSync(
  fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)),
  "utf8",
);

describe("0029_media_original_filename migration", () => {
  it("adds only the nullable metadata column", () => {
    expect(sql).toContain('ALTER TABLE "Media" ADD COLUMN "originalFileName" VARCHAR(255)');
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toContain("NOT NULL");
  });

  it("keeps the Prisma model in step with the SQL", () => {
    expect(schema).toMatch(/originalFileName\s+String\?\s+@db\.VarChar\(255\)/);
  });
});
