import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import type { AiToolCall } from "@roamlog/contracts";
import type Redis from "ioredis";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream/ioredis";

import { generateUuidV7 } from "../auth/uuid.js";
import { RedisService } from "../redis/redis.service.js";
import type { AiPlaceCandidate } from "./ai-tools.js";

/** Plans are short-lived: the user confirms within 15 minutes. */
export const AI_RUN_TTL_SECONDS = 15 * 60;
const RUN_KEY_PREFIX = "ai:run:";
const CONSUMED_KEY_PREFIX = "ai:run:consumed:";
const STREAM_ASSISTANT_KEY_PREFIX = "ai:stream:assistant:";
const STREAM_CANCEL_KEY_PREFIX = "ai:stream:cancel:";
const RESUMABLE_STREAM_TTL_SECONDS = 24 * 60 * 60;
const RESUMABLE_STREAM_PREFIX = "roamlog-ai";

export interface StoredAiRun {
  readonly runId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly message: string;
  readonly plannedCalls: AiToolCall[];
  /** Places resolved in this run; the only ids a stop may reference. */
  readonly candidates: AiPlaceCandidate[];
  readonly createdAt: string;
}

export interface ConsumedAiRun {
  readonly runId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

/**
 * A plan id must be a real RFC 4122 UUID, not merely 16 random bytes.
 *
 * `runId` is written verbatim into `AuditLog.targetId`, a PostgreSQL `uuid`
 * column. PostgreSQL accepts 32 hyphenless hex digits but canonicalises them to
 * 8-4-4-4-12 *without* touching the version/variant nibbles, so the stored value
 * can carry a variant byte RFC 4122 forbids (e.g. `726d652a-fcfc-877c-
 * f34f-593a6ec94c59`, variant `f`) and `z.uuid()` then rejects the row. Minting
 * a proper UUID at the source is the only way to keep new audit rows valid.
 *
 * Reuses the repository's existing UUIDv7 generator (`generateUuidV7`, the one
 * `MediaService` and the realtime publisher already use) instead of inventing a
 * second implementation; time-ordered ids also keep audit rows roughly sortable
 * and match every other id this API mints.
 */
export function newRunId(): string {
  return generateUuidV7();
}

function runKey(workspaceId: string, runId: string): string {
  return `${RUN_KEY_PREFIX}${createHash("sha256").update(`${workspaceId}\u0000${runId}`).digest("hex")}`;
}

function consumedKey(runId: string): string {
  return `${CONSUMED_KEY_PREFIX}${createHash("sha256").update(runId).digest("hex")}`;
}

/**
 * Server-side storage for a plan awaiting confirmation.
 *
 * Deliberately Redis-only and TTL-bound: the plan is never a database row, so a
 * dropped/expired plan cannot leave half-created data behind. Keys are hashed
 * and namespaced by workspace, so a run id is useless outside its workspace.
 */
@Injectable()
export class AiRunStore implements OnModuleDestroy {
  private resumableContext?: ResumableStreamContext;
  private streamPublisher?: Redis;
  private streamSubscriber?: Redis;
  private readonly streamControllers = new Map<string, AbortController>();

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async save(run: StoredAiRun): Promise<void> {
    await this.redis.set(
      runKey(run.workspaceId, run.runId),
      JSON.stringify(run),
      AI_RUN_TTL_SECONDS,
    );
  }

