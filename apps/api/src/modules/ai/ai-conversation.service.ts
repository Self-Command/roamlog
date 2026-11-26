import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

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
  AiConversationBulkDeleteResponse,
  AiConversationListQuery,
  AiConversationListResponse,
  AiConversationMessagesResponse,
  AiConversationTitleResponse,
  AiThreadMessage,
  DeleteAiMessagesRequest,
  PublicAiChatContentPart,
  PublicAiChatMessage,
  PublicAiChatResponse,
  SetAiConversationVisibilityRequest,
  UpdateAiConversationRequest,
  UpsertAiMessageRequest,
} from "@roamlog/contracts";
import { isHumanToolName, PublicAiChatResponseSchema } from "@roamlog/contracts";

import { AppConfigService } from "../../config/app-config.service.js";
import { AI_ADAPTER_FACTORY, type AiAdapterFactory } from "./adapters/index.js";
import { AiSettingsResolver, AI_CLOCK, type AiClock, type AiSettings } from "./ai.settings.js";
import { MediaUrlService, type SignedMediaUrls } from "../media/media-url.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { generateUuidV7 } from "../auth/uuid.js";

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
    /**
     * Full assistant-ui content parts for the turn (text + image parts). When
     * present it is stored verbatim so a reloaded conversation still has its
     * attachments; `text` remains the model-facing prompt and the title source.
     */
    content?: readonly unknown[];
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
    finishReason: "stop" | "tool-calls" | "requires-action" | "length" | "aborted" | "error";
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
  visibility: string;
  shareId: string | null;
  shareRevision: number;
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

export interface PendingHumanTool {
  readonly toolCallId: string;
  readonly name: "ask_user" | "confirm_brief";
  /** Validated tool arguments persisted when the model paused. */
  readonly args: Readonly<Record<string, unknown>>;
}

export interface PendingHumanToolMessage {
  readonly id: string;
  readonly clientId: string;
  readonly parentId: string | null;
  readonly content: readonly unknown[];
  readonly modelContext: readonly unknown[];
  readonly metadata: Record<string, unknown>;
  readonly pending: PendingHumanTool;
}

