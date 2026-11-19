import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0008_report_moderation";
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

const moderatedModels = ["Trip", "JournalEntry", "Comment", "Media"] as const;

describe("0008_report_moderation migration", () => {
  it("sorts after the migrations it builds on", () => {
    const index = migrations.indexOf(migrationName);
    expect(index).toBeGreaterThan(0);
    for (const earlier of ["0001_init", "0002_two_factor_state", "0003_w0_trip_stop_place_metadata", "0004_system_setting", "0005_platform_role_override", "0006_trip_stop_address_bbox", "0007_stop_provider_geoapify"]) {
      expect(migrations.indexOf(earlier), earlier).toBeGreaterThanOrEqual(0);
      expect(migrations.indexOf(earlier), earlier).toBeLessThan(index);
    }
  });

  it("creates the report and moderation-action tables with their indexes", () => {
    expect(sql).toContain('CREATE TABLE "Report"');
    expect(sql).toContain('CREATE TABLE "ModerationAction"');
    expect(sql).toContain('"Report_status_createdAt_idx"');
    expect(sql).toContain('"Report_workspaceId_targetType_targetId_idx"');
    expect(sql).toContain('"ModerationAction_reportId_idx"');
    expect(sql).toContain('"status" TEXT NOT NULL DEFAULT \'open\'');
    expect(sql).toContain('"action" TEXT NOT NULL');
    expect(sql).not.toMatch(/NOT\s+VALID/i);
  });

  it("keeps the Prisma models in sync with the SQL allow-lists", () => {
    const report = modelBody("Report");
    expect(report).toMatch(/targetType\s+String/);
    expect(report).toMatch(/reason\s+String/);
    expect(report).toMatch(/status\s+String\s+@default\("open"\)/);
    expect(report).toMatch(/detail\s+String\?\s+@db\.VarChar\(1000\)/);
    expect(report).toMatch(/resolutionNote\s+String\?\s+@db\.VarChar\(1000\)/);
    expect(report).toMatch(/@@index\(\[status, createdAt\]\)/);
    expect(report).toMatch(/@@index\(\[workspaceId, targetType, targetId\]\)/);

    const action = modelBody("ModerationAction");
    expect(action).toMatch(/action\s+String/);
    expect(action).toMatch(/note\s+String\?\s+@db\.VarChar\(1000\)/);
    expect(action).toMatch(/@@index\(\[reportId\]\)/);
  });

  it("constrains status, reason, targetType and action to their documented values", () => {
    expect(sql).toContain('CONSTRAINT "Report_targetType_check"');
    expect(sql).toContain("CHECK (\"targetType\" IN ('trip', 'entry', 'comment', 'media'))");
    expect(sql).toContain('CONSTRAINT "Report_reason_check"');
    expect(sql).toContain(
      "CHECK (\"reason\" IN ('spam', 'harassment', 'private_info', 'illegal', 'other'))",
    );
    expect(sql).toContain('CONSTRAINT "Report_status_check"');
    expect(sql).toContain(
      "CHECK (\"status\" IN ('open', 'in_review', 'resolved', 'dismissed'))",
    );
    expect(sql).toContain('CONSTRAINT "ModerationAction_action_check"');
    expect(sql).toContain("CHECK (\"action\" IN ('remove', 'restore', 'warn', 'dismiss'))");
  });

  it("adds nullable moderated columns to every reportable content table", () => {
    for (const model of moderatedModels) {
      const body = modelBody(model);
      expect(body, `${model}.moderatedAt`).toMatch(/moderatedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
      expect(body, `${model}.moderatedById`).toMatch(/moderatedById\s+String\?\s+@db\.Uuid/);
      expect(sql, `${model}.moderatedAt`).toContain(
        `ALTER TABLE "${model}" ADD COLUMN "moderatedAt" TIMESTAMPTZ(3);`,
      );
      expect(sql, `${model}.moderatedById`).toContain(
        `ALTER TABLE "${model}" ADD COLUMN "moderatedById" UUID;`,
      );
    }
  });

  it("is additive only: no drops, rewrites or backfills", () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|TYPE|SCHEMA|COLUMN|CONSTRAINT)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"(Trip|JournalEntry|Comment|Media)"/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bSET\s+NOT\s+NULL\b/i);
    // New columns stay nullable so pre-0008 rows survive without a default.
    expect(sql).not.toMatch(/ADD COLUMN "moderated(At|ById)"[^;]*NOT NULL/i);
    expect(sql).not.toMatch(/ADD COLUMN "moderated(At|ById)"[^;]*DEFAULT/i);
  });
});