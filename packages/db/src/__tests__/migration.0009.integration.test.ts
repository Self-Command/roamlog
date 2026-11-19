import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Real-PostgreSQL migration check for 0009_media_motion.
 *
 * Builds a throwaway schema, applies every migration in lexical order (the
 * empty-database path), then rewinds to the 0008 shape, inserts 0008-era rows,
 * and applies 0009 again to prove the upgrade path:
 * - the existing Media row survives untouched and simply has no motion sibling;
 * - the database itself rejects a zero-byte / negative-duration / wrong-container
 *   motion row, not only the Zod layer;
 * - `mediaId` is unique (the 1:1) and the FK cascades a hard delete.
 *
 * Skipped unless ROAMLOG_TEST_DATABASE_URL points at a reachable PostgreSQL.
 */
const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED migration 0009 integration test: ROAMLOG_TEST_DATABASE_URL is not set.\n",
  );
}

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrationNames = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

function migrationSql(name: string): string {
  return readFileSync(`${migrationsDir}/${name}/migration.sql`, "utf8");
}

const USER_ID = "01942f30-1200-7000-8000-000000000d01";
const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000d02";
const MEDIA_ID = "01942f30-1200-7000-8000-000000000d03";
const MOTION_ID = "01942f30-1200-7000-8000-000000000d04";
const KEY = `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/original.heic`;
const MOTION_KEY = `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/motion.mov`;

integration("0009_media_motion against PostgreSQL", () => {
  const schema = `d2_it_${process.pid}_${Date.now().toString(36)}`;
  const client = new Client({ connectionString: testDatabaseUrl });

  afterAll(async () => {
    if (client.connection?.stream) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  });

  it(
    "applies the full chain, upgrades a 0008 database and enforces every CHECK",
    async () => {
      await client.connect();
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);

      for (const name of migrationNames) {
        await client.query(migrationSql(name));
      }

      // Rewind to a 0008 database to exercise the upgrade path, not only the
      // empty-database path.
      await client.query(`DROP TABLE "MediaMotion"`);

      await client.query("BEGIN");
      await client.query(
        `INSERT INTO "User" ("id", "email", "name", "updatedAt")
         VALUES ($1, 'd2@roamlog.local', 'D2 Uploader', NOW())`,
        [USER_ID],
      );
      await client.query(
        `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
         VALUES ($1, 'D2 Workspace', 'd2-workspace', $2, NOW())`,
        [WORKSPACE_ID, USER_ID],
      );
      await client.query(
        `INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "updatedAt")
         VALUES ($1, $2, $3, 'owner', NOW())`,
        ["01942f30-1200-7000-8000-000000000d05", WORKSPACE_ID, USER_ID],
      );
      await client.query(
        `INSERT INTO "Media" ("id", "workspaceId", "uploaderId", "bucket", "key",
                              "mimeType", "size", "status", "updatedAt")
         VALUES ($1, $2, $3, 'roamlog-test', $4, 'image/heic', 4096, 'ready', NOW())`,
        [MEDIA_ID, WORKSPACE_ID, USER_ID, KEY],
      );
      await client.query("COMMIT");

      // 0009 on top of real 0008 data.
      await client.query(migrationSql("0009_media_motion"));

      const preserved = await client.query<{ key: string; status: string }>(
        `SELECT "key", "status" FROM "Media" WHERE "id" = $1`,
        [MEDIA_ID],
      );
      expect(preserved.rows).toEqual([{ key: KEY, status: "ready" }]);

      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "MediaMotion"`,
      );
      expect(count.rows[0]?.count).toBe("0");

      // Positive case: a well-formed motion row.
      await client.query(
        `INSERT INTO "MediaMotion" ("id", "mediaId", "storageKey", "mimeType", "sizeBytes", "durationMs")
         VALUES ($1, $2, $3, 'video/quicktime', 2400000, 2400)`,
        [MOTION_ID, MEDIA_ID, MOTION_KEY],
      );

      // 1:1: the same media cannot own a second motion row.
      await expect(
        client.query(
          `INSERT INTO "MediaMotion" ("id", "mediaId", "storageKey", "mimeType", "sizeBytes")
           VALUES (gen_random_uuid(), $1, $2, 'video/mp4', 10)`,
          [MEDIA_ID, `${MOTION_KEY}.mp4`],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      // Negative cases: the database rejects each bad value.
      const rejected: Array<[string, unknown[]]> = [
        // sizeBytes > 0
        [`INSERT INTO "MediaMotion" ("id","mediaId","storageKey","mimeType","sizeBytes") VALUES (gen_random_uuid(),$1,$2,'video/quicktime',0)`, [MEDIA_ID, MOTION_KEY]],
        // durationMs >= 0
        [`INSERT INTO "MediaMotion" ("id","mediaId","storageKey","mimeType","sizeBytes","durationMs") VALUES (gen_random_uuid(),$1,$2,'video/quicktime',10,-1)`, [MEDIA_ID, MOTION_KEY]],
        // allow-listed container
        [`INSERT INTO "MediaMotion" ("id","mediaId","storageKey","mimeType","sizeBytes") VALUES (gen_random_uuid(),$1,$2,'image/jpeg',10)`, [MEDIA_ID, MOTION_KEY]],
      ];
      for (const [statement, values] of rejected) {
        await expect(client.query(statement, values)).rejects.toMatchObject({ code: "23514" });
      }

      // The FK refuses an orphan motion row.
      await expect(
        client.query(
          `INSERT INTO "MediaMotion" ("id", "mediaId", "storageKey", "mimeType", "sizeBytes")
           VALUES (gen_random_uuid(), gen_random_uuid(), $1, 'video/quicktime', 10)`,
          [MOTION_KEY],
        ),
      ).rejects.toMatchObject({ code: "23503" });

      // Cascade: a hard delete of the still removes the motion row.
      await client.query(`DELETE FROM "Media" WHERE "id" = $1`, [MEDIA_ID]);
      const remaining = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "MediaMotion"`,
      );
      expect(remaining.rows[0]?.count).toBe("0");
    },
    120_000,
  );
});