const CONVERSATION_SELECT = {
  id: true,
  workspaceId: true,
  userId: true,
  title: true,
  titleSource: true,
  status: true,
  visibility: true,
  shareId: true,
  shareRevision: true,
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
    @Optional()
    @Inject(AppConfigService)
    private readonly config?: AppConfigService,
    @Optional()
    @Inject(MediaUrlService)
    private readonly mediaUrls?: MediaUrlService,
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
    content?: readonly unknown[];
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
            content: json(input.content ?? input.text),
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

  /**
   * The stream a refreshed browser may attach to.
   *
   * `AiStream` is the durable lifecycle row; the actual replay buffer lives in
   * `resumable-stream`'s Redis sentinel. Keeping this read owner-scoped means a
   * conversation id from another user can never be used to probe live runs.
   */
  async findRecoverableStream(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<{ streamId: string } | null> {
    await this.requireConversation(workspaceId, conversationId, userId);
    const stream = await this.prisma.client.aiStream.findFirst({
      where: { conversationId, status: "active" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    return stream ? { streamId: stream.id } : null;
  }

  /** Tenant-scoped lookup used by the explicit stop endpoint. */
  async findStream(
    userId: string,
    workspaceId: string,
    conversationId: string,
    streamId: string,
  ): Promise<{ streamId: string; status: "active" | "completed" | "aborted" | "failed" } | null> {
    await this.requireConversation(workspaceId, conversationId, userId);
    const stream = await this.prisma.client.aiStream.findFirst({
      where: { id: streamId, conversationId },
      select: { id: true, status: true },
    });
    return stream
      ? {
          streamId: stream.id,
          status: stream.status as "active" | "completed" | "aborted" | "failed",
        }
      : null;
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
    finishReason: "stop" | "tool-calls" | "requires-action" | "length" | "aborted" | "error";
  }): Promise<void> {
    await this.requireConversation(input.workspaceId, input.conversationId);
    const stream = await this.prisma.client.aiStream.findFirst({
      where: { id: input.streamId, conversationId: input.conversationId },
      select: { id: true, messageId: true, createdAt: true },
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
        select: { id: true, parentId: true },
      });

      // The final assistant row must branch from the user message that started
      // this stream. `AiStream.messageId` points at that user row until this
      // method overwrites it with the assistant row below. If an older stream
      // was already finalized, fall back to the newest preceding user row so a
      // retry/repair cannot create a second branch root. Without this parent,
      // `GET .../messages` returns an orphan assistant row as `headId` and the
      // reloaded thread appears empty.
      const parentFromStream = stream.messageId
        ? await tx.aiMessage.findFirst({
            where: {
              id: stream.messageId,
              conversationId: input.conversationId,
              role: "user",
            },
            select: { id: true },
          })
        : null;
      const parentMessage =
        parentFromStream ??
        (await tx.aiMessage.findFirst({
          where: {
            conversationId: input.conversationId,
            role: "user",
            createdAt: { lte: stream.createdAt },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        }));
      const parentId = parentMessage?.id ?? null;

      const data = {
        content: json(input.content),
        status: json(messageStatus),
        modelContext: input.modelContext ? json(input.modelContext) : undefined,
        metadata: json(metadata),
      };

      const message = existing
        ? await tx.aiMessage.update({
            where: { id: existing.id, conversationId: input.conversationId },
            data: {
              ...data,
              ...(parentId !== null &&
              (existing.parentId === null || existing.parentId === undefined)
                ? { parentId }
                : {}),
            },
            select: { id: true },
          })
        : await tx.aiMessage.create({
            data: {
              conversationId: input.conversationId,
              role: "assistant",
              clientId: input.clientId,
              parentId,
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
    while (
      selected.length > 1 &&
      serializedLength(selected.flatMap((turn) => turn.messages)) > maxChars
    ) {
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

  /**
   * Finds the durable assistant message that paused on `ask_user` or
   * `confirm_brief`. The answer is resumed only against this record, so a
   * client cannot invent a tool call or attach an answer to another thread.
   */
  async findPendingHumanTool(input: {
    userId: string;
    workspaceId: string;
    conversationId: string;
    toolCallId: string;
  }): Promise<PendingHumanToolMessage | null> {
    await this.requireConversation(input.workspaceId, input.conversationId, input.userId);
    const rows = (await this.prisma.client.aiMessage.findMany({
      where: { conversationId: input.conversationId, role: "assistant" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        parentId: true,
        clientId: true,
        content: true,
        modelContext: true,
        metadata: true,
      },
    })) as Array<{
      id: string;
      parentId: string | null;
      clientId: string | null;
      content: unknown;
      modelContext: unknown;
      metadata: unknown;
    }>;

    for (const row of rows) {
      if (!row.clientId || !Array.isArray(row.content) || !Array.isArray(row.modelContext)) {
        continue;
      }
      const metadata = isRecord(row.metadata) ? row.metadata : null;
      if (!metadata) {
        continue;
      }
      const pending = isRecord(metadata.pendingHumanTool)
        ? metadata.pendingHumanTool
        : null;
      if (
        !pending ||
        typeof pending.toolCallId !== "string" ||
        typeof pending.name !== "string" ||
        !isHumanToolName(pending.name) ||
        !isRecord(pending.args) ||
        pending.toolCallId !== input.toolCallId
      ) {
        continue;
      }
      return {
        id: row.id,
        clientId: row.clientId,
        parentId: row.parentId,
        content: row.content,
        modelContext: row.modelContext,
        metadata,
        pending: {
          toolCallId: pending.toolCallId,
          name: pending.name,
          args: pending.args,
        },
      };
    }
    return null;
  }

  /**
   * Atomically marks one pending human tool as answered and writes the user's
   * result into its assistant-ui tool part. The JSON-path predicate is the
   * compare-and-swap: two tabs cannot both resume the same question, even when
   * both read the pending row before either update commits.
   *
   * Returns the updated assistant content, which the stream must carry forward
   * so the resumed answer never erases the original form. `null` means another
   * request already answered or the marker no longer matches.
   */
  async settlePendingHumanTool(input: {
    workspaceId: string;
    conversationId: string;
    userId: string;
    toolCallId: string;
    name: "ask_user" | "confirm_brief";
    result: Readonly<Record<string, unknown>>;
  }): Promise<{ content: readonly unknown[]; metadata: Record<string, unknown> } | null> {
    const pending = await this.findPendingHumanTool(input);
    if (!pending || pending.pending.name !== input.name) return null;

    let found = false;
    const content = pending.content.map((part) => {
      if (!isRecord(part) || part.type !== "tool-call") return part;
      if (part.toolCallId !== input.toolCallId || part.toolName !== input.name) return part;
      found = true;
      return { ...part, result: input.result };
    });
    if (!found) return null;

    const metadata: Record<string, unknown> = {
      ...pending.metadata,
      finishReason: "tool-calls",
    };
    delete metadata.pendingHumanTool;

    const settled = await this.prisma.client.aiMessage.updateMany({
      where: {
        id: pending.id,
        conversationId: input.conversationId,
        metadata: {
          path: ["pendingHumanTool", "toolCallId"],
          equals: input.toolCallId,
        },
      },
      data: {
        content: json(content),
        status: json({ type: "complete", reason: "tool-calls" }),
        metadata: json(metadata),
      },
    });
    if (settled.count === 0) return null;
    return { content, metadata };
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
      items: visible.map((row) => this.presentConversation(row as ConversationRow)),
      nextCursor: hasMore && last ? encodeConversationCursor(last as ConversationRow) : null,
    };
  }

  async fetch(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<AiConversation> {
    const row = await this.requireConversation(workspaceId, conversationId, userId);
    return this.presentConversation(row);
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

  /**
   * Port of vercel/chatbot's `updateChatVisibility`
   * (`app/(chat)/actions.ts:38-58`, `lib/db/queries.ts:505-513`).
   *
   * Upstream stores the raw chat id in the public URL. Roamlog instead signs an
   * opaque `shareId + shareRevision` token, so switching back to private
   * invalidates every URL that was previously copied. Every transition bumps
   * the revision; setting the same value is a no-op.
   */
  async setVisibility(
    userId: string,
    workspaceId: string,
    conversationId: string,
    input: SetAiConversationVisibilityRequest,
  ): Promise<AiConversation> {
    const current = await this.requireConversation(workspaceId, conversationId, userId);
    if (current.visibility === input.visibility) {
      return this.presentConversation(current);
    }

    const updated = await this.prisma.client.aiConversation.updateMany({
      where: { id: conversationId, workspaceId, userId, deletedAt: null },
      data: {
        visibility: input.visibility,
        shareRevision: { increment: 1 },
        ...(input.visibility === "public" && !current.shareId ? { shareId: generateUuidV7() } : {}),
      },
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

  async removeAll(userId: string, workspaceId: string): Promise<AiConversationBulkDeleteResponse> {
    const deleted = await this.prisma.client.aiConversation.updateMany({
      where: { workspaceId, userId, deletedAt: null },
      data: { deletedAt: this.clock() },
    });
    return { deletedCount: deleted.count };
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

  /**
   * Anonymous read for a public conversation. The token authenticates the
   * share, not the user. A private conversation, a rotated revision or a
   * deleted conversation all return the same 404 as an unknown token.
   */
  async readPublic(token: string): Promise<PublicAiChatResponse> {
    const config = this.config;
    const parsed = config ? parseAiConversationShareToken(token, config.betterAuthSecret) : null;
    if (!parsed) {
      throw conversationNotFound();
    }

    const row = (await this.prisma.client.aiConversation.findFirst({
      where: {
        shareId: parsed.shareId,
        visibility: "public",
        shareRevision: parsed.revision,
        deletedAt: null,
      },
      select: CONVERSATION_SELECT,
    })) as ConversationRow | null;
    if (!row) {
      throw conversationNotFound();
    }

    const rows = (await this.prisma.client.aiMessage.findMany({
      where: { conversationId: row.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: MESSAGE_SELECT,
    })) as MessageRow[];
    const signedImages = await this.signPublicMessageImages(row.workspaceId, rows);
    const messages = publicMessageChain(rows, signedImages);

    return PublicAiChatResponseSchema.parse({
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      messages,
      isReadOnly: true,
    });
  }

  /**
   * Persisted message parts carry the signed URL from upload time. Public
   * shares may be opened much later, so image parts are re-signed from the
   * Workspace-scoped media row before they enter the response. A missing or
   * deleted media row simply drops that image.
   */
  private async signPublicMessageImages(
    workspaceId: string,
    rows: readonly MessageRow[],
  ): Promise<ReadonlyMap<string, SignedMediaUrls>> {
    if (!this.mediaUrls) return new Map();
    const ids = new Set<string>();
    for (const row of rows) {
      if (!Array.isArray(row.content)) continue;
      for (const part of row.content) {
        const mediaId = imageMediaId(part);
        if (mediaId) ids.add(mediaId);
      }
    }
    if (ids.size === 0) return new Map();

    const records = await this.prisma.client.media.findMany({
      where: {
        id: { in: [...ids] },
        workspaceId,
        status: "ready",
        deletedAt: null,
      },
      include: { motion: true },
    });
    return this.mediaUrls.signMany(records);
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
      // A client-side upsert is the only write a stubbed/failed turn gets, so the
      // conversation itself must acknowledge it: without this the row exists but
      // the thread stays `lastMessageAt: null`, sorts to the bottom of the
      // sidebar and is never re-openable after a reload.
      await this.touchConversation(conversationId, workspaceId, firstTextOf(input.content));
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

  /** Marks a conversation as active and seeds a placeholder title on first write. */
  private async touchConversation(
    conversationId: string,
    workspaceId: string,
    text: string | undefined,
  ): Promise<void> {
    const conversation = await this.prisma.client.aiConversation.findFirst({
      where: { id: conversationId, workspaceId, deletedAt: null },
      select: { title: true, titleSource: true },
    });
    if (!conversation) return;
    await this.prisma.client.aiConversation.update({
      where: { id: conversationId, workspaceId },
      data: {
        lastMessageAt: this.clock(),
        ...(conversation.title === null && text
          ? { title: truncateTitle(text), titleSource: "placeholder" }
          : {}),
      },
    });
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
        {
          event: "ai.not_configured",
          protocol: settings.protocol,
          configured: settings.configured,
        },
        "ai.not_configured",
      );
      throw new HttpException(
        {
          code: "AI_NOT_CONFIGURED",
          message: "AI title generation is not configured on this server.",
        },
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

  private presentConversation(row: ConversationRow): AiConversation {
    return presentConversation(row, this.shareUrlFor(row));
  }

  private shareUrlFor(row: ConversationRow): string | null {
    const config = this.config;
    if (
      row.visibility !== "public" ||
      !row.shareId ||
      !config ||
      config.betterAuthSecret.length < 32
    ) {
      return null;
    }
    const token = createAiConversationShareToken(
      row.shareId,
      row.shareRevision,
      config.betterAuthSecret,
    );
    return `${config.appUrl.replace(/\/$/, "")}/share/chat/${encodeURIComponent(token)}`;
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

function presentConversation(row: ConversationRow, shareUrl: string | null): AiConversation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    title: row.title,
    titleSource: row.titleSource as AiConversation["titleSource"],
    status: row.status as AiConversation["status"],
    visibility: row.visibility as AiConversation["visibility"],
    shareUrl,
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

/**
 * The public view follows the selected branch exactly like the authenticated
 * thread history: start at the latest row and walk `parentId` to the root.
 * Alternative edits/regenerations are not exposed.
 */
function publicMessageChain(
  rows: readonly MessageRow[],
  signedImages: ReadonlyMap<string, SignedMediaUrls>,
): PublicAiChatMessage[] {
  if (rows.length === 0) return [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  let current: MessageRow | undefined = rows.at(-1);
  const chain: MessageRow[] = [];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  const messages: PublicAiChatMessage[] = [];
  for (const row of chain) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const content = publicMessageContent(row.content, signedImages);
    if (content.length === 0) continue;
    messages.push({
      id: row.id,
      role: row.role,
      content,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return messages;
}

/** Keep only renderable text/image parts; drop tools, reasoning and metadata. */
function publicMessageContent(
  content: unknown,
  signedImages: ReadonlyMap<string, SignedMediaUrls>,
): PublicAiChatContentPart[] {
  const rawParts: unknown[] =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content
        : isRecord(content) && content.type === "text"
          ? [content]
          : [];

  const parts: PublicAiChatContentPart[] = [];
  for (const raw of rawParts) {
    if (!isRecord(raw)) continue;
    if (raw.type === "text" && typeof raw.text === "string" && raw.text.trim()) {
      parts.push({ type: "text", text: raw.text.slice(0, 200_000) });
      continue;
    }
    if (raw.type === "image" && typeof raw.image === "string" && isHttpUrl(raw.image)) {
      const mediaId = imageMediaId(raw);
      const signed = mediaId ? signedImages.get(mediaId) : undefined;
      const image = signed?.url ?? signed?.thumbUrl ?? raw.image;
      parts.push({
        type: "image",
        image,
        ...(typeof raw.filename === "string" && raw.filename.trim()
          ? { filename: raw.filename.slice(0, 200) }
          : {}),
      });
    }
  }
  return parts;
}

/** Reads the stable media id from an assistant-ui image part. */
function imageMediaId(value: unknown): string | null {
  if (!isRecord(value) || value.type !== "image") return null;
  if (isRecord(value.providerMetadata)) {
    const roamlog = value.providerMetadata.roamlog;
    if (isRecord(roamlog) && typeof roamlog.mediaId === "string") {
      return roamlog.mediaId;
    }
  }
  if (isRecord(value.metadata)) {
    const roamlog = value.metadata.roamlog;
    if (isRecord(roamlog) && typeof roamlog.mediaId === "string") {
      return roamlog.mediaId;
    }
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const AI_SHARE_TOKEN_PREFIX = "aic1";
const AI_SHARE_TOKEN_CONTEXT = "roamlog:ai-share:";

/**
 * Browser-safe share token bound to an opaque share id and the current
 * revocation revision. The secret never leaves the API and no bearer token is
 * stored in the database.
 */
export function createAiConversationShareToken(
  shareId: string,
  revision: number,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, s: shareId, r: revision }), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(`${AI_SHARE_TOKEN_CONTEXT}${payload}`, "utf8")
    .digest("base64url");
  return `${AI_SHARE_TOKEN_PREFIX}.${payload}.${signature}`;
}

export function parseAiConversationShareToken(
  token: string,
  secret: string,
): { shareId: string; revision: number } | null {
  if (token.length < 32 || token.length > 256) return null;
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  const [prefix, payload, signature] = segments;
  if (
    prefix !== AI_SHARE_TOKEN_PREFIX ||
    !payload ||
    !signature ||
    !/^[A-Za-z0-9_-]+$/u.test(payload) ||
    !/^[A-Za-z0-9_-]+$/u.test(signature)
  ) {
    return null;
  }
  const expected = createHmac("sha256", secret)
    .update(`${AI_SHARE_TOKEN_CONTEXT}${payload}`, "utf8")
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.v !== 1 || typeof parsed.s !== "string") return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(parsed.s)) {
      return null;
    }
    if (typeof parsed.r !== "number" || !Number.isSafeInteger(parsed.r) || parsed.r < 0) {
      return null;
    }
    return { shareId: parsed.s, revision: parsed.r };
  } catch {
    return null;
  }
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

/** First `text` part of a persisted content value (or the string itself). */
function firstTextOf(content: unknown): string | undefined {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (
      candidate.type === "text" &&
      typeof candidate.text === "string" &&
      candidate.text.trim().length > 0
    ) {
      return candidate.text;
    }
  }
  return undefined;
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
  reason: "stop" | "tool-calls" | "requires-action" | "length" | "aborted" | "error",
): "completed" | "aborted" | "failed" {
  switch (reason) {
    case "aborted":
      return "aborted";
    case "error":
      return "failed";
    case "stop":
    case "tool-calls":
    case "requires-action":
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
              stringValue(payload.title) ?? stringValue(payload.name) ?? lastCreatedTripTitle;
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