  async load(workspaceId: string, runId: string): Promise<StoredAiRun | undefined> {
    const stored = await this.redis.get(runKey(workspaceId, runId));
    if (stored === null) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(stored) as StoredAiRun;
      return parsed && parsed.runId === runId ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async isConsumed(runId: string): Promise<boolean> {
    return (await this.redis.get(consumedKey(runId))) !== null;
  }

  /** One-shot semantics: the plan key disappears and a consumed marker remains. */
  async consume(run: StoredAiRun): Promise<void> {
    await this.redis.set(
      consumedKey(run.runId),
      JSON.stringify({ runId: run.runId, userId: run.userId, workspaceId: run.workspaceId }),
      AI_RUN_TTL_SECONDS,
    );
    await this.redis.delete(runKey(run.workspaceId, run.runId));
  }

  async loadConsumed(runId: string): Promise<ConsumedAiRun | undefined> {
    const stored = await this.redis.get(consumedKey(runId));
    if (stored === null) {
      return undefined;
    }
    try {
      return JSON.parse(stored) as ConsumedAiRun;
    } catch {
      return undefined;
    }
  }

  /**
   * Creates the resumable producer for one SSE turn.
   *
   * Source: vercel/chatbot `app/(chat)/api/chat/route.ts:55-63` and
   * `consumeSseStream` at L385-400 @ a8989b522fa3672a2ae52f053105e40993b36ca1,
   * which call `resumable-stream`'s `createNewResumableStream`. The library
   * keeps the producer alive even after the first HTTP consumer disconnects;
   * a second consumer asks the producer to replay its in-memory chunk buffer
   * through Redis pub/sub.
   *
   * Roamlog passes duplicated ioredis clients because the shared RedisService
   * client is also used for normal commands, and a client in subscriber mode
   * cannot issue them.
   */
  createResumableStream(
    streamId: string,
    makeStream: () => ReadableStream<string>,
  ): Promise<ReadableStream<string> | null> {
    return this.resumable().createNewResumableStream(streamId, makeStream);
  }

  /**
   * Attaches a replacement client to an already-running producer.
   *
   * `undefined` means no producer exists (process restarted or the sentinel
   * expired); `null` means the producer finished normally. The HTTP layer maps
   * those to "not resumable" rather than keeping the browser spinning.
   */
  resumeResumableStream(streamId: string): Promise<ReadableStream<string> | null | undefined> {
    return this.resumable().resumeExistingStream(streamId);
  }

  async hasResumableStream(streamId: string): Promise<boolean> {
    try {
      return (await this.resumable().hasExistingStream(streamId)) === true;
    } catch {
      return false;
    }
  }

  registerStreamController(streamId: string, controller: AbortController): void {
    this.streamControllers.set(streamId, controller);
  }

  unregisterStreamController(streamId: string): void {
    this.streamControllers.delete(streamId);
  }

  /** Explicit stop only. A browser disconnect must never call this. */
  cancelStream(streamId: string): boolean {
    const controller = this.streamControllers.get(streamId);
    if (!controller) return false;
    controller.abort();
    this.streamControllers.delete(streamId);
    return true;
  }

  /**
   * Cross-instance stop flag. The API instance that owns the producer polls
   * this key, so a stop request handled by another replica still reaches it.
   */
  async requestCancel(streamId: string): Promise<void> {
    await this.redis.set(streamCancelKey(streamId), "1", 60);
  }

  async isCancelRequested(streamId: string): Promise<boolean> {
    return (await this.redis.get(streamCancelKey(streamId))) !== null;
  }

  async clearCancelRequest(streamId: string): Promise<void> {
    await this.redis.delete(streamCancelKey(streamId));
  }

  /**
   * Binds the final assistant message to the runtime id allocated by
   * `ThreadRuntime.resumeRun`. A refreshed browser receives a new assistant-ui
   * message id; the still-running producer must persist under that id instead
   * of the id from the original request, or history gains a duplicate row.
   */
  async bindAssistantMessage(streamId: string, clientId: string): Promise<void> {
    await this.redis.set(streamAssistantKey(streamId), clientId, RESUMABLE_STREAM_TTL_SECONDS);
  }

  async boundAssistantMessage(streamId: string): Promise<string | undefined> {
    return (await this.redis.get(streamAssistantKey(streamId))) ?? undefined;
  }

  async onModuleDestroy(): Promise<void> {
    for (const client of [this.streamPublisher, this.streamSubscriber]) {
      if (!client) continue;
      try {
        if (client.status === "ready") await client.quit();
        else client.disconnect();
      } catch {
        client.disconnect();
      }
    }
    this.streamPublisher = undefined;
    this.streamSubscriber = undefined;
    this.resumableContext = undefined;
    this.streamControllers.clear();
  }

  private resumable(): ResumableStreamContext {
    if (this.resumableContext) return this.resumableContext;

    const publisher = this.redis.client.duplicate();
    const subscriber = this.redis.client.duplicate();
    this.streamPublisher = publisher;
    this.streamSubscriber = subscriber;
    this.resumableContext = createResumableStreamContext({
      keyPrefix: RESUMABLE_STREAM_PREFIX,
      // Nest owns the process; keep the completion promise alive without
      // blocking the request that created the producer.
      waitUntil: (promise) => {
        void promise.catch(() => undefined);
      },
      publisher,
      subscriber,
    });
    return this.resumableContext;
  }
}

function streamAssistantKey(streamId: string): string {
  return `${STREAM_ASSISTANT_KEY_PREFIX}${createHash("sha256").update(streamId).digest("hex")}`;
}

function streamCancelKey(streamId: string): string {
  return `${STREAM_CANCEL_KEY_PREFIX}${createHash("sha256").update(streamId).digest("hex")}`;
}
