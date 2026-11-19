import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Real-PostgreSQL migration check for 0008_report_moderation.
 *
 * It builds a throwaway schema, applies every migration in lexical order
 * (empty-database ordering), inserts a 0007-era user/workspace/trip, applies
 * 0008, then asserts the old row survived untouched and the database itself
 * rejects every bad allow-list value (not just the Zod layer).
 *
 * Skipped unless ROAMLOG_TEST_DATABASE_URL points at a reachable PostgreSQL.
 */
const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED migration 0008 integration test: ROAMLOG_TEST_DATABASE_URL is not set.\n",
  );
}

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrationNames = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

function migrationSql(name: string): string {
  return readFileSync(`${migrationsDir}/${name}/migration.sql`, "utf8");
}

const USER_ID = "01942f30-1200-7000-8000-000000000911";
const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000912";
const TRIP_ID = "01942f30-1200-7000-8000-000000000913";
const REPORT_ID = "01942f30-1200-7000-8000-000000000914";

integration("0008_report_moderation against PostgreSQL", () => {
  const schema = `b4_it_${process.pid}_${Date.now().toString(36)}`;
  const client = new Client({ connectionString: testDatabaseUrl });

  afterAll(async () => {
    if (client.connection?.stream) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  });

  it(
    "applies the full migration chain, preserves 0007 data and enforces every CHECK",
    async () => {
      await client.connect();
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);

      // Empty database, every migration in lexical order.
      for (const name of migrationNames) {
        await client.query(migrationSql(name));
      }

      // Recreate the 0007 era, then roll the schema back to 0007 for the
      // data-preservation half of the test.
      await client.query(`DROP TABLE "ModerationAction"`);
      await client.query(`DROP TABLE "Report"`);
      for (const table of ["Trip", "JournalEntry", "Comment", "Media"]) {
        await client.query(`ALTER TABLE "${table}" DROP COLUMN "moderatedAt"`);
        await client.query(`ALTER TABLE "${table}" DROP COLUMN "moderatedById"`);
      }

      await client.query("BEGIN");
      await client.query(
        `INSERT INTO "User" ("id", "email", "name", "updatedAt")
         VALUES ($1, 'b4@roamlog.local', 'B4 Owner', NOW())`,
        [USER_ID],
      );
      await client.query(
        `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
         VALUES ($1, 'B4 Workspace', 'b4-workspace', $2, NOW())`,
        [WORKSPACE_ID, USER_ID],
      );
      // The deferred owner-consistency trigger requires the owner membership in
      // the same transaction as the workspace row.
      await client.query(
        `INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "updatedAt")
         VALUES ($1, $2, $3, 'owner', NOW())`,
        ["01942f30-1200-7000-8000-000000000915", WORKSPACE_ID, USER_ID],
      );
      await client.query(
        `INSERT INTO "Trip" ("id", "workspaceId", "title", "startDate", "endDate",
                             "origin", "createdById", "updatedById", "updatedAt")
         VALUES ($1, $2, 'Pre-0008 trip', '2026-11-01', '2026-11-07',
                 'Shanghai', $3, $3, NOW())`,
        [TRIP_ID, WORKSPACE_ID, USER_ID],
      );
      await client.query("COMMIT");

      // 0008 on top of real 0007 data.
      await client.query(migrationSql("0008_report_moderation"));

      const trip = await client.query<{ title: string; moderatedAt: Date | null }>(
        `SELECT "title", "moderatedAt" FROM "Trip" WHERE "id" = $1`,
        [TRIP_ID],
      );
      expect(trip.rows).toHaveLength(1);
      expect(trip.rows[0]?.title).toBe("Pre-0008 trip");
      expect(trip.rows[0]?.moderatedAt).toBeNull();

      const columns = await client.query<{ table_name: string; is_nullable: string }>(
        `SELECT table_name, is_nullable FROM information_schema.columns
          WHERE table_schema = $1 AND column_name = 'moderatedAt'
          ORDER BY table_name`,
        [schema],
      );
      expect(columns.rows).toEqual([
        { table_name: "Comment", is_nullable: "YES" },
        { table_name: "JournalEntry", is_nullable: "YES" },
        { table_name: "Media", is_nullable: "YES" },
        { table_name: "Trip", is_nullable: "YES" },
      ]);

      // Positive case: a well-formed report.
      await client.query(
        `INSERT INTO "Report" ("id", "workspaceId", "targetType", "targetId",
                               "reason", "reporterId")
         VALUES ($1, $2, 'trip', $3, 'spam', $4)`,
        [REPORT_ID, WORKSPACE_ID, TRIP_ID, USER_ID],
      );

      // Negative cases: the database rejects each bad allow-list value.
      const rejected: Array<[string, string]> = [
        ["status", "escalated"],
        ["reason", "copyright"],
        ["targetType", "workspace"],
      ];
      for (const [column, value] of rejected) {
        const values: Record<string, string> = {
          targetType: "trip",
          reason: "spam",
          status: "open",
          [column]: value,
        };
        await expect(
          client.query(
            `INSERT INTO "Report" ("id", "workspaceId", "targetType", "targetId",
                                   "reason", "reporterId", "status")
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
            [
              WORKSPACE_ID,
              values.targetType,
              TRIP_ID,
              values.reason,
              USER_ID,
              values.status,
            ],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      }

      await expect(
        client.query(
          `INSERT INTO "ModerationAction" ("id", "reportId", "actorId", "action")
           VALUES (gen_random_uuid(), $1, $2, 'delete')`,
          [REPORT_ID, USER_ID],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      // Moderation actions append without touching the report row.
      await client.query(
        `INSERT INTO "ModerationAction" ("id", "reportId", "actorId", "action", "note")
         VALUES (gen_random_uuid(), $1, $2, 'warn', 'first warning')`,
        [REPORT_ID, USER_ID],
      );
      const actions = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "ModerationAction" WHERE "reportId" = $1`,
        [REPORT_ID],
      );
      expect(actions.rows[0]?.count).toBe("1");
    },
    120_000,
  );
});