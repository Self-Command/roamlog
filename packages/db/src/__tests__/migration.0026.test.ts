import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => /^\d{4}_/u.test(entry))
  .sort();
const migrationName = "0026_ai_message_parent_backfill";
const rawSql = readFileSync(`${migrationsDir}/${migrationName}/migration.sql`, "utf8");

describe("0026_ai_message_parent_backfill migration", () => {
  it("runs after the AI conversation schema and never deletes rows", () => {
    const index = migrations.indexOf(migrationName);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(migrations.indexOf("0015_ai_conversations")).toBeLessThan(index);
    expect(rawSql).not.toMatch(/\bDELETE\s+FROM\b/iu);
  });

  it("only repairs assistant rows with a preceding user message", () => {
    expect(rawSql).toMatch(/UPDATE\s+"AiMessage"\s+AS\s+child/iu);
    expect(rawSql).toContain('child."role" = \'assistant\'::"AiMessageRole"');
    expect(rawSql).toContain('child."parentId" IS NULL');
    expect(rawSql).toContain('parent."role" = \'user\'::"AiMessageRole"');
    expect(rawSql).toContain('parent."createdAt" < child."createdAt"');
    expect(rawSql).toContain("EXISTS");
  });

  it("keeps a legitimate root when no earlier user message exists", () => {
    expect(rawSql).toContain('parent."conversationId" = child."conversationId"');
    expect(rawSql).toContain('child."parentId" IS NULL');
    expect(rawSql).toContain("LIMIT 1");
  });
});
