import { readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../client.js";

/**
 * Real-PostgreSQL proof for `0015_ai_conversations`.
 *
 * The whole migration chain is applied to a throwaway schema, then the Prisma
 * client exercises the behaviour the schema promises:
 *
 * 1. `AiConversation` / `AiMessage` / `AiStream` exist after 0015;
 * 2. deleting a conversation cascades to its messages and streams;
 * 3. `@@unique([conversationId, clientId])` rejects a duplicate client id;
 * 4. deleting a parent message keeps the child and nulls `parentId`
 *    (`onDelete: SetNull`).
 *
 * Every schema is throwaway (`<base>_ai_conv`) so the operator's working schema
 * is never touched.
 */
const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED 0015 AI conversations integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise a real PostgreSQL database.\n",
  );
}

const migrationsDir = new URL("../../prisma/migrations/", import.meta.url);
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0015_ai_conversations";

/** `pg` rejects Prisma's `?schema=` parameter, so strip it for DDL sessions. */
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

function scopedUrl(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function migrationSql(migration: string): string {
  return readFileSync(new URL(`${migration}/migration.sql`, migrationsDir), "utf8");
}

const USER_ID = "0199f080-0000-7000-8000-000000000201";
const WORKSPACE_ID = "0199f080-0000-7000-8000-000000000202";
const MEMBER_ID = "0199f080-0000-7000-8000-000000000203";

integration("0015_ai_conversations against PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const baseSchema = schemaFromUrl(testDatabaseUrl ?? "");
  const schema = `${baseSchema}_ai_conv`;
  let admin: Client;
  let prisma: ReturnType<typeof createPrismaClient>;

  async function createConversation(title: string | null = null) {
    return prisma.aiConversation.create({
      data: { workspaceId: WORKSPACE_ID, userId: USER_ID, title },
    });
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: connectionWithoutSchema(testDatabaseUrl ?? "") });
    await admin.connect();

    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);

    for (const migration of migrations) {
      await admin.query(migrationSql(migration));
    }

    // 0001 installs a deferred trigger requiring Workspace.ownerId to match an
    // active owner `WorkspaceMember`; both rows must land in one transaction.
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO "User" ("id", "email", "name", "updatedAt")
         VALUES ($1, 'ai-0015@roamlog.test', 'AI 0015', now())`,
        [USER_ID],
      );
      await admin.query(
        `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
         VALUES ($1, 'AI 0015', 'ai-0015', $2, now())`,
        [WORKSPACE_ID, USER_ID],
      );
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

    prisma = createPrismaClient({ connectionString: scopedUrl(testDatabaseUrl ?? "", schema) });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await admin.end();
    }
  });

  it("creates the three tables from the published migration chain", async () => {
    expect(migrations).toContain(migrationName);
    expect(migrations.filter((migration) => migration <= migrationName).at(-1)).toBe(migrationName);

    const tables = await admin.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name IN ('AiConversation', 'AiMessage', 'AiStream')
        ORDER BY table_name`,
      [schema],
    );
    expect(tables.rows.map((row: { table_name: string }) => row.table_name)).toEqual([
      "AiConversation",
      "AiMessage",
      "AiStream",
    ]);

    const uniqueIndex = await admin.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = $1 AND indexname = 'AiMessage_conversationId_clientId_key'`,
      [schema],
    );
    expect(uniqueIndex.rows).toHaveLength(1);
  });

  it("cascades a conversation delete to its messages and streams", async () => {
    const conversation = await createConversation("Cascade check");
    const message = await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    });
    const stream = await prisma.aiStream.create({
      data: { conversationId: conversation.id, messageId: message.id },
    });

    await prisma.aiConversation.delete({ where: { id: conversation.id } });

    expect(await prisma.aiConversation.count({ where: { id: conversation.id } })).toBe(0);
    expect(await prisma.aiMessage.count({ where: { id: message.id } })).toBe(0);
    expect(await prisma.aiStream.count({ where: { id: stream.id } })).toBe(0);
  });

  it("rejects a duplicate clientId inside one conversation", async () => {
    const conversation = await createConversation("Unique check");
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        clientId: "nanoid7",
        content: "ok",
      },
    });

    await expect(
      prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          clientId: "nanoid7",
          content: "duplicate",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps the child and nulls parentId when a parent message is deleted", async () => {
    const conversation = await createConversation("Branch check");
    const parent = await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: "user", content: "root" },
    });
    const child = await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        parentId: parent.id,
        role: "assistant",
        content: "branch",
      },
    });

    await prisma.aiMessage.delete({ where: { id: parent.id } });

    const survivor = await prisma.aiMessage.findUnique({ where: { id: child.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.parentId).toBeNull();
  });
});
