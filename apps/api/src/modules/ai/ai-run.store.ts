import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type { AiToolCall } from "@roamlog/contracts";

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

export function newRunId(): string {
  return randomBytes(16).toString("hex");
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