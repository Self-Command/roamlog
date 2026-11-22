import { readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-PostgreSQL proof for `0011_export_bucket`.
 *
 * 1. the whole migration series applies to an empty database and the new
 *    `Export.bucket` column is nullable text;
 * 2. a database populated with 0010 data keeps every row and every value
 *    untouched, with `bucket` simply NULL (the historical behaviour);
 * 3. the column is writable and readable, and the CHECK keeps NULL legal while
 *    rejecting a recorded empty string / oversized bucket.
 *
 * Every schema is throwaway (`<base>_exp_*`) so the operator's working schema is
 * never touched.
 */
const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED 0011 export bucket integration test: ROAMLOG_TEST_DATABASE_URL is not set.\n",
  );
}

const migrationsDir = new URL("../../prisma/migrations/", import.meta.url);
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0011_export_bucket";

function connectionWithoutSchema(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}

function schemaFromUrl(databaseUrl: string): string {
  const raw = new URL(databaseUrl).searchParams.get("schema")?.trim() || "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(raw)) {
    throw new Error(`Refusing unsafe test schema name: ${raw}`);
  }
  return raw;
}

async function applyMigrations(admin: Client, schema: string, names: readonly string[]) {
  await admin.query(`SET search_path TO "${schema}"`);
  for (const name of names) {
    const sql = readFileSync(new URL(`${name}/migration.sql`, migrationsDir), "utf8");
    await admin.query(sql);
  }
}

