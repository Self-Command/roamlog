import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@roamlog/db";
import type {
  AiConversation,
  AiConversationListQuery,
  AiConversationListResponse,
  AiConversationMessagesResponse,
  AiConversationTitleResponse,
  AiThreadMessage,
  DeleteAiMessagesRequest,
  UpdateAiConversationRequest,
  UpsertAiMessageRequest,
} from "@roamlog/contracts";

import { AI_ADAPTER_FACTORY, type AiAdapterFactory } from "./adapters/index.js";
import { AiSettingsResolver, AI_CLOCK, type AiClock, type AiSettings } from "./ai.settings.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Frozen public surface from `.audit/ai-port-spec.md` §2.7.
 *
 * `api_ai_stream` imports the implementation class and must not need a second
 * implementation of persistence. `AiConversationService` implements this shape
 * method-for-method; the interface stays separate only to keep the lint rule
 * against unsafe class/interface declaration merging happy.
 */
export interface AiConversationServiceContract {
  getOrCreate(input: {
    workspaceId: string;
    userId: string;
    conversationId?: string;
    title?: string;
  }): Promise<{ id: string; title: string | null }>;

  appendUserMessage(input: {
    workspaceId: string;
    conversationId: string;
    userId: string;
    clientId?: string;
    text: string;
  }): Promise<{ messageId: string; clientId: string; created: boolean }>;

  startStream(input: {
    workspaceId: string;
    conversationId: string;
    messageId: string;
  }): Promise<{ streamId: string }>;

  finishAssistantMessage(input: {
    workspaceId: string;
    conversationId: string;
    streamId: string;
    clientId: string;
    content: readonly unknown[];
    status: Record<string, unknown>;
    modelContext?: readonly unknown[];
    metadata?: Record<string, unknown>;
    finishReason: "stop" | "tool-calls" | "length" | "aborted" | "error";
  }): Promise<void>;

  loadContext(input: {
    workspaceId: string;
    conversationId: string;
    userId: string;
    maxChars?: number;
    maxTurns?: number;
  }): Promise<{ messages: readonly unknown[]; facts: Record<string, unknown> }>;
}

