/**
 * `POST /v1/workspaces/:workspaceId/ai/chat/stream` end-to-end on real
 * PostgreSQL (`.audit/ai-port-spec.md` §1.3, §1.4, §2.6).
 *
 * The suite uses a real Nest application, the real `AiPlanService` and the real
 * `AiConversationService`; only the LLM adapter, the quota counter and the run
 * store are controlled fakes. That is deliberate: frame ordering, abort
 * propagation and the persistence state machine are exactly the parts a mocked
 * service would hide.
 *
 * Without ROAMLOG_TEST_DATABASE_URL the suite skips, matching the other
 * PostgreSQL-backed API specs.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import {
  AI_STREAM_DELTA_MAX_CHARS,
  AiStreamEventSchema,
  type AiStreamEvent,
} from "@roamlog/contracts";
import { createPrismaClient } from "@roamlog/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequest } from "../../../common/guards/actor-context.js";
import { ProblemDetailsFilter } from "../../../common/filters/problem-details.filter.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import { RolesGuard } from "../../../common/guards/roles.guard.js";
import { SessionGuard } from "../../../common/guards/session.guard.js";
import { TenantGuard } from "../../../common/guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../../../common/guards/verified-email.guard.js";
import { WorkspaceAccessService } from "../../../common/services/workspace-access.service.js";
import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type {
  AiProtocolAdapter,
  AiStepInput,
  AiStepResult,
  AiStreamOptions,
} from "../adapters/adapter.js";
import { AiUpstreamError } from "../adapters/http.js";
import { AI_SSE_HEARTBEAT_MS, AiController } from "../ai.controller.js";
import { AiConversationService } from "../ai-conversation.service.js";
import { AiExecuteService } from "../ai-execute.service.js";
import { AiPlanService } from "../ai-plan.service.js";
import { AiRewriteService } from "../ai-rewrite.service.js";
import { AiToolbox } from "../ai-tools.js";
import {
  AI_CLOCK,
  AI_SETTINGS_SOURCE,
  AiSettingsResolver,
  staticAiSettingsSource,
  type AiSettings,
} from "../ai.settings.js";
import { AI_ADAPTER_FACTORY } from "../adapters/index.js";
import {
  actorStub,
  aiSettings,
  fixedClock,
  loggerStub,
  membershipStub,
  quotaStub,
  runStoreStub,
  toolServiceMocks,
  USER_ID,
  WORKSPACE_ID,
} from "./ai-fixtures.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const databaseUrl = testDatabaseUrl ?? "";
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED AI stream e2e test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Point it at a disposable PostgreSQL database; this spec creates and drops its own schema.\n",
  );
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../");
const databaseRoot = resolve(repoRoot, "packages/db");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const prismaSchema = resolve(databaseRoot, "prisma/schema.prisma");
const schemaName = `ai_stream_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;

let adminClient: ReturnType<typeof createPrismaClient> | undefined;
let prisma: ReturnType<typeof createPrismaClient> | undefined;
const apps: INestApplication[] = [];

function requiredClient(): ReturnType<typeof createPrismaClient> {
  if (!prisma) {
    throw new Error("The scoped Prisma client is not connected.");
  }
  return prisma;
}

// ---------------------------------------------------------------------------
// Fake upstream adapter
// ---------------------------------------------------------------------------

interface ScriptedTurn {
  readonly deltas: readonly string[];
  readonly delayMs?: number;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
  readonly toolCalls?: readonly { id: string; name: string; input: Record<string, unknown> }[];
  /** Thrown after all deltas were emitted, simulating an upstream mid-stream failure. */
  readonly errorAfter?: Error;
}

class FakeAdapter implements AiProtocolAdapter {
  readonly protocol = "openai-chat" as const;
  readonly inputs: AiStepInput[] = [];
  readonly signals: Array<AbortSignal | undefined> = [];
  private index = 0;

  constructor(private readonly turns: readonly ScriptedTurn[]) {}

  async step(input: AiStepInput): Promise<AiStepResult> {
    return this.streamStep(input, {});
  }

