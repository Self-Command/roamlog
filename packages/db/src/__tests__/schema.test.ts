import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(
  new URL("../../prisma/schema.prisma", import.meta.url),
);
const migrationPath = fileURLToPath(
  new URL("../../prisma/migrations/0001_init/migration.sql", import.meta.url),
);

const schema = readFileSync(schemaPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

const requiredModels = [
  "User",
  "Session",
  "Account",
  "Verification",
  "TwoFactor",
  "Workspace",
  "WorkspaceMember",
  "Invitation",
  "Trip",
  "TripParticipant",
  "Stop",
  "JournalEntry",
  "EntryRevision",
  "EntryMedia",
  "ItineraryItem",
  "Comment",
  "CommentMention",
  "Activity",
  "Media",
  "Expense",
  "ExpenseParticipant",
  "PackingItem",
  "ShareLink",
  "Notification",
  "NotificationPreference",
  "AuditLog",
  "FeatureFlag",
  "EmailLog",
  "Export",
] as const;

const requiredEnums = [
  "PlatformRole",
  "UserStatus",
  "Plan",
  "WorkspaceStatus",
  "MemberRole",
  "MemberStatus",
  "TripStatus",
  "TripVisibility",
  "Mood",
  "Weather",
  "ItineraryType",
  "CommentTargetType",
  "MediaStatus",
  "ExpenseCategory",
  "SplitMode",
  "PackingCategory",
  "ExportScope",
  "ExportFormat",
  "ExportStatus",
  "EmailStatus",
  "ActorType",
] as const;

const workspaceScopedModels = [
  "WorkspaceMember",
  "Invitation",
  "Trip",
  "TripParticipant",
  "Stop",
  "JournalEntry",
  "EntryRevision",
  "EntryMedia",
  "ItineraryItem",
  "Comment",
  "CommentMention",
  "Activity",
  "Media",
  "Expense",
  "ExpenseParticipant",
  "PackingItem",
  "ShareLink",
  "Export",
] as const;

const versionedAggregates = [
  "Trip",
  "Stop",
  "JournalEntry",
  "ItineraryItem",
  "Expense",
  "PackingItem",
] as const;

const softDeletedModels = [
  "User",
  "Workspace",
  "Trip",
  "Stop",
  "JournalEntry",
  "ItineraryItem",
  "Comment",
  "Media",
  "Expense",
  "PackingItem",
] as const;

function modelBody(model: string): string {
  const match = schema.match(
    new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match?.[1]) {
    throw new Error(`Missing model ${model}`);
  }
  return match[1];
}

describe("Prisma schema", () => {
  it("declares every required model and enum", () => {
    for (const model of requiredModels) {
      expect(schema).toMatch(new RegExp(`model\\s+${model}\\s*\\{`));
    }
    for (const enumName of requiredEnums) {
      expect(schema).toMatch(new RegExp(`enum\\s+${enumName}\\s*\\{`));
    }
  });

  it("does not introduce the excluded data-import domain", () => {
    expect(schema).not.toMatch(/model\s+Import/);
    expect(schema).not.toMatch(/model\s+ImportJob/);
  });

  it("uses UUIDv7, PostgreSQL date/time, money, array, and JSON types", () => {
    expect(schema).toContain('provider = "prisma-client"');
    expect(schema).toMatch(
      /output\s*=\s*"\.\.\/src\/generated\/prisma"/,
    );
    expect(schema).toContain('provider = "postgresql"');
    expect(schema).toMatch(/id\s+String\s+@id\s+@default\(uuid\(7\)\)\s+@db\.Uuid/);
    expect(schema).toContain('@db.Timestamptz(3)');
    expect(schema).toMatch(/startDate\s+DateTime\s+@db\.Date/);
    expect(schema).toMatch(/endDate\s+DateTime\s+@db\.Date/);
    expect(schema).toMatch(/amountMinor\s+Int/);
    expect(schema).toMatch(/String\[\]/);
    expect(schema).toMatch(/Json/);
  });

  it("gives every workspace-owned business model a required workspaceId", () => {
    for (const model of workspaceScopedModels) {
      const body = modelBody(model);
      expect(body, `${model} must be workspace-scoped`).toMatch(
        /workspaceId\s+String\s+@db\.Uuid/,
      );
      expect(body, `${model} must expose a workspace relation`).toMatch(
        /workspace\s+Workspace\s+@relation/,
      );
    }
  });

  it("declares workspace, ordering, token, and compound uniqueness constraints", () => {
    expect(modelBody("Workspace")).toMatch(/slug\s+String\s+@unique/);
    expect(modelBody("WorkspaceMember")).toMatch(
      /@@unique\(\[workspaceId,\s*userId\]\)/,
    );
    expect(modelBody("Invitation")).toMatch(
      /tokenHash\s+String\s+@unique/,
    );
    expect(modelBody("TripParticipant")).toMatch(
      /@@unique\(\[tripId,\s*userId\]\)/,
    );
    expect(modelBody("EntryRevision")).toMatch(
      /@@unique\(\[entryId,\s*version\]\)/,
    );
    expect(modelBody("EntryMedia")).toMatch(
      /@@id\(\[entryId,\s*mediaId\]\)/,
    );
    expect(modelBody("ExpenseParticipant")).toMatch(
      /@@id\(\[expenseId,\s*userId\]\)/,
    );
    expect(modelBody("CommentMention")).toMatch(
      /@@id\(\[commentId,\s*userId\]\)/,
    );
    expect(modelBody("PackingItem")).toMatch(/order\s+Int/);
    expect(modelBody("ShareLink")).toMatch(
      /tokenHash\s+String\s+@unique/,
    );
    expect(modelBody("NotificationPreference")).toMatch(
      /@@id\(\[userId,\s*type\]\)/,
    );
    expect(modelBody("FeatureFlag")).toMatch(/key\s+String\s+@id/);
  });

  it("exposes optimistic versions and soft deletion on editable aggregates", () => {
    for (const model of versionedAggregates) {
      expect(modelBody(model), `${model} must expose version`).toMatch(
        /version\s+Int\s+@default\(1\)/,
      );
    }
    for (const model of softDeletedModels) {
      expect(modelBody(model), `${model} must expose deletedAt`).toMatch(
        /deletedAt\s+DateTime\?/,
      );
    }
  });

  it("uses Better Auth-compatible auth tables and platform roles", () => {
    expect(modelBody("User")).toMatch(/email\s+String\s+@unique/);
    expect(modelBody("User")).toMatch(/emailVerified\s+Boolean/);
    expect(modelBody("Session")).toMatch(/token\s+String\s+@unique/);
    expect(modelBody("Session")).toMatch(/expiresAt\s+DateTime/);
    expect(modelBody("Account")).toMatch(/providerId\s+String/);
    expect(modelBody("Account")).toMatch(/accountId\s+String/);
    expect(modelBody("Verification")).toMatch(/identifier\s+String/);
    expect(modelBody("TwoFactor")).toMatch(/secret\s+String/);
    expect(modelBody("TwoFactor")).toMatch(/backupCodes\s+String/);

    const platformRole = schema.match(/enum\s+PlatformRole\s*\{([\s\S]*?)\n\}/);
    expect(platformRole?.[1]).toContain("user");
    expect(platformRole?.[1]).toContain("support");
    expect(platformRole?.[1]).toContain("analyst");
    expect(platformRole?.[1]).toContain("admin");
    expect(platformRole?.[1]).toContain("super_admin");
  });

  it("matches contract nullability and internal join identities", () => {
    expect(modelBody("Trip")).toMatch(/origin\s+String\s*$/m);
    expect(modelBody("Trip")).toMatch(/budgetAmountMinor\s+Int\?/);
    expect(modelBody("Trip")).toMatch(/budgetCurrency\s+String\?/);
    expect(modelBody("JournalEntry")).toMatch(/mood\s+Mood\?/);
    expect(modelBody("JournalEntry")).toMatch(/weather\s+Weather\?/);
    expect(modelBody("ItineraryItem")).toMatch(/location\s+String\s*$/m);
    expect(modelBody("ItineraryItem")).toMatch(/notes\s+String\s*$/m);
    expect(modelBody("Stop")).toMatch(/notes\s+String\s*$/m);
    expect(modelBody("Activity")).toMatch(/actorId\s+String\s+@db\.Uuid/);
    expect(modelBody("Media")).toMatch(/caption\s+String\?/);
    expect(modelBody("Media")).toMatch(/date\s+DateTime\?\s+@db\.Date/);
    expect(modelBody("Media")).toMatch(/location\s+String\?/);
    expect(modelBody("EntryMedia")).not.toMatch(/\n\s+id\s+String/);
    expect(modelBody("ExpenseParticipant")).not.toMatch(/\n\s+id\s+String/);
    expect(modelBody("CommentMention")).not.toMatch(/\n\s+id\s+String/);
    expect(modelBody("NotificationPreference")).toMatch(
      /@@id\(\[userId,\s*type\]\)/,
    );
  });

  it("adds migration-only owner and date invariants", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*WorkspaceMember[\s\S]*WHERE[\s\S]*role[\s\S]*'owner'/i,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*Invitation[\s\S]*WHERE[\s\S]*acceptedAt[\s\S]*revokedAt/i,
    );
    expect(migration).toMatch(/CHECK[\s\S]*endDate[\s\S]*startDate/i);
    expect(migration.toLowerCase()).toContain("service-enforced");
  });
});