async function inRolledBackTransaction(client: Client, fn: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

async function expectViolation(
  client: Client,
  run: () => Promise<unknown>,
  code: string,
  constraint: string,
): Promise<void> {
  await inRolledBackTransaction(client, async () => {
    let error: { code?: string; constraint?: string } | undefined;
    try {
      await run();
    } catch (caught) {
      error = caught as { code?: string; constraint?: string };
    }
    expect(error, `${constraint} should reject the write`).toBeDefined();
    expect(error?.code).toBe(code);
    expect(error?.constraint).toBe(constraint);
  });
}

const USER_ID = "0199f080-0000-7000-8000-000000000101";
const WORKSPACE_ID = "0199f080-0000-7000-8000-000000000102";
const MEMBER_ID = "0199f080-0000-7000-8000-000000000103";
const EXPORT_READY = "0199f080-0000-7000-8000-000000000110";
const EXPORT_FAILED = "0199f080-0000-7000-8000-000000000111";
const EXPORT_NEW = "0199f080-0000-7000-8000-000000000112";

interface ExportSnapshot {
  id: string;
  scope: string;
  format: string;
  status: string;
  storageKey: string | null;
  error: string | null;
  includeComments: boolean;
  includeExpenses: boolean;
  includeMedia: boolean;
  expiresAt: Date | null;
  completedAt: Date | null;
}

async function insertLegacyRows(admin: Client): Promise<void> {
  await admin.query("BEGIN");
  try {
    await admin.query(
      `INSERT INTO "User" ("id", "email", "name", "updatedAt")
       VALUES ($1, 'exp-0011@roamlog.test', 'Export 0011', now())`,
      [USER_ID],
    );
    await admin.query(
      `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
       VALUES ($1, 'Export 0011', 'exp-0011', $2, now())`,
      [WORKSPACE_ID, USER_ID],
    );
    // 0001 enforces exactly one active owner row per workspace.
    await admin.query(
      `INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'owner', now())`,
      [MEMBER_ID, WORKSPACE_ID, USER_ID],
    );
    await admin.query(
      `INSERT INTO "Export" ("id", "workspaceId", "requestedById", "scope", "format",
         "status", "storageKey", "includeComments", "includeExpenses", "includeMedia",
         "completedAt", "expiresAt", "createdAt")
       VALUES
         ($1, $3, $4, 'trip', 'zip', 'ready', 'exports/ws/old/export.zip', false, true, true,
           now(), now() + interval '7 days', now() - interval '1 day'),
         ($2, $3, $4, 'account', 'json', 'failed', NULL, true, false, true,
           NULL, NULL, now() - interval '2 days')`,
      [EXPORT_READY, EXPORT_FAILED, WORKSPACE_ID, USER_ID],
    );
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

async function snapshotExports(admin: Client): Promise<ExportSnapshot[]> {
  const result = await admin.query<ExportSnapshot>(
    `SELECT "id", "scope"::text AS "scope", "format"::text AS "format", "status"::text AS "status",
            "storageKey", "error", "includeComments", "includeExpenses", "includeMedia",
            "expiresAt", "completedAt"
       FROM "Export" ORDER BY "id"`,
  );
  return result.rows;
}

integration("0011_export_bucket against PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const baseSchema = schemaFromUrl(testDatabaseUrl ?? "");
  const emptySchema = `${baseSchema}_exp_empty`;
  const dataSchema = `${baseSchema}_exp_data`;
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: connectionWithoutSchema(testDatabaseUrl ?? "") });
    await admin.connect();
    for (const schema of [emptySchema, dataSchema]) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${schema}"`);
    }
  });

  afterAll(async () => {
    for (const schema of [emptySchema, dataSchema]) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await admin.end();
  });

  it("applies the whole migration series to an empty database", async () => {
    await applyMigrations(admin, emptySchema, migrations);
    await admin.query(`SET search_path TO "${emptySchema}"`);

    const column = await admin.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'Export' AND column_name = 'bucket'`,
      [emptySchema],
    );
    expect(column.rows).toEqual([
      { data_type: "text", is_nullable: "YES", column_default: null },
    ]);

    // The far end of the previous chain really ran (0010 is present too).
    const destinations = await admin.query(
      `SELECT count(*)::int AS count FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = 'TripDestination'`,
      [emptySchema],
    );
    expect(destinations.rows).toEqual([{ count: 1 }]);

    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO "User" ("id", "email", "name", "updatedAt")
         VALUES ($1, 'exp-empty@roamlog.test', 'Export Empty', now())`,
        [USER_ID],
      );
      await admin.query(
        `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
         VALUES ($1, 'Export Empty', 'exp-empty', $2, now())`,
        [WORKSPACE_ID, USER_ID],
      );
      // The 0001 owner check is deferred: workspace and owner row commit together.
      await admin.query(
        `INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "updatedAt")
         VALUES ($1, $2, $3, 'owner', now())`,
        [MEMBER_ID, WORKSPACE_ID, USER_ID],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    await admin.query(
      `INSERT INTO "Export" ("id", "workspaceId", "requestedById", "scope", "format", "bucket")
       VALUES ($1, $2, $3, 'workspace', 'zip', 'roamlog-bucket-a')`,
      [EXPORT_NEW, WORKSPACE_ID, USER_ID],
    );
    const written = await admin.query<{ bucket: string | null }>(
      `SELECT "bucket" FROM "Export" WHERE "id" = $1`,
      [EXPORT_NEW],
    );
    expect(written.rows).toEqual([{ bucket: "roamlog-bucket-a" }]);
  });

  it("keeps 0010 rows and values intact and leaves their bucket NULL", async () => {
    await applyMigrations(
      admin,
      dataSchema,
      migrations.filter((name) => name < migrationName),
    );
    await insertLegacyRows(admin);
    const before = await snapshotExports(admin);
    expect(before).toHaveLength(2);

    await applyMigrations(admin, dataSchema, [migrationName]);
    await admin.query(`SET search_path TO "${dataSchema}"`);

    const after = await snapshotExports(admin);
    // Every pre-existing value is byte-for-byte the same; no column is retyped.
    expect(after).toEqual(before);

    const buckets = await admin.query<{ id: string; bucket: string | null }>(
      `SELECT "id", "bucket" FROM "Export" ORDER BY "id"`,
    );
    expect(buckets.rows).toEqual([
      { id: EXPORT_READY, bucket: null },
      { id: EXPORT_FAILED, bucket: null },
    ]);
  });

  it("records a bucket on an old row and reads it back", async () => {
    await admin.query(`SET search_path TO "${dataSchema}"`);
    await admin.query(`UPDATE "Export" SET "bucket" = 'roamlog-bucket-a' WHERE "id" = $1`, [
      EXPORT_READY,
    ]);

    const written = await admin.query<{ bucket: string | null; storageKey: string | null }>(
      `SELECT "bucket", "storageKey" FROM "Export" WHERE "id" = $1`,
      [EXPORT_READY],
    );
    expect(written.rows).toEqual([
      { bucket: "roamlog-bucket-a", storageKey: "exports/ws/old/export.zip" },
    ]);

    // A row with no recorded bucket stays readable (NULL is not an error).
    const legacy = await admin.query<{ bucket: string | null }>(
      `SELECT "bucket" FROM "Export" WHERE "id" = $1`,
      [EXPORT_FAILED],
    );
    expect(legacy.rows).toEqual([{ bucket: null }]);
  });

  it("accepts a second bucket and rejects empty or oversized values", async () => {
    await admin.query(`SET search_path TO "${dataSchema}"`);

    await admin.query(`UPDATE "Export" SET "bucket" = 'roamlog-bucket-b' WHERE "id" = $1`, [
      EXPORT_READY,
    ]);
    const switched = await admin.query<{ bucket: string | null }>(
      `SELECT "bucket" FROM "Export" WHERE "id" = $1`,
      [EXPORT_READY],
    );
    expect(switched.rows).toEqual([{ bucket: "roamlog-bucket-b" }]);

    await expectViolation(
      admin,
      () => admin.query(`UPDATE "Export" SET "bucket" = '' WHERE "id" = $1`, [EXPORT_FAILED]),
      "23514",
      "Export_bucket_check",
    );

    await expectViolation(
      admin,
      () =>
        admin.query(`UPDATE "Export" SET "bucket" = repeat('x', 256) WHERE "id" = $1`, [
          EXPORT_FAILED,
        ]),
      "23514",
      "Export_bucket_check",
    );
  });
});