  async streamStep(input: AiStepInput, options: AiStreamOptions = {}): Promise<AiStepResult> {
    this.inputs.push(input);
    this.signals.push(options.signal);
    const turn = this.turns[this.index] ?? { deltas: ["Done."] };
    this.index += 1;

    for (const delta of turn.deltas) {
      if (turn.delayMs !== undefined) {
        await sleep(turn.delayMs, options.signal);
      }
      if (options.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      await options.onDelta?.(delta);
    }
    if (turn.errorAfter) {
      throw turn.errorAfter;
    }
    return {
      text: turn.deltas.length > 0 ? turn.deltas.join("") : null,
      toolCalls: turn.toolCalls ?? [],
      usage: turn.usage ?? {},
    };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Nest application
// ---------------------------------------------------------------------------

async function createApp(
  options: {
    readonly settings?: AiSettings;
    readonly adapter?: FakeAdapter;
    readonly heartbeatMs?: number;
  } = {},
): Promise<{ app: INestApplication; url: string; adapter: FakeAdapter }> {
  const settings = options.settings ?? aiSettings();
  const adapter = options.adapter ?? new FakeAdapter([{ deltas: ["Done."] }]);
  const tools = toolServiceMocks();
  const toolbox = new AiToolbox(
    tools.places as never,
    tools.trips as never,
    tools.stops as never,
    tools.itinerary as never,
    tools.packing as never,
  );
  const logger = loggerStub() as unknown as PinoLoggerService;
  const clock = fixedClock();
  const conversations = new AiConversationService(
    { client: requiredClient() } as unknown as PrismaService,
    { resolve: async () => settings } as unknown as AiSettingsResolver,
    () => adapter,
    logger,
    clock,
  );
  const planner = new AiPlanService(
    staticAiSettingsSource(settings),
    () => (settings.configured ? adapter : undefined),
    toolbox,
    quotaStub() as never,
    runStoreStub() as never,
    logger,
    clock,
    conversations,
    { client: requiredClient() } as unknown as PrismaService,
  );

  const moduleRef = await Test.createTestingModule({
    controllers: [AiController],
    providers: [
      { provide: AI_SSE_HEARTBEAT_MS, useValue: options.heartbeatMs ?? 15_000 },
      { provide: AiPlanService, useValue: planner },
      { provide: AiExecuteService, useValue: { execute: vi.fn() } },
      { provide: AiRewriteService, useValue: { rewrite: vi.fn() } },
      { provide: AI_SETTINGS_SOURCE, useValue: staticAiSettingsSource(settings) },
      { provide: AI_ADAPTER_FACTORY, useValue: () => (settings.configured ? adapter : undefined) },
      { provide: AI_CLOCK, useValue: clock },
      { provide: PinoLoggerService, useValue: logger },
      PermissionService,
      RolesGuard,
      TenantGuard,
      { provide: SessionGuard, useValue: { canActivate: () => true } },
      { provide: VerifiedEmailGuard, useValue: { canActivate: () => true } },
      { provide: WorkspaceAccessService, useValue: {} },
    ],
  })
    .overrideGuard(TenantGuard)
    .useValue({
      canActivate: (context: {
        switchToHttp: () => { getRequest: () => AuthenticatedRequest };
      }) => {
        const request = context.switchToHttp().getRequest();
        request.user = actorStub().user as never;
        request.workspaceMembership = membershipStub("editor") as never;
        return true;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(
    new ProblemDetailsFilter(logger as never, { captureException: vi.fn() } as never),
  );
  await app.listen(0, "127.0.0.1");
  apps.push(app);
  return { app, url: await app.getUrl(), adapter };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

interface ParsedFrame {
  readonly id?: string;
  readonly event?: string;
  readonly data: string;
}

function parseFrames(raw: string): ParsedFrame[] {
  const frames: ParsedFrame[] = [];
  for (const block of raw.split(/\r?\n\r?\n/u)) {
    const data: string[] = [];
    let id: string | undefined;
    let event: string | undefined;
    for (const line of block.split(/\r?\n/u)) {
      if (line.length === 0 || line.startsWith(":")) {
        continue;
      }
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /u, "");
      if (field === "id") {
        id = value;
      } else if (field === "event") {
        event = value;
      } else if (field === "data") {
        data.push(value);
      }
    }
    if (data.length > 0) {
      frames.push({ ...(id === undefined ? {} : { id }), ...(event === undefined ? {} : { event }), data: data.join("\n") });
    }
  }
  return frames;
}

function eventsOf(frames: readonly ParsedFrame[]): AiStreamEvent[] {
  return frames.map((frame) => JSON.parse(frame.data) as AiStreamEvent);
}

async function postStream(
  baseUrl: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${baseUrl}/v1/workspaces/${WORKSPACE_ID}/ai/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

const CONFIRM_BRIEF_ARGS = {
  title: "确认行程需求",
  summary: "创建 2027-01-01 到 2027-01-03 的测试行程。",
  constraints: ["测试行程"],
  assumptions: ["日期为 2027-01-01 到 2027-01-03"],
} as const;

/**
 * The write/read-only tool tests must use the same human gate as production:
 * the first request pauses on confirm_brief, and only the resumed request may
 * receive write tools or emit a plan.
 */
async function approveBrief(
  baseUrl: string,
  message: string,
): Promise<{ first: AiStreamEvent[]; events: AiStreamEvent[] }> {
  const firstResponse = await postStream(baseUrl, { message });
  expect(firstResponse.status).toBe(200);
  const first = eventsOf(parseFrames(await firstResponse.text()));
  const meta = first.find(
    (event): event is Extract<AiStreamEvent, { type: "meta" }> => event.type === "meta",
  );
  const human = first.find(
    (event): event is Extract<AiStreamEvent, { type: "human.request" }> =>
      event.type === "human.request",
  );

  expect(meta?.conversationId).toBeTruthy();
  expect(human).toMatchObject({
    type: "human.request",
    name: "confirm_brief",
  });
  expect(first.some((event) => event.type === "plan")).toBe(false);
  expect(first.at(-1)).toMatchObject({ type: "done", finishReason: "requires-action" });

  const resumed = await postStream(baseUrl, {
    conversationId: meta!.conversationId,
    humanToolResult: {
      toolCallId: human!.toolCallId,
      name: "confirm_brief",
      result: { approved: true },
    },
  });
  expect(resumed.status).toBe(200);
  return { first, events: eventsOf(parseFrames(await resumed.text())) };
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the expected state.");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

async function seedFixtures(client: ReturnType<typeof createPrismaClient>): Promise<void> {
  await client.user.create({
    data: { id: USER_ID, email: "ai-stream-owner@stream.test", name: "AI Stream Owner" },
  });
  // The workspace owner-consistency trigger is deferred to commit time, so the
  // workspace and its owner membership must be written in one transaction.
  await client.$transaction(async (tx) => {
    await tx.workspace.create({
      data: {
        id: WORKSPACE_ID,
        name: "AI Stream",
        slug: `ai-stream-${randomBytes(3).toString("hex")}`,
        ownerId: USER_ID,
      },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: WORKSPACE_ID, userId: USER_ID, role: "owner" },
    });
  });
}

integration("AI chat SSE stream on real PostgreSQL", () => {
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
    // Trigger functions use unqualified table names, so the search_path must
    // point at the test schema as well.
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

  it("streams meta → text.delta×3 → usage → done with increasing ids, heartbeats and persisted rows", async () => {
    const adapter = new FakeAdapter([
      {
        deltas: ["北", "京", "欢迎"],
        delayMs: 80,
        usage: { inputTokens: 11, outputTokens: 7 },
      },
    ]);
    const { url } = await createApp({ adapter, heartbeatMs: 50 });

    const response = await postStream(url, { message: "你好，介绍一下北京" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const raw = await response.text();
    const frames = parseFrames(raw);
    const events = eventsOf(frames);

    // `progress` is the appended seventh event type; the six frozen events keep
    // their exact shapes and order relative to each other.
    expect(events.map((event) => event.type)).toEqual([
      "meta",
      "progress",
      "text.delta",
      "text.delta",
      "text.delta",
      "usage",
      "done",
    ]);
    expect(events[1]).toMatchObject({
      type: "progress",
      stage: "thinking",
      label: "正在思考…",
    });
    expect(frames.map((frame) => Number(frame.id))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(frames.length);

    const meta = events[0];
    expect(meta).toMatchObject({
      type: "meta",
      v: 1,
      provider: { protocol: "openai-chat", model: "auto/deepseek-v4.1-flash" },
    });
    expect((meta as { conversationId: string }).conversationId).toMatch(/^[0-9a-f-]{36}$/u);

    const deltas = events.filter((event) => event.type === "text.delta") as Array<{
      type: "text.delta";
      delta: string;
    }>;
    expect(deltas.map((event) => event.delta)).toEqual(["北", "京", "欢迎"]);
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(raw).toMatch(/: hb \d{4}-\d{2}-\d{2}T/u);

    // §2.6: the write must land in PostgreSQL, not only in memory.
    const client = requiredClient();
    const conversations = await client.aiConversation.findMany({
      where: { workspaceId: WORKSPACE_ID },
    });
    expect(conversations).toHaveLength(1);
    const conversationId = conversations[0]?.id;
    expect(conversationId).toBeTruthy();

    const messages = await client.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
    const assistant = messages.filter((message) => message.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.clientId).toBe((meta as { assistantMessageId: string }).assistantMessageId);
    expect(assistant[0]?.modelContext).not.toBeNull();
    expect(Array.isArray(assistant[0]?.modelContext)).toBe(true);
    expect(assistant[0]?.status).toMatchObject({ type: "complete", reason: "stop" });

    const stream = await client.aiStream.findFirst({ where: { conversationId } });
    expect(stream?.status).toBe("completed");
  }, 60_000);

  it("aborts the upstream and persists AiStream=aborted / assistant=incomplete/cancelled when the client disconnects", async () => {
    const adapter = new FakeAdapter([
      { deltas: ["一", "二", "三", "四"], delayMs: 120 },
    ]);
    const { url } = await createApp({ adapter, heartbeatMs: 1_000 });

    const client = new AbortController();
    const response = await postStream(url, { message: "慢慢说" }, client.signal);
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    let raw = "";
    const decoder = new TextDecoder();
    while (!raw.includes("event: text.delta")) {
      const chunk = await reader!.read();
      if (chunk.done) {
        throw new Error("The stream ended before the first text delta.");
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }

    expect(adapter.signals[0]?.aborted).toBe(false);
    client.abort();

    await waitFor(() => adapter.signals[0]?.aborted === true);
    await waitFor(async () => {
      const stream = await requiredClient().aiStream.findFirst({});
      return stream?.status === "aborted";
    });

    const clientId = JSON.parse(
      raw
        .split(/\r?\n\r?\n/u)
        .map((block) => block.split(/\r?\n/u).find((line) => line.startsWith("data: ")))
        .filter((line): line is string => Boolean(line))
        .map((line) => line.slice(6))[0] ?? "{}",
    ) as { assistantMessageId?: string };
    expect(clientId.assistantMessageId).toBeTruthy();

    const assistant = await requiredClient().aiMessage.findFirst({
      where: { role: "assistant" },
    });
    expect(assistant?.status).toMatchObject({ type: "incomplete", reason: "cancelled" });
    expect(assistant?.clientId).toBe(clientId.assistantMessageId);
  }, 60_000);

  it("splits an oversized upstream delta so every HTTP SSE frame obeys the contract cap", async () => {
    const text = "a".repeat(AI_STREAM_DELTA_MAX_CHARS + 512);
    const adapter = new FakeAdapter([{ deltas: [text] }]);
    const { url } = await createApp({ adapter, heartbeatMs: 1_000 });

    const response = await postStream(url, { message: "生成长文本" });
    expect(response.status).toBe(200);

    const frames = parseFrames(await response.text());
    const events = eventsOf(frames);
    const deltas = events.filter(
      (event): event is Extract<AiStreamEvent, { type: "text.delta" }> =>
        event.type === "text.delta",
    );

    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((event) => event.delta).join("")).toBe(text);
    expect(deltas.every((event) => event.delta.length <= AI_STREAM_DELTA_MAX_CHARS)).toBe(
      true,
    );
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(frames.length);
    for (const event of events) {
      expect(AiStreamEventSchema.safeParse(event).success).toBe(true);
    }
  }, 60_000);

  it("converts an upstream error after flush into error + done(error) while HTTP stays 200", async () => {
    const adapter = new FakeAdapter([
      {
        deltas: ["半截"],
        delayMs: 5,
        errorAfter: new AiUpstreamError("http", 502),
      },
    ]);
    const { url } = await createApp({ adapter, heartbeatMs: 1_000 });

    const response = await postStream(url, { message: "触发上游错误" });
    expect(response.status).toBe(200);
    const raw = await response.text();
    const events = eventsOf(parseFrames(raw));

    const errorIndex = events.findIndex((event) => event.type === "error");
    expect(errorIndex).toBeGreaterThanOrEqual(0);
    expect(events[errorIndex]).toMatchObject({
      type: "error",
      code: "AI_UPSTREAM",
      retryable: true,
    });
    expect(events[errorIndex + 1]).toMatchObject({
      type: "done",
      finishReason: "error",
    });
    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);

    const client = requiredClient();
    const stream = await client.aiStream.findFirst({});
    expect(stream?.status).toBe("failed");
    const assistant = await client.aiMessage.findFirst({ where: { role: "assistant" } });
    expect(assistant?.status).toMatchObject({
      type: "incomplete",
      reason: "error",
      error: { code: "AI_UPSTREAM" },
    });
  }, 60_000);

  it("returns a plain 503 JSON (no SSE, no rows) when the model is not configured", async () => {
    const { url } = await createApp({
      settings: aiSettings({ configured: false, baseUrl: null }),
    });

    const response = await postStream(url, { message: "没有配置" });
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toMatch(/json/u);
    expect(await response.json()).toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(await requiredClient().aiConversation.count()).toBe(0);
  }, 60_000);

  it("loads conversation history into the adapter on the second turn (代词指代)", async () => {
    const adapter = new FakeAdapter([
      { deltas: ["第一轮完成"] },
      { deltas: ["第二轮完成"] },
    ]);
    const { url } = await createApp({ adapter, heartbeatMs: 1_000 });

    const firstResponse = await postStream(url, { message: "建一个 3 天行程，标题「大理三日慢游」" });
    const firstRaw = await firstResponse.text();
    const firstMeta = eventsOf(parseFrames(firstRaw))[0] as { conversationId: string };
    expect(firstMeta.conversationId).toBeTruthy();

    const secondResponse = await postStream(url, {
      conversationId: firstMeta.conversationId,
      message: "把它改成 6 天",
    });
    expect(secondResponse.status).toBe(200);
    const secondEvents = eventsOf(parseFrames(await secondResponse.text()));
    expect(secondEvents.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });

    expect(adapter.inputs).toHaveLength(2);
    const secondMessages = adapter.inputs[1]?.messages ?? [];
    const roles = secondMessages.map((message) => message.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    expect(secondMessages[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("大理三日慢游"),
    });
    expect(secondMessages[1]).toMatchObject({ role: "assistant", content: "第一轮完成" });
    expect(secondMessages[2]).toMatchObject({
      role: "user",
      content: expect.stringContaining("把它改成 6 天"),
    });
  }, 60_000);

  it("repairs a user message that the history endpoint pre-created with role=assistant", async () => {
    const adapter = new FakeAdapter([{ deltas: ["收到"] }]);
    const { url } = await createApp({ adapter, heartbeatMs: 1_000 });
    const client = requiredClient();

    // Reproduces ThreadHistoryAdapter.append() winning the race: the row exists
    // with the user's clientId but `upsertMessage` created it as assistant.
    const conversation = await client.aiConversation.create({
      data: { workspaceId: WORKSPACE_ID, userId: USER_ID },
      select: { id: true },
    });
    const inserted = await client.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: "这条消息是用户发的",
        clientId: "client-preexisting-user",
      },
      select: { id: true },
    });

    const response = await postStream(url, {
      conversationId: conversation.id,
      clientMessageId: "client-preexisting-user",
      message: "这条消息是用户发的",
    });
    expect(response.status).toBe(200);
    const events = eventsOf(parseFrames(await response.text()));
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });

    // The pre-created row must not also reach the model as an extra user turn.
    expect(adapter.inputs[0]?.messages.map((message) => message.role)).toEqual(["user"]);

    const repaired = await client.aiMessage.findUniqueOrThrow({
      where: { id: inserted.id },
      select: { role: true },
    });
    expect(repaired.role).toBe("user");
    expect(
      await client.aiMessage.count({
        where: { conversationId: conversation.id, clientId: "client-preexisting-user" },
      }),
    ).toBe(1);
  }, 60_000);

  it("emits Chinese progress during a read-only tool round and keeps done last and unique", async () => {
    const adapter = new FakeAdapter([
      {
        deltas: ["我先查一下。"],
        toolCalls: [
          { id: "call_place_1", name: "places.search", input: { q: "京都" } },
          { id: "call_place_2", name: "places.search", input: { q: "清水寺" } },
          { id: "call_trips", name: "trips.list", input: {} },
        ],
        usage: { inputTokens: 12, outputTokens: 4 },
      },
      { deltas: ["找到了。"], usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
    const { url } = await createApp({ adapter, heartbeatMs: 1_000 });

    const response = await postStream(url, { message: "查一下京都" });
    expect(response.status).toBe(200);
    const events = eventsOf(parseFrames(await response.text()));
    const progress = events.filter((event) => event.type === "progress") as Array<{
      type: "progress";
      stage: string;
      label: string;
    }>;

    expect(progress.length).toBeGreaterThan(0);
    // Every status line is Chinese and short enough for the bubble.
    for (const event of progress) {
      expect(event.label).toMatch(/[\u4e00-\u9fff]/u);
      expect(event.label.length).toBeLessThanOrEqual(40);
    }
    expect(
      progress.some(
        (event) => event.stage === "thinking" && event.label === "正在思考…",
      ),
    ).toBe(true);
    expect(
      progress.some(
        (event) => event.stage === "searching" && event.label === "正在查询地点（1/2）",
      ),
    ).toBe(true);
    expect(
      progress.some(
        (event) => event.stage === "searching" && event.label === "正在查询地点（2/2）",
      ),
    ).toBe(true);
    expect(
      progress.some(
        (event) => event.stage === "reading" && event.label === "正在读取行程…",
      ),
    ).toBe(true);

    // The append-only event must never disturb the terminal-frame contract.
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("done");
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });
  }, 60_000);

  it("requires a confirmed brief, then emits plan exactly once before usage/done", async () => {
    const adapter = new FakeAdapter([
      {
        deltas: ["请确认需求摘要。"],
        toolCalls: [
          {
            id: "brief_1",
            name: "confirm_brief",
            input: CONFIRM_BRIEF_ARGS,
          },
        ],
        usage: { inputTokens: 8, outputTokens: 4 },
      },
      {
        deltas: ["计划如下"],
        toolCalls: [
          {
            id: "call_1",
            name: "trips.create",
            input: { title: "测试行程", startDate: "2027-01-01", endDate: "2027-01-03" },
          },
        ],
        usage: { inputTokens: 20, outputTokens: 10 },
      },
      { deltas: ["完成"], usage: { inputTokens: 5, outputTokens: 2 } },
    ]);
    const { url } = await createApp({ adapter, heartbeatMs: 1_000 });

    const { events } = await approveBrief(url, "建一个测试行程");
    const types = events.map((event) => event.type);

    expect(types.filter((type) => type === "meta")).toHaveLength(1);
    expect(types.filter((type) => type === "plan")).toHaveLength(1);
    expect(types.filter((type) => type === "done")).toHaveLength(1);
    expect(types.at(-1)).toBe("done");
    expect(types.indexOf("plan")).toBeGreaterThan(types.indexOf("text.delta"));
    expect(types.indexOf("plan")).toBeLessThan(types.indexOf("usage"));
    expect(types.indexOf("usage")).toBeLessThan(types.indexOf("done"));

    const plan = events.find((event) => event.type === "plan");
    expect(plan).toMatchObject({
      type: "plan",
      plannedCalls: [
        {
          tool: "trips.create",
          args: { title: "测试行程", startDate: "2027-01-01", endDate: "2027-01-03" },
        },
      ],
    });
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "tool-calls" });

    const assistant = await requiredClient().aiMessage.findFirst({
      where: { role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    expect(assistant?.status).toMatchObject({ type: "complete", reason: "tool-calls" });
    expect(assistant?.metadata).toMatchObject({ finishReason: "tool-calls" });
  }, 60_000);

  it("requires a confirmed brief, then emits tool.start → tool.end before plan/usage/done", async () => {
    const adapter = new FakeAdapter([
      {
        deltas: ["请确认需求摘要。"],
        toolCalls: [
          {
            id: "brief_2",
            name: "confirm_brief",
            input: CONFIRM_BRIEF_ARGS,
          },
        ],
        usage: { inputTokens: 8, outputTokens: 4 },
      },
      {
        deltas: ["我先查一下。"],
        toolCalls: [
          { id: "call_place_1", name: "places.search", input: { q: "京都" } },
          { id: "call_place_2", name: "places.search", input: { q: "清水寺" } },
          {
            id: "call_plan_1",
            name: "trips.create",
            input: { title: "京都行程", startDate: "2027-04-01", endDate: "2027-04-03" },
          },
        ],
        usage: { inputTokens: 12, outputTokens: 4 },
      },
      { deltas: ["完成"], usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
    const { url } = await createApp({ adapter, heartbeatMs: 1_000 });

    const { events } = await approveBrief(url, "帮我做京都三天行程");
    const types = events.map((event) => event.type);

    const starts = events.filter((event) => event.type === "tool.start") as Array<{
      type: "tool.start";
      toolCallId: string;
      name: string;
      stepId?: string;
    }>;
    const ends = events.filter((event) => event.type === "tool.end") as Array<{
      type: "tool.end";
      toolCallId: string;
      status: string;
      durationMs: number;
    }>;
    const toolProgress = events.filter((event) => event.type === "tool.progress") as Array<{
      type: "tool.progress";
      toolCallId: string;
      label?: string;
    }>;

    // Two parallel places.search calls → exactly two starts, two ends, and each
    // toolCallId starts once (reconnects upsert by id, they never append).
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    expect(toolProgress).toHaveLength(2);
    const startIds = starts.map((event) => event.toolCallId);
    expect(new Set(startIds).size).toBe(startIds.length);
    for (const id of startIds) {
      expect(starts.filter((event) => event.toolCallId === id)).toHaveLength(1);
      expect(ends.filter((event) => event.toolCallId === id)).toHaveLength(1);
      expect(toolProgress.filter((event) => event.toolCallId === id)).toHaveLength(1);
    }

    // Ordering: tool.start → tool.end → plan → usage → done.
    expect(types.indexOf("tool.start")).toBeGreaterThan(-1);
    expect(types.indexOf("tool.end")).toBeGreaterThan(types.indexOf("tool.start"));
    expect(types.indexOf("plan")).toBeGreaterThan(types.indexOf("tool.end"));
    expect(types.indexOf("usage")).toBeGreaterThan(types.indexOf("plan"));
    expect(types.indexOf("done")).toBeGreaterThan(types.indexOf("usage"));
    expect(types.filter((type) => type === "done")).toHaveLength(1);
    expect(types.at(-1)).toBe("done");

    for (const end of ends) {
      expect(end.status).toBe("ok");
      expect(Number.isInteger(end.durationMs)).toBe(true);
      expect(end.durationMs).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);
});
