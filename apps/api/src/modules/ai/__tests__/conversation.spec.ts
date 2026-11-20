/**
 * AI conversation persistence on a real PostgreSQL database.
 *
 * The suite creates a disposable schema, applies the real Prisma migrations and
 * exercises `AiConversationService` against rows (no mocks for the database or
 * for Prisma's unique index). That matters for the idempotency and stream
 * concurrency cases: both rely on database constraints/locks, not on an
 * in-memory map.
 *
 * Without ROAMLOG_TEST_DATABASE_URL the suite skips, matching the other
 * PostgreSQL-backed API specs.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPrismaClient, Prisma } from "@roamlog/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AiConversationService } from "../ai-conversation.service.js";
import type { AiProtocolAdapter, AiStepInput } from "../adapters/adapter.js";
import type { AiAdapterFactory } from "../adapters/index.js";
import { AiSettingsResolver, type AiSettings } from "../ai.settings.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const databaseUrl = testDatabaseUrl ?? "";
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED AI conversation integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Point it at a disposable PostgreSQL database; this spec creates and drops its own schema.\n",
  );
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../");
const databaseRoot = resolve(repoRoot, "packages/db");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const prismaSchema = resolve(databaseRoot, "prisma/schema.prisma");
const schemaName = `ai_conversations_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;

const USER = {
  owner: "0197c0de-0000-7000-8000-000000000201",
  sameWorkspacePeer: "0197c0de-0000-7000-8000-000000000202",
  foreign: "0197c0de-0000-7000-8000-000000000203",
} as const;

const WORKSPACE = {
  home: "0197c0de-0000-7000-8000-000000000101",
  other: "0197c0de-0000-7000-8000-000000000102",
} as const;

const TRIP_ID = "0197c0de-0000-7000-8000-000000000301";

let adminClient: ReturnType<typeof createPrismaClient> | undefined;
let prisma: ReturnType<typeof createPrismaClient> | undefined;

function requiredClient(): ReturnType<typeof createPrismaClient> {
  if (!prisma) {
    throw new Error("The scoped Prisma client is not connected.");
  }
  return prisma;
}

const unconfiguredSettings: AiSettings = {
  protocol: "openai-chat",
  baseUrl: null,
  apiKey: null,
  model: "",
  timeoutMs: 60_000,
  maxOutputTokens: 6_000,
  dailyQuota: 20,
  configured: false,
};

function makeService(options: {
  settings?: AiSettings;
  adapter?: AiProtocolAdapter;
  clock?: () => Date;
} = {}): AiConversationService {
  const settings = options.settings ?? unconfiguredSettings;
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  } as unknown as PinoLoggerService;
  const resolver = {
    resolve: async () => settings,
  } as unknown as AiSettingsResolver;
  const factory: AiAdapterFactory = () => options.adapter;
  return new AiConversationService(
    { client: requiredClient() } as unknown as PrismaService,
    resolver,
    factory,
    logger,
    options.clock ?? (() => new Date("2026-11-20T00:00:00.000Z")),
  );
}

async function createConversation(
  userId: string = USER.owner,
  workspaceId: string = WORKSPACE.home,
): Promise<{ id: string }> {
  return requiredClient().aiConversation.create({
    data: { workspaceId, userId },
    select: { id: true },
  });
}

async function appendUser(
  service: AiConversationService,
  conversationId: string,
  text: string,
  clientId: string = randomUUID(),
): Promise<{ messageId: string; clientId: string; created: boolean }> {
  return service.appendUserMessage({
    workspaceId: WORKSPACE.home,
    conversationId,
    userId: USER.owner,
    clientId,
    text,
  });
}

async function seedFixtures(client: ReturnType<typeof createPrismaClient>): Promise<void> {
  await client.user.createMany({
    data: [
      { id: USER.owner, email: "ai-owner@conversation.test", name: "AI Owner" },
      {
        id: USER.sameWorkspacePeer,
        email: "ai-peer@conversation.test",
        name: "AI Peer",
      },
      { id: USER.foreign, email: "ai-foreign@conversation.test", name: "AI Foreign" },
    ],
  });
  await client.$transaction(async (tx) => {
    await tx.workspace.create({
      data: {
        id: WORKSPACE.home,
        name: "AI Home",
        slug: `ai-home-${randomBytes(3).toString("hex")}`,
        ownerId: USER.owner,
      },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: WORKSPACE.home, userId: USER.owner, role: "owner" },
    });
    await tx.workspace.create({
      data: {
        id: WORKSPACE.other,
        name: "AI Other",
        slug: `ai-other-${randomBytes(3).toString("hex")}`,
        ownerId: USER.foreign,
      },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: WORKSPACE.other, userId: USER.foreign, role: "owner" },
    });
  });
}

integration("AI conversation persistence on real PostgreSQL", () => {
  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("ROAMLOG_TEST_DATABASE_URL disappeared while the suite was loading.");
    }
    if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(schemaName)) {
      throw new Error(`Refusing unsafe test schema name: ${schemaName}`);
    }
    if (!existsSync(prismaCli) || !existsSync(prismaSchema)) {
      throw new Error("The Prisma CLI or the database schema path is unavailable.");
    }

    adminClient = createPrismaClient({ connectionString: databaseUrl });
    await adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminClient.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);

    const scoped = new URL(databaseUrl);
    scoped.searchParams.set("schema", schemaName);
    // The Workspace owner-consistency trigger is a PL/pgSQL function with
    // unqualified table names. `search_path` must therefore point at the test
    // schema too; the adapter's `schema` option only qualifies generated
    // queries, not trigger function bodies.
    scoped.searchParams.set("options", `-c search_path=${schemaName}`);
    const scopedUrl = scoped.toString();

    const migration = spawnSync(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--schema", prismaSchema],
      {
        cwd: databaseRoot,
        env: { ...process.env, DATABASE_URL: scopedUrl },
        encoding: "utf8",
      },
    );
    if (migration.status !== 0) {
      const diagnostic = `${migration.stdout ?? ""}\n${migration.stderr ?? ""}`.trim();
      throw new Error(
        `prisma migrate deploy failed (exit ${String(migration.status)}): ${diagnostic.slice(-2000)}`,
      );
    }

    prisma = createPrismaClient({ connectionString: scopedUrl });
    await prisma.$queryRaw`SELECT 1`;
    await seedFixtures(prisma);
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminClient) {
      try {
        await adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } catch (error) {
        process.stderr.write(`WARN: could not drop ${schemaName}: ${String(error)}\n`);
      }
      await adminClient.$disconnect();
    }
  }, 60_000);

  beforeEach(async () => {
    // Cascade removes messages and streams with the conversations.
    await requiredClient().aiConversation.deleteMany({});
  });

  it("returns 404 AI_CONVERSATION_NOT_FOUND across tenants and across users", async () => {
    const service = makeService();
    const conversation = await createConversation();

    await expect(
      service.fetch(USER.foreign, WORKSPACE.other, conversation.id),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: "AI_CONVERSATION_NOT_FOUND" },
    });

    await expect(
      service.fetch(USER.sameWorkspacePeer, WORKSPACE.home, conversation.id),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: "AI_CONVERSATION_NOT_FOUND" },
    });
  });

  it("hides a soft-deleted conversation from fetch and list", async () => {
    const service = makeService();
    const conversation = await createConversation();
    await appendUser(service, conversation.id, "软删除检查", "soft-delete-user");

    await service.remove(USER.owner, WORKSPACE.home, conversation.id);

    const row = await requiredClient().aiConversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();

    await expect(
      service.fetch(USER.owner, WORKSPACE.home, conversation.id),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: "AI_CONVERSATION_NOT_FOUND" },
    });
    const page = await service.list(USER.owner, WORKSPACE.home, { limit: 30 });
    expect(page.items.map((item) => item.id)).not.toContain(conversation.id);
  });

  it("makes appendUserMessage idempotent by (conversationId, clientId)", async () => {
    const service = makeService();
    const conversation = await createConversation();
    const text = "请帮我规划一个 2028 年 1 月去大理的 3 天慢游行程";

    const first = await appendUser(service, conversation.id, text, "client-user-1");
    const second = await appendUser(service, conversation.id, text, "client-user-1");

    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      messageId: first.messageId,
      clientId: "client-user-1",
      created: false,
    });
    expect(
      await requiredClient().aiMessage.count({
        where: { conversationId: conversation.id, clientId: "client-user-1" },
      }),
    ).toBe(1);

    const row = await requiredClient().aiConversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { title: true, titleSource: true },
    });
    expect(row.titleSource).toBe("placeholder");
    expect(row.title).not.toBeNull();
    expect(Array.from(row.title ?? "")).toHaveLength(24);
  });

  it("makes upsertMessage idempotent by (conversationId, clientId)", async () => {
    const service = makeService();
    const conversation = await createConversation();

    const first = await service.upsertMessage(
      USER.owner,
      WORKSPACE.home,
      conversation.id,
      "assistant-client-1",
      {
        content: [{ type: "text", text: "第一版" }],
        status: { type: "running" },
      },
    );
    const second = await service.upsertMessage(
      USER.owner,
      WORKSPACE.home,
      conversation.id,
      "assistant-client-1",
      {
        content: [{ type: "text", text: "最终版" }],
        status: { type: "complete", reason: "stop" },
      },
    );

    expect(second.id).toBe(first.id);
    expect(second.content).toEqual([{ type: "text", text: "最终版" }]);
    expect(second.status).toEqual({ type: "complete", reason: "stop" });
    expect(
      await requiredClient().aiMessage.count({
        where: { conversationId: conversation.id, clientId: "assistant-client-1" },
      }),
    ).toBe(1);

    const row = await requiredClient().aiMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, clientId: "assistant-client-1" },
      select: { role: true },
    });
    expect(row.role).toBe("assistant");
  });

  it("pages five conversations with limit=2 across three pages without duplicates", async () => {
    const service = makeService();
    const created: string[] = [];
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);

    for (let index = 0; index < 5; index += 1) {
      const conversation = await createConversation();
      await appendUser(service, conversation.id, `对话 ${String(index)}`, `page-${String(index)}`);
      await requiredClient().aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(base + index * 1_000) },
      });
      created.push(conversation.id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
      const page = await service.list(USER.owner, WORKSPACE.home, {
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((item) => item.id));
      if (pageNumber < 2) {
        expect(page.items).toHaveLength(2);
        expect(page.nextCursor).toEqual(expect.any(String));
      } else {
        expect(page.items).toHaveLength(1);
        expect(page.nextCursor).toBeNull();
      }
      cursor = page.nextCursor ?? undefined;
    }

    expect(seen).toEqual([...created].reverse());
    expect(new Set(seen).size).toBe(5);
  });

  it("loadContext returns only this conversation, in ascending order, and truncates old turns", async () => {
    const service = makeService();
    const conversation = await createConversation();

    for (let turn = 1; turn <= 3; turn += 1) {
      const user = await appendUser(
        service,
        conversation.id,
        `第${String(turn)}轮用户`,
        `context-user-${String(turn)}`,
      );
      const modelContext: unknown[] = [
        { role: "user", content: `第${String(turn)}轮用户` },
        { role: "assistant", content: `第${String(turn)}轮回答`, toolCalls: [] },
      ];
      if (turn === 3) {
        modelContext.push({
          role: "tool",
          results: [
            {
              id: "call-trip",
              name: "trips.create",
              content: JSON.stringify({
                ok: true,
                result: { entityId: TRIP_ID, title: "大理三日" },
              }),
            },
          ],
        });
      }
      await requiredClient().aiMessage.create({
        data: {
          conversationId: conversation.id,
          parentId: user.messageId,
          role: "assistant",
          clientId: `context-assistant-${String(turn)}`,
          content: [{ type: "text", text: `第${String(turn)}轮回答` }],
          status: { type: "complete", reason: "stop" },
          modelContext: modelContext as Prisma.InputJsonValue,
        },
      });
    }

    const other = await createConversation();
    await appendUser(service, other.id, "另一个会话不应出现", "other-context-user");

    const recent = await service.loadContext({
      workspaceId: WORKSPACE.home,
      conversationId: conversation.id,
      userId: USER.owner,
      maxTurns: 2,
    });
    const visible = recent.messages as Array<{ role: string; content?: unknown }>;
    expect(visible.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "tool",
    ]);
    expect(visible[0]?.content).toBe("第2轮用户");
    expect(visible[1]?.content).toBe("第2轮回答");
    expect(visible[2]?.content).toBe("第3轮用户");
    expect(JSON.stringify(recent.messages)).not.toContain("另一个会话不应出现");
    expect(recent.facts.lastCreatedTripId).toBe(TRIP_ID);

    const truncated = await service.loadContext({
      workspaceId: WORKSPACE.home,
      conversationId: conversation.id,
      userId: USER.owner,
      maxTurns: 3,
      maxChars: 180,
    });
    expect(JSON.stringify(truncated.messages).length).toBeLessThanOrEqual(180);
    expect(JSON.stringify(truncated.messages)).not.toContain("第1轮用户");
  });

  it("rejects the second concurrent startStream with 409 AI_CONVERSATION_BUSY", async () => {
    const service = makeService();
    const conversation = await createConversation();
    const user = await appendUser(service, conversation.id, "并发流测试", "busy-user");

    const first = await service.startStream({
      workspaceId: WORKSPACE.home,
      conversationId: conversation.id,
      messageId: user.messageId,
    });
    expect(first.streamId).toEqual(expect.any(String));

    await expect(
      service.startStream({
        workspaceId: WORKSPACE.home,
        conversationId: conversation.id,
        messageId: user.messageId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "AI_CONVERSATION_BUSY" },
    });

    expect(
      await requiredClient().aiStream.count({
        where: { conversationId: conversation.id, status: "active" },
      }),
    ).toBe(1);
  });

  it("finishAssistantMessage persists the three terminal finish reasons correctly", async () => {
    const service = makeService();
    const cases = [
      {
        reason: "stop" as const,
        status: { type: "complete", reason: "stop" },
        streamStatus: "completed",
        errorCode: null,
      },
      {
        reason: "aborted" as const,
        status: { type: "incomplete", reason: "cancelled" },
        streamStatus: "aborted",
        errorCode: null,
      },
      {
        reason: "error" as const,
        status: {
          type: "incomplete",
          reason: "error",
          error: { code: "AI_UPSTREAM", message: "boom" },
        },
        streamStatus: "failed",
        errorCode: "AI_UPSTREAM",
      },
    ];

    for (const entry of cases) {
      const conversation = await createConversation();
      const user = await appendUser(
        service,
        conversation.id,
        `finish-${entry.reason}`,
        `finish-user-${entry.reason}`,
      );
      const stream = await service.startStream({
        workspaceId: WORKSPACE.home,
        conversationId: conversation.id,
        messageId: user.messageId,
      });

      await service.finishAssistantMessage({
        workspaceId: WORKSPACE.home,
        conversationId: conversation.id,
        streamId: stream.streamId,
        clientId: `assistant-${entry.reason}`,
        content: [{ type: "text", text: `answer-${entry.reason}` }],
        status: entry.status,
        modelContext: [
          { role: "user", content: `finish-${entry.reason}` },
          { role: "assistant", content: `answer-${entry.reason}`, toolCalls: [] },
        ],
        metadata: {
          provider: { protocol: "openai-chat", model: "test-model" },
          ...(entry.reason === "error"
            ? { error: { code: "AI_UPSTREAM", message: "boom" } }
            : {}),
        },
        finishReason: entry.reason,
      });

      const streamRow = await requiredClient().aiStream.findUniqueOrThrow({
        where: { id: stream.streamId },
        select: { status: true, errorCode: true },
      });
      expect(streamRow.status).toBe(entry.streamStatus);
      expect(streamRow.errorCode).toBe(entry.errorCode);

      const message = await requiredClient().aiMessage.findFirstOrThrow({
        where: { conversationId: conversation.id, clientId: `assistant-${entry.reason}` },
        select: { content: true, status: true, metadata: true },
      });
      expect(message.content).toEqual([{ type: "text", text: `answer-${entry.reason}` }]);
      expect(message.status).toEqual(entry.status);
      expect(message.metadata).toMatchObject({ finishReason: entry.reason });
    }
  });

  it("generateTitle returns 503 AI_NOT_CONFIGURED and never fakes a model title", async () => {
    const service = makeService();
    const conversation = await createConversation();
    await appendUser(service, conversation.id, "帮我规划去大理的行程", "title-unconfigured");

    await expect(
      service.generateTitle(USER.owner, WORKSPACE.home, conversation.id),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: "AI_NOT_CONFIGURED" },
    });

    const row = await requiredClient().aiConversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { title: true, titleSource: true },
    });
    expect(row.titleSource).toBe("placeholder");
    expect(row.title).not.toBeNull();
  });

  it("generateTitle calls the model with a small Chinese prompt and records titleSource=model", async () => {
    const step = vi.fn(async (_input: AiStepInput) => ({
      text: "「大理三日慢游」",
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 4 },
    }));
    const adapter: AiProtocolAdapter = {
      protocol: "openai-chat",
      step,
    };
    const service = makeService({
      settings: {
        ...unconfiguredSettings,
        baseUrl: "http://127.0.0.1:3425/v1",
        model: "test-model",
        configured: true,
      },
      adapter,
    });
    const conversation = await createConversation();
    await appendUser(service, conversation.id, "帮我规划去大理的行程", "title-configured");

    const result = await service.generateTitle(USER.owner, WORKSPACE.home, conversation.id);
    expect(result.title).toBe("大理三日慢游");
    expect(step).toHaveBeenCalledTimes(1);

    const input = step.mock.calls[0]![0];
    expect(input.maxTokens).toBeLessThanOrEqual(64);
    expect(input.system).toContain("中文标题");
    expect(JSON.stringify(input.messages[0])).toContain("帮我规划去大理的行程");

    const row = await requiredClient().aiConversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { title: true, titleSource: true },
    });
    expect(row).toMatchObject({ title: "大理三日慢游", titleSource: "model" });

    await service.generateTitle(USER.owner, WORKSPACE.home, conversation.id);
    expect(step).toHaveBeenCalledTimes(1);
  });
});