interface ConversationRow {
  id: string;
  workspaceId: string;
  userId: string;
  title: string | null;
  titleSource: string;
  status: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageRow {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: string;
  content: unknown;
  status: unknown;
  clientId: string | null;
  modelContext: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface Turn {
  readonly messages: unknown[];
  readonly createdAt: Date;
}

const CONVERSATION_SELECT = {
  id: true,
  workspaceId: true,
  userId: true,
  title: true,
  titleSource: true,
  status: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AiConversationSelect;

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  parentId: true,
  role: true,
  content: true,
  status: true,
  clientId: true,
  modelContext: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AiMessageSelect;

/** A stream created more recently than this blocks a second start. */
export const AI_STREAM_BUSY_WINDOW_MS = 90_000;

/** Defaults for the compiled model context. */
export const AI_CONTEXT_DEFAULT_TURNS = 20;
export const AI_CONTEXT_DEFAULT_CHARS = 24_000;

const TITLE_MAX_CHARS = 120;
const TITLE_PROMPT_MAX_CHARS = 2_000;
const TITLE_MAX_OUTPUT_TOKENS = 64;

/**
 * DB-backed implementation of the AI conversation persistence contract.
 *
 * Tenant isolation is invariant: every query that starts from a
 * `conversationId` also carries `workspaceId`, and every user-facing query also
 * carries the owning `userId`. A mismatch is deliberately reported as the same
 * 404 as a missing conversation, so a leaked id cannot confirm existence in a
 * different workspace.
 *
 * Concurrency is guarded by a PostgreSQL row lock (`SELECT ... FOR UPDATE`) on
 * the conversation row in `startStream`. The alternative considered was a
 * Redis lock (`ai:stream:lock:<id>`, TTL 90 s), but the `AiStream` row itself is
 * the durable source of truth and a DB row lock cannot drift from it or expire
 * while a request still runs. See `startStream` for the exact ordering.
 */
@Injectable()
export class AiConversationService implements AiConversationServiceContract {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiSettingsResolver) private readonly settingsResolver: AiSettingsResolver,
    @Inject(AI_ADAPTER_FACTORY) private readonly adapterFactory: AiAdapterFactory,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Optional() @Inject(AI_CLOCK) private readonly clock: AiClock = () => new Date(),
  ) {}

  // -------------------------------------------------------------------------
  // §2.7 frozen five-method surface
  // -------------------------------------------------------------------------

  async getOrCreate(input: {
    workspaceId: string;
    userId: string;
    conversationId?: string;
    title?: string;
  }): Promise<{ id: string; title: string | null }> {
    if (input.conversationId) {
      const existing = await this.requireConversation(
        input.workspaceId,
        input.conversationId,
        input.userId,
      );
      return { id: existing.id, title: existing.title };
    }

    const title = input.title?.trim() || null;
    const created = await this.prisma.client.aiConversation.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        title,
        // A title supplied by the caller is an explicit, user-visible choice.
        // Background summarisation must never overwrite it.
        titleSource: title ? "manual" : "placeholder",
      },
      select: { id: true, title: true },
    });
    return created;
  }

  async appendUserMessage(input: {
    workspaceId: string;
    conversationId: string;
    userId: string;
    clientId?: string;
    text: string;
  }): Promise<{ messageId: string; clientId: string; created: boolean }> {
    await this.requireConversation(input.workspaceId, input.conversationId, input.userId);
    if (!input.text.trim()) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A user message cannot be empty.",
      });
    }

    const clientId = input.clientId?.trim() || randomUUID();
    const existing = await this.prisma.client.aiMessage.findFirst({
      where: { conversationId: input.conversationId, clientId },
      select: { id: true },
    });
    if (existing) {
      return { messageId: existing.id, clientId, created: false };
    }

    const now = this.clock();
    try {
      const messageId = await this.prisma.client.$transaction(async (tx) => {
        const parent = await tx.aiMessage.findFirst({
          where: { conversationId: input.conversationId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        const row = await tx.aiMessage.create({
          data: {
            conversationId: input.conversationId,
            parentId: parent?.id ?? null,
            role: "user",
            content: input.text,
            clientId,
          },
          select: { id: true },
        });

        const conversation = await tx.aiConversation.findFirstOrThrow({
          where: {
            id: input.conversationId,
            workspaceId: input.workspaceId,
            deletedAt: null,
          },
          select: { title: true, titleSource: true },
        });
        await tx.aiConversation.update({
          where: { id: input.conversationId, workspaceId: input.workspaceId },
          data: {
            ...(conversation.title === null
              ? {
                  title: truncateTitle(input.text),
                  titleSource: "placeholder",
                }
              : {}),
            lastMessageAt: now,
          },
        });
        return row.id;
      });
      return { messageId, clientId, created: true };
    } catch (error) {
      // Two concurrent retries can both miss the pre-check. The unique index is
      // authoritative; on P2002 the loser returns the winner's row.
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.client.aiMessage.findFirst({
          where: { conversationId: input.conversationId, clientId },
          select: { id: true },
        });
        if (winner) {
          return { messageId: winner.id, clientId, created: false };
        }
      }
      throw error;
    }
  }

  /**
   * Starts one stream. A transaction-level lock on the conversation row
   * serialises concurrent starts in this process and across API processes.
   * Inside the lock we check the durable `AiStream` row, not a Redis TTL, so a
   * 90-second-old stale row is swept to `failed` before the new row is created.
   */
  async startStream(input: {
    workspaceId: string;
    conversationId: string;
    messageId: string;
  }): Promise<{ streamId: string }> {
    const now = this.clock();
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "AiConversation"
        WHERE "id" = ${input.conversationId}::uuid
          AND "workspaceId" = ${input.workspaceId}::uuid
          AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw conversationNotFound();
      }

      const message = await tx.aiMessage.findFirst({
        where: { id: input.messageId, conversationId: input.conversationId },
        select: { id: true },
      });
      if (!message) {
        throw conversationNotFound();
      }

      const active = await tx.aiStream.findFirst({
        where: { conversationId: input.conversationId, status: "active" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, createdAt: true },
      });
      if (active && active.createdAt.getTime() > now.getTime() - AI_STREAM_BUSY_WINDOW_MS) {
        throw new HttpException(
          {
            code: "AI_CONVERSATION_BUSY",
            message: "Another stream is already active for this conversation.",
          },
          HttpStatus.CONFLICT,
        );
      }
      if (active) {
        await tx.aiStream.updateMany({
          where: { conversationId: input.conversationId, status: "active" },
          data: {
            status: "failed",
            errorCode: "AI_STREAM_STALE",
            finishedAt: now,
          },
        });
      }

      const stream = await tx.aiStream.create({
        data: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          status: "active",
        },
        select: { id: true },
      });
      return { streamId: stream.id };
    });
  }

  async finishAssistantMessage(input: {
    workspaceId: string;
    conversationId: string;
    streamId: string;
    clientId: string;
    content: readonly unknown[];
    status: Record<string, unknown>;
    modelContext?: readonly unknown[];
    metadata?: Record<string, unknown>;
    finishReason: "stop" | "tool-calls" | "length" | "aborted" | "error";
  }): Promise<void> {
    await this.requireConversation(input.workspaceId, input.conversationId);
    const stream = await this.prisma.client.aiStream.findFirst({
      where: { id: input.streamId, conversationId: input.conversationId },
      select: { id: true },
    });
    if (!stream) {
      throw conversationNotFound();
    }

    const now = this.clock();
    const metadata = {
      ...(input.metadata ?? {}),
      finishReason: input.finishReason,
    };
    const messageStatus = input.status;
    const errorCode =
      input.finishReason === "error" ? streamErrorCode(input.metadata, input.status) : null;

    await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.aiMessage.findFirst({
        where: { conversationId: input.conversationId, clientId: input.clientId },
        select: { id: true },
      });

      const data = {
        content: json(input.content),
        status: json(messageStatus),
        modelContext: input.modelContext ? json(input.modelContext) : undefined,
        metadata: json(metadata),
      };

      const message = existing
        ? await tx.aiMessage.update({
            where: { id: existing.id, conversationId: input.conversationId },
            data,
            select: { id: true },
          })
        : await tx.aiMessage.create({
            data: {
              conversationId: input.conversationId,
              role: "assistant",
              clientId: input.clientId,
              ...data,
            },
            select: { id: true },
          });

      await tx.aiConversation.update({
        where: { id: input.conversationId, workspaceId: input.workspaceId },
        data: { lastMessageAt: now },
      });

      await tx.aiStream.update({
        where: { id: input.streamId, conversationId: input.conversationId },
        data: {
          messageId: message.id,
          status: streamStatus(input.finishReason),
          errorCode,
          finishedAt: now,
        },
      });
    });
  }

  async loadContext(input: {
    workspaceId: string;
    conversationId: string;
    userId: string;
    maxChars?: number;
    maxTurns?: number;
  }): Promise<{ messages: readonly unknown[]; facts: Record<string, unknown> }> {
    await this.requireConversation(input.workspaceId, input.conversationId, input.userId);

    const rows = (await this.prisma.client.aiMessage.findMany({
      where: { conversationId: input.conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: MESSAGE_SELECT,
    })) as MessageRow[];

    const maxTurns = clampInteger(input.maxTurns, AI_CONTEXT_DEFAULT_TURNS, 1, 100);
    const maxChars = clampInteger(input.maxChars, AI_CONTEXT_DEFAULT_CHARS, 1, 1_000_000);

    const turns = buildTurns(rows);
    const selected = turns.slice(Math.max(0, turns.length - maxTurns));
    while (selected.length > 1 && serializedLength(selected.flatMap((turn) => turn.messages)) > maxChars) {
      selected.shift();
    }

    let messages = selected.flatMap((turn) => turn.messages);
    while (messages.length > 1 && serializedLength(messages) > maxChars) {
      messages = messages.slice(1);
    }
    if (serializedLength(messages) > maxChars) {
      messages = fitMessagesToBudget(messages, maxChars);
    }

    return {
      messages,
      facts: extractFacts(rows),
    };
  }

  // -------------------------------------------------------------------------
  // REST CRUD surface
  // -------------------------------------------------------------------------

  async list(
    userId: string,
    workspaceId: string,
    query: AiConversationListQuery,
  ): Promise<AiConversationListResponse> {
    const limit = clampInteger(query.limit, 30, 1, 100);
    const cursor = query.cursor ? decodeConversationCursor(query.cursor) : null;
    const cursorFilter: Prisma.AiConversationWhereInput = cursor
      ? cursor.lastMessageAt === null
        ? { lastMessageAt: null, id: { lt: cursor.id } }
        : {
            OR: [
              { lastMessageAt: { lt: new Date(cursor.lastMessageAt) } },
              {
                lastMessageAt: new Date(cursor.lastMessageAt),
                id: { lt: cursor.id },
              },
              { lastMessageAt: null },
            ],
          }
      : {};

    const rows = await this.prisma.client.aiConversation.findMany({
      where: {
        workspaceId,
        userId,
        status: "regular",
        deletedAt: null,
        AND: [cursorFilter],
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: limit + 1,
      select: CONVERSATION_SELECT,
    });

    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const last = visible.at(-1);
    return {
      items: visible.map((row) => presentConversation(row as ConversationRow)),
      nextCursor:
        hasMore && last ? encodeConversationCursor(last as ConversationRow) : null,
    };
  }

  async fetch(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<AiConversation> {
    const row = await this.requireConversation(workspaceId, conversationId, userId);
    return presentConversation(row);
  }

  async rename(
    userId: string,
    workspaceId: string,
    conversationId: string,
    input: UpdateAiConversationRequest,
  ): Promise<AiConversation> {
    await this.requireConversation(workspaceId, conversationId, userId);
    const updated = await this.prisma.client.aiConversation.updateMany({
      where: { id: conversationId, workspaceId, userId, deletedAt: null },
      data: { title: input.title, titleSource: "manual" },
    });
    if (updated.count === 0) {
      throw conversationNotFound();
    }
    return this.fetch(userId, workspaceId, conversationId);
  }

  async archive(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<AiConversation> {
    return this.setStatus(userId, workspaceId, conversationId, "archived");
  }

  async unarchive(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<AiConversation> {
    return this.setStatus(userId, workspaceId, conversationId, "regular");
  }

  async remove(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    await this.requireConversation(workspaceId, conversationId, userId);
    const now = this.clock();
    const deleted = await this.prisma.client.aiConversation.updateMany({
      where: { id: conversationId, workspaceId, userId, deletedAt: null },
      data: { deletedAt: now },
    });
    if (deleted.count === 0) {
      throw conversationNotFound();
    }
    return { message: "Conversation deleted." };
  }

  async listMessages(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<AiConversationMessagesResponse> {
    await this.requireConversation(workspaceId, conversationId, userId);
    const rows = (await this.prisma.client.aiMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: MESSAGE_SELECT,
    })) as MessageRow[];

    const uiId = new Map<string, string>();
    for (const row of rows) {
      uiId.set(row.id, row.clientId ?? row.id);
    }

    const messages = rows.map((row) => ({
      parentId: row.parentId ? (uiId.get(row.parentId) ?? row.parentId) : null,
      message: presentMessage(row),
    }));

    return {
      headId: rows.at(-1)?.clientId ?? rows.at(-1)?.id ?? null,
      messages,
    };
  }

  async upsertMessage(
    userId: string,
    workspaceId: string,
    conversationId: string,
    clientId: string,
    input: UpsertAiMessageRequest,
  ): Promise<AiThreadMessage> {
    await this.requireConversation(workspaceId, conversationId, userId);
    const parentId = input.parentId
      ? await this.resolveParentId(conversationId, input.parentId)
      : undefined;

    const existing = await this.prisma.client.aiMessage.findFirst({
      where: { conversationId, clientId },
      select: { id: true },
    });

    try {
      const row = existing
        ? await this.prisma.client.aiMessage.update({
            where: { id: existing.id, conversationId },
            data: {
              content: json(input.content),
              ...(input.status !== undefined ? { status: json(input.status) } : {}),
              ...(input.parentId !== undefined ? { parentId: parentId ?? null } : {}),
            },
            select: MESSAGE_SELECT,
          })
        : await this.prisma.client.aiMessage.create({
            data: {
              conversationId,
              clientId,
              role: "assistant",
              content: json(input.content),
              ...(input.status !== undefined ? { status: json(input.status) } : {}),
              parentId: parentId ?? null,
            },
            select: MESSAGE_SELECT,
          });
      return presentMessage(row as MessageRow);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.client.aiMessage.findFirst({
          where: { conversationId, clientId },
          select: MESSAGE_SELECT,
        });
        if (winner) {
          return presentMessage(winner as MessageRow);
        }
      }
      throw error;
    }
  }

  async deleteMessages(
    userId: string,
    workspaceId: string,
    conversationId: string,
    input: DeleteAiMessagesRequest,
  ): Promise<{ message: string }> {
    await this.requireConversation(workspaceId, conversationId, userId);
    const now = this.clock();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.aiMessage.deleteMany({
        where: { conversationId, clientId: { in: input.ids } },
      });
      const last = await tx.aiMessage.findFirst({
        where: { conversationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { createdAt: true },
      });
      await tx.aiConversation.update({
        where: { id: conversationId, workspaceId },
        data: { lastMessageAt: last?.createdAt ?? null, updatedAt: now },
      });
    });
    return { message: "Messages deleted." };
  }

  /**
   * Generates a title with a real model call. It never masquerades as a model
   * result: if the provider is missing it answers 503, and if the provider
   * fails it keeps/returns the existing placeholder with `titleSource` still
   * `placeholder`.
   */
  async generateTitle(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<AiConversationTitleResponse> {
    const conversation = await this.requireConversation(workspaceId, conversationId, userId);

    if (conversation.title && conversation.titleSource === "manual") {
      return { title: conversation.title };
    }
    if (conversation.title && conversation.titleSource === "model") {
      return { title: conversation.title };
    }

    const settings = await this.settingsResolver.resolve();
    const adapter = this.adapterFactory(settings);
    if (!settings.configured || !adapter) {
      this.logger.warn(
        { event: "ai.not_configured", protocol: settings.protocol, configured: settings.configured },
        "ai.not_configured",
      );
      throw new HttpException(
        { code: "AI_NOT_CONFIGURED", message: "AI title generation is not configured on this server." },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const firstUser = await this.prisma.client.aiMessage.findFirst({
      where: { conversationId, role: "user" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { content: true },
    });
    if (!firstUser) {
      throw new BadRequestException({
        code: "AI_TITLE_EMPTY",
        message: "A conversation needs a first user message before a title can be generated.",
      });
    }

    const firstText = contentToText(firstUser.content);
    const fallback = conversation.title?.trim() || truncateTitle(firstText);
    let title: string;
    try {
      const result = await adapter.step({
        system:
          "你是 Roamlog 的会话标题生成器。只输出一个简洁的中文标题，不超过 20 个汉字（最多 120 个字符）。" +
          "不要输出引号、编号、解释、前缀或句末标点。",
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              task: "用一句简短中文概括这段旅行规划对话的主题。",
              firstMessage: firstText.slice(0, TITLE_PROMPT_MAX_CHARS),
            }),
          },
        ],
        tools: [],
        maxTokens: TITLE_MAX_OUTPUT_TOKENS,
        timeoutMs: Math.min(settings.timeoutMs, 8_000),
      });
      title = cleanTitle(result.text) ?? "";
      if (!title) {
        return { title: fallback };
      }
    } catch (error) {
      this.logger.warn(
        {
          event: "ai.title_failed",
          conversationId,
          reason: error instanceof Error ? error.name : "unknown",
        },
        "ai.title_failed",
      );
      return { title: fallback };
    }

    const updated = await this.prisma.client.aiConversation.updateMany({
      where: {
        id: conversationId,
        workspaceId,
        userId,
        deletedAt: null,
        titleSource: { not: "manual" },
      },
      data: { title, titleSource: "model" },
    });
    if (updated.count === 0) {
      // A concurrent manual rename won the race: never report a title that was
      // not persisted.
      const current = await this.fetch(userId, workspaceId, conversationId);
      return { title: current.title ?? title };
    }
    return { title };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async setStatus(
    userId: string,
    workspaceId: string,
    conversationId: string,
    status: "regular" | "archived",
  ): Promise<AiConversation> {
    await this.requireConversation(workspaceId, conversationId, userId);
    const updated = await this.prisma.client.aiConversation.updateMany({
      where: { id: conversationId, workspaceId, userId, deletedAt: null },
      data: { status },
    });
    if (updated.count === 0) {
      throw conversationNotFound();
    }
    return this.fetch(userId, workspaceId, conversationId);
  }

  private async requireConversation(
    workspaceId: string,
    conversationId: string,
    userId?: string,
  ): Promise<ConversationRow> {
    const row = await this.prisma.client.aiConversation.findFirst({
      where: {
        id: conversationId,
        workspaceId,
        deletedAt: null,
        ...(userId ? { userId } : {}),
      },
      select: CONVERSATION_SELECT,
    });
    if (!row) {
      throw conversationNotFound();
    }
    return row as ConversationRow;
  }

  private async resolveParentId(
    conversationId: string,
    parentClientId: string,
  ): Promise<string | null> {
    const byClientId = await this.prisma.client.aiMessage.findFirst({
      where: { conversationId, clientId: parentClientId },
      select: { id: true },
    });
    if (byClientId) {
      return byClientId.id;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(parentClientId)) {
      const byId = await this.prisma.client.aiMessage.findFirst({
        where: { id: parentClientId, conversationId },
        select: { id: true },
      });
      if (byId) {
        return byId.id;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Serialization / time / cursor helpers
// ---------------------------------------------------------------------------

function presentConversation(row: ConversationRow): AiConversation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    title: row.title,
    titleSource: row.titleSource as AiConversation["titleSource"],
    status: row.status as AiConversation["status"],
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentMessage(row: MessageRow): AiThreadMessage {
  return {
    id: row.clientId ?? row.id,
    role: row.role as AiThreadMessage["role"],
    content: row.content as AiThreadMessage["content"],
    createdAt: row.createdAt.toISOString(),
    clientId: row.clientId,
    ...(row.status !== null && row.status !== undefined ? { status: row.status } : {}),
    ...(row.metadata !== null && row.metadata !== undefined ? { metadata: row.metadata } : {}),
  };
}

function conversationNotFound(): NotFoundException {
  return new NotFoundException({
    code: "AI_CONVERSATION_NOT_FOUND",
    message: "AI conversation not found.",
  });
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function truncateTitle(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim() || "新会话";
  const chars = Array.from(normalized);
  return chars.length > 24 ? `${chars.slice(0, 23).join("")}…` : normalized;
}

function cleanTitle(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const firstLine = raw.trim().split(/\r?\n/u)[0]?.trim() ?? "";
  let value = firstLine
    .replace(/^#+\s*/u, "")
    .replace(/^(?:标题|Title)\s*[:：]\s*/iu, "")
    .replace(/^[>*\-\s"'“”‘’「」『』]+/u, "")
    .replace(/["'“”‘’「」『』\s]+$/u, "")
    .trim();
  if (!value) {
    return null;
  }
  const chars = Array.from(value);
  if (chars.length > TITLE_MAX_CHARS) {
    value = `${chars.slice(0, TITLE_MAX_CHARS - 1).join("")}…`;
  }
  return value;
}

function streamStatus(
  reason: "stop" | "tool-calls" | "length" | "aborted" | "error",
): "completed" | "aborted" | "failed" {
  switch (reason) {
    case "aborted":
      return "aborted";
    case "error":
      return "failed";
    case "stop":
    case "tool-calls":
    case "length":
    default:
      return "completed";
  }
}

function streamErrorCode(
  metadata: Record<string, unknown> | undefined,
  status: Record<string, unknown>,
): string {
  for (const source of [metadata, status]) {
    const error = source?.error;
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && code.trim()) {
        return code.slice(0, 60);
      }
    }
  }
  return "AI_STREAM_FAILED";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (typeof part === "object" && part !== null && "text" in part) {
          const value = (part as { text?: unknown }).text;
          return typeof value === "string" ? value : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    return text || JSON.stringify(content);
  }
  if (typeof content === "object" && content !== null && "text" in content) {
    const value = (content as { text?: unknown }).text;
    if (typeof value === "string") {
      return value;
    }
  }
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function messageFromRow(row: MessageRow): Record<string, unknown> {
  if (row.role === "assistant") {
    const text = contentToText(row.content);
    return { role: "assistant", content: text || null, toolCalls: [] };
  }
  if (row.role === "user") {
    return { role: "user", content: contentToText(row.content) };
  }
  return { role: "system", content: contentToText(row.content) };
}

function buildTurns(rows: MessageRow[]): Turn[] {
  const turns: Turn[] = [];
  let pendingUser: Record<string, unknown> | null = null;

  for (const row of rows) {
    if (row.role === "user") {
      if (pendingUser) {
        turns.push({ messages: [pendingUser], createdAt: row.createdAt });
      }
      pendingUser = messageFromRow(row);
      continue;
    }

    if (row.role === "assistant") {
      const context = Array.isArray(row.modelContext) ? (row.modelContext as unknown[]) : null;
      if (context && context.length > 0) {
        const messages = [...context];
        if (
          pendingUser &&
          !context.some(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as { role?: unknown }).role === "user",
          )
        ) {
          messages.unshift(pendingUser);
        }
        turns.push({ messages, createdAt: row.createdAt });
      } else {
        const messages: unknown[] = [];
        if (pendingUser) {
          messages.push(pendingUser);
        }
        messages.push(messageFromRow(row));
        turns.push({ messages, createdAt: row.createdAt });
      }
      pendingUser = null;
      continue;
    }

    if (pendingUser) {
      turns.push({ messages: [pendingUser], createdAt: row.createdAt });
      pendingUser = null;
    }
    turns.push({ messages: [messageFromRow(row)], createdAt: row.createdAt });
  }

  if (pendingUser) {
    turns.push({ messages: [pendingUser], createdAt: new Date(0) });
  }
  return turns;
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

interface StringSlot {
  readonly get: () => string;
  readonly set: (value: string) => void;
}

/**
 * Guarantees the `maxChars` contract even when a single newest turn is larger
 * than the whole budget. We first drop whole older messages (keeping the newest
 * information), then shorten the longest remaining text fields until the JSON
 * payload fits. This only runs for pathological turns; normal turns are cut by
 * whole turns in `loadContext`.
 */
function fitMessagesToBudget(messages: unknown[], maxChars: number): unknown[] {
  let copy: unknown[];
  try {
    copy = JSON.parse(JSON.stringify(messages)) as unknown[];
  } catch {
    return [];
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serializedLength(copy) <= maxChars) {
      return copy;
    }
    const slots: StringSlot[] = [];
    collectStringSlots(copy, slots);
    slots.sort((left, right) => right.get().length - left.get().length);
    const longest = slots[0];
    if (!longest) {
      break;
    }
    const current = longest.get();
    const overflow = serializedLength(copy) - maxChars;
    const keep = Math.max(0, current.length - Math.max(8, overflow + 2));
    if (keep >= current.length) {
      break;
    }
    longest.set(current.slice(0, keep));
  }

  while (copy.length > 1 && serializedLength(copy) > maxChars) {
    copy.shift();
  }
  return serializedLength(copy) <= maxChars ? copy : [];
}

function collectStringSlots(value: unknown, slots: StringSlot[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === "string" && item.length > 0) {
        slots.push({
          get: () => {
            const current = value[index];
            return typeof current === "string" ? current : "";
          },
          set: (next) => {
            value[index] = next;
          },
        });
        return;
      }
      collectStringSlots(item, slots);
    });
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.length > 0) {
      slots.push({
        get: () => {
          const current = value[key];
          return typeof current === "string" ? current : "";
        },
        set: (next) => {
          value[key] = next;
        },
      });
      continue;
    }
    collectStringSlots(item, slots);
  }
}

function extractFacts(rows: MessageRow[]): Record<string, unknown> {
  let lastCreatedTripId: string | null = null;
  let lastCreatedTripTitle: string | null = null;
  const lastTouched = new Set<string>();

  for (const row of rows) {
    const context = Array.isArray(row.modelContext) ? (row.modelContext as unknown[]) : [];
    for (const message of context) {
      if (!isRecord(message)) {
        continue;
      }
      if (message.role === "tool" && Array.isArray(message.results)) {
        for (const result of message.results) {
          if (!isRecord(result) || typeof result.name !== "string") {
            continue;
          }
          const parsed = parseJsonValue(result.content);
          const payload = isRecord(parsed) && isRecord(parsed.result) ? parsed.result : parsed;
          if (!isRecord(payload)) {
            continue;
          }
          const entityId = stringValue(payload.entityId) ?? stringValue(payload.id);
          if (result.name === "trips.create" && entityId) {
            lastCreatedTripId = entityId;
            lastCreatedTripTitle =
              stringValue(payload.title) ??
              stringValue(payload.name) ??
              lastCreatedTripTitle;
          }
          if (entityId && result.name.startsWith("trips.")) {
            lastTouched.add(entityId);
          }
        }
      }
      if (message.role === "assistant" && Array.isArray(message.toolCalls)) {
        for (const call of message.toolCalls) {
          if (!isRecord(call) || typeof call.name !== "string") {
            continue;
          }
          const input = isRecord(call.input) ? call.input : {};
          const tripId = stringValue(input.tripId);
          if (tripId) {
            lastTouched.add(tripId);
          }
          if (call.name === "trips.create") {
            const title = stringValue(input.title);
            if (title) {
              lastCreatedTripTitle = title;
            }
          }
        }
      }
    }
  }

  return {
    lastCreatedTripId,
    lastCreatedTripTitle,
    lastTouchedTripIds: [...lastTouched],
  };
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

interface ConversationCursor {
  readonly id: string;
  readonly lastMessageAt: string | null;
}

function encodeConversationCursor(row: ConversationRow): string {
  return Buffer.from(
    JSON.stringify({ id: row.id, lastMessageAt: row.lastMessageAt?.toISOString() ?? null }),
    "utf8",
  ).toString("base64url");
}

function decodeConversationCursor(cursor: string): ConversationCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(cursor) || cursor.length > 2048) {
      throw new Error("invalid cursor alphabet");
    }
    if (Buffer.from(cursor, "base64url").toString("base64url") !== cursor) {
      throw new Error("non-canonical cursor");
    }
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!isRecord(parsed) || typeof parsed.id !== "string" || !parsed.id) {
      throw new Error("cursor id missing");
    }
    const lastMessageAt =
      parsed.lastMessageAt === null
        ? null
        : typeof parsed.lastMessageAt === "string" &&
            !Number.isNaN(Date.parse(parsed.lastMessageAt))
          ? parsed.lastMessageAt
          : undefined;
    if (lastMessageAt === undefined) {
      throw new Error("cursor timestamp invalid");
    }
    return { id: parsed.id, lastMessageAt };
  } catch {
    throw new BadRequestException({
      code: "INVALID_CURSOR",
      message: "The cursor is invalid.",
    });
  }
}

// Keep the type imported for consumers that want a plain settings shape.
export type AiConversationSettings = AiSettings;
