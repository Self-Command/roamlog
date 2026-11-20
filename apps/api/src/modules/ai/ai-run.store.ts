import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type { AiToolCall } from "@roamlog/contracts";

import { generateUuidV7 } from "../auth/uuid.js";
import { RedisService } from "../redis/redis.service.js";
import type { AiPlaceCandidate } from "./ai-tools.js";

/** Plans are short-lived: the user confirms within 15 minutes. */
export const AI_RUN_TTL_SECONDS = 15 * 60;
const RUN_KEY_PREFIX = "ai:run:";
const CONSUMED_KEY_PREFIX = "ai:run:consumed:";

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
export class AiRunStore {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async save(run: StoredAiRun): Promise<void> {
    await this.redis.set(runKey(run.workspaceId, run.runId), JSON.stringify(run), AI_RUN_TTL_SECONDS);
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
}