import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AdminJobSchema,
  decodeCursor,
  encodeCursor,
  type AdminJob,
  type AdminJobPage,
  type AdminJobQuery,
  type AdminJobStatus,
} from "@roamlog/contracts";

import { RedisService } from "../redis/redis.service.js";

/**
 * BullMQ state keys. Queue names are discovered from these keys so the Admin
 * console never renders a hardcoded queue list that can drift from the worker.
 */
const QUEUE_KEY_SUFFIXES = new Set([
  "wait",
  "paused",
  "prioritized",
  "active",
  "failed",
  "completed",
  "delayed",
  "meta",
  "marker",
  "events",
  "stalled",
  "metrics",
]);

/** Window used to turn BullMQ completion timestamps into a per-minute rate. */
export const THROUGHPUT_WINDOW_SECONDS = 300;

/**
 * Blocking primitives BullMQ uses for the worker fetch loop. `BZPOPMIN` on the
 * queue marker is the current one; the others are kept for older deployments.
 */
const BULLMQ_BLOCKING_COMMANDS = new Set(["bzpopmin", "blmpop", "brpoplpush"]);

const QUEUE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const SCAN_PAGE_SIZE = 500;
const SCAN_MAX_ITERATIONS = 200;
const LIST_LIMIT = 1_000;

export interface AdminQueueCounters {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  delayed: number;
  paused: boolean;
  /** Derived from BullMQ completion timestamps; null when Redis cannot answer. */
  throughputPerMinute: number | null;
  throughputWindowSeconds: number | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
}

export type AdminQueueWorkerSignal = "consumer-clients" | "activity-derived" | "unavailable";

export interface AdminQueueWorkerHealth {
  status: "up" | "degraded" | "down";
  /** Consumers currently blocked inside a BullMQ fetch loop (observed). */
  consumers: number;
  signal: AdminQueueWorkerSignal;
  blockedConsumers: number;
  lastJobAt: string | null;
  lastJobStatus: "completed" | "failed" | null;
  lastJobQueue: string | null;
}

export interface AdminQueueRetryResult {
  queue: string;
  jobId: string;
  queued: true;
}

interface QueueClient {
  options?: { keyPrefix?: string };
  llen(key: string): Promise<number>;
  zcard(key: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  hgetall(key: string): Promise<Record<string, string>>;
  zscore(key: string, member: string): Promise<string | null>;
  exists(key: string): Promise<number>;
  zrem(key: string, member: string): Promise<number>;
  lpush(key: string, value: string): Promise<number>;
  hset(key: string, values: Record<string, string>): Promise<number>;
  del(key: string): Promise<number>;
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
  call(command: string, ...args: string[]): Promise<unknown>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
}

function listKey(queue: string, suffix: string): string {
  return `${queue}:${suffix}`;
}

function jobKey(queue: string, jobId: string): string {
  return `${queue}:${jobId}`;
}

function metaKey(queue: string): string {
  return `${queue}:meta`;
}

function queueLifecycleScript(): string {
  return `
local rcall = redis.call
if ARGV[1] == "paused" then
  rcall("HSET", KEYS[1], "paused", 1)
  rcall("DEL", KEYS[5])
  return 0
end

rcall("HDEL", KEYS[1], "paused")
local pausedKey = KEYS[2]
local waitKey = KEYS[3]
if rcall("EXISTS", pausedKey) == 1 then
  while rcall("EXISTS", pausedKey) == 1 do
    local jobs = rcall("LRANGE", pausedKey, 0, 6999)
    if #jobs == 0 then
      break
    end
    if rcall("EXISTS", waitKey) == 0 then
      rcall("RENAME", pausedKey, waitKey)
    else
      rcall("RPUSH", waitKey, unpack(jobs))
      rcall("LTRIM", pausedKey, #jobs, -1)
    end
  end
end

if rcall("LLEN", waitKey) > 0 or rcall("ZCARD", KEYS[4]) > 0 then
  rcall("ZADD", KEYS[5], 0, "0")
else
  local delayed = rcall("ZRANGE", KEYS[6], 0, 0, "WITHSCORES")
  if delayed[2] ~= nil then
    rcall("ZADD", KEYS[5], tonumber(delayed[2]) / 0x1000, "1")
  end
end
return 0
`;
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function timestamp(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isoFromScore(value: unknown): string | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseData(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function statusKey(
  status: AdminJobStatus,
): "wait" | "active" | "failed" | "completed" | "delayed" | "paused" {
  switch (status) {
    case "waiting":
      return "wait";
    case "active":
      return "active";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    case "delayed":
      return "delayed";
    case "paused":
      return "paused";
  }
}

/** Splits one `CLIENT LIST` line into `field=value` pairs. */
function parseClientListLine(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of line.trim().split(/\s+/)) {
    const separator = part.indexOf("=");
    if (separator > 0) {
      fields[part.slice(0, separator)] = part.slice(separator + 1);
    }
  }
  return fields;
}

/**
 * Counts Redis clients that are blocked inside a BullMQ fetch loop. BullMQ v6
 * workers never call `CLIENT SETNAME`, so connection names cannot identify
 * them; the blocking command plus the `b` flag is the observable signal.
 */
export function countBlockedConsumers(clientList: string): number {
  let blocked = 0;
  for (const line of clientList.split("\n")) {
    if (!line.includes("cmd=")) {
      continue;
    }
    const fields = parseClientListLine(line);
    const command = (fields.cmd ?? "").toLowerCase();
    const flags = fields.flags ?? "";
    if (BULLMQ_BLOCKING_COMMANDS.has(command) && flags.includes("b")) {
      blocked += 1;
    }
  }
  return blocked;
}

@Injectable()
export class AdminQueueService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  private client(): QueueClient {
    const client = (this.redis as unknown as { client?: QueueClient }).client;
    if (!client) {
      throw new Error("Redis queue client is unavailable");
    }
    return client;
  }

  /**
   * Queue names as registered in Redis. Every BullMQ queue materialises at
   * least one state key, so scanning for those keys reflects real registration
   * instead of a maintained list.
   */
  async listQueues(): Promise<string[]> {
    const client = this.client();
    const prefix = (client.options?.keyPrefix ?? "").replace(/:+$/, "");
    const pattern = prefix ? `${prefix}:*` : "*";
    const names = new Set<string>();

    let cursor = "0";
    let iterations = 0;
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        SCAN_PAGE_SIZE,
      );
      for (const key of keys) {
        const relative = prefix && key.startsWith(`${prefix}:`) ? key.slice(prefix.length + 1) : key;
        const separator = relative.lastIndexOf(":");
        if (separator <= 0) {
          continue;
        }
        const queue = relative.slice(0, separator);
        const suffix = relative.slice(separator + 1);
        if (QUEUE_KEY_SUFFIXES.has(suffix) && QUEUE_NAME_PATTERN.test(queue)) {
          names.add(queue);
        }
      }
      cursor = nextCursor;
      iterations += 1;
      if (iterations >= SCAN_MAX_ITERATIONS) {
        break;
      }
    } while (cursor !== "0");

    return [...names].sort();
  }

  async stats(queues?: readonly string[]): Promise<AdminQueueCounters[]> {
    const client = this.client();
    const names = queues ?? (await this.listQueues());
    return Promise.all(names.map((name) => this.counters(client, name)));
  }

  async listJobs(query: AdminJobQuery): Promise<AdminJobPage> {
    const client = this.client();
    const queues = query.queue ? [query.queue] : await this.listQueues();
    const statuses: AdminJobStatus[] = query.status
      ? [query.status]
      : ["waiting", "active", "failed", "completed", "delayed", "paused"];

    const rows: AdminJob[] = [];
    for (const queue of queues) {
      for (const status of statuses) {
        const ids = await this.jobIds(client, queue, status);
        for (const id of ids) {
          const job = await this.readJob(client, queue, id, status);
          if (job) {
            rows.push(job);
          }
        }
      }
    }

    rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const cursorId = query.cursor ? safeCursorId(query.cursor) : undefined;
    const start = cursorId ? rows.findIndex((job) => job.id === cursorId) + 1 : 0;
    const visible = rows.slice(start, start + query.limit);
    const hasMore = start + query.limit < rows.length;
    const last = visible.at(-1);

    return {
      items: visible,
      nextCursor: hasMore && last ? encodeCursor({ id: last.id, createdAt: last.createdAt }) : null,
      hasMore,
    };
  }

  async retryJob(queue: string, jobId: string): Promise<AdminQueueRetryResult> {
    await this.assertQueue(queue);

    const client = this.client();
    const exists = await client.exists(jobKey(queue, jobId));
    if (numberOrZero(exists) === 0) {
      throw new NotFoundException({
        code: "JOB_NOT_FOUND",
        message: "The queue job was not found.",
      });
    }

    const failedScore = await client.zscore(listKey(queue, "failed"), jobId);
    if (failedScore === null) {
      throw new ConflictException({
        code: "JOB_NOT_FAILED",
        message: "Only failed jobs can be retried.",
      });
    }

    await client.zrem(listKey(queue, "failed"), jobId);
    await client.hset(jobKey(queue, jobId), { attemptsMade: "0", failedReason: "" });
    await client.lpush(listKey(queue, "wait"), jobId);

    return { queue, jobId, queued: true };
  }

  async pauseQueue(queue: string): Promise<void> {
    await this.assertQueue(queue);
    await this.applyLifecycle(queue, "paused");
  }

  async resumeQueue(queue: string): Promise<void> {
    await this.assertQueue(queue);
    await this.applyLifecycle(queue, "resumed");
  }

  async clearFailed(queue: string): Promise<number> {
    await this.assertQueue(queue);
    const client = this.client();
    const failedKey = listKey(queue, "failed");
    const jobIds = await client.zrange(failedKey, 0, -1);
    if (jobIds.length === 0) {
      return 0;
    }

    await Promise.all(jobIds.map((jobId) => client.zrem(failedKey, jobId)));
    await Promise.all(
      jobIds.flatMap((jobId) => [
        client.del(jobKey(queue, jobId)),
        client.del(`${jobKey(queue, jobId)}:logs`),
      ]),
    );
    return jobIds.length;
  }

  /**
   * Worker health from signals that can actually be observed:
   * 1. blocked BullMQ consumer clients (`CLIENT LIST`), else
   * 2. queue counters plus the newest job completion/failure timestamp, else
   * 3. `unavailable`, so the console can say "not wired" instead of inventing DOWN.
   */
  async workerHealth(queues?: readonly string[]): Promise<AdminQueueWorkerHealth> {
    const client = this.client();
    const stats = await this.stats(queues);

    const lastJob = newestJob(stats);
    const queued = stats
      .filter((item) => !item.paused)
      .reduce((total, item) => total + item.waiting, 0);
    const active = stats.reduce((total, item) => total + item.active, 0);

    let blocked: number | null;
    try {
      const output = await client.call("CLIENT", "LIST");
      blocked =
        typeof output === "string"
          ? countBlockedConsumers(output)
          : Number.isFinite(Number(output))
            ? numberOrZero(output)
            : null;
    } catch {
      blocked = null;
    }

    const base = {
      consumers: blocked ?? 0,
      blockedConsumers: blocked ?? 0,
      lastJobAt: lastJob.lastJobAt,
      lastJobStatus: lastJob.lastJobStatus,
      lastJobQueue: lastJob.lastJobQueue,
    };

    if (blocked === null) {
      return { status: "degraded", signal: "unavailable", ...base };
    }
    if (blocked > 0) {
      return { status: "up", signal: "consumer-clients", ...base };
    }
    if (active > 0) {
      return { status: "up", signal: "activity-derived", ...base };
    }
    if (queued > 0) {
      return { status: "down", signal: "consumer-clients", ...base };
    }
    if (lastJob.lastJobAt && Date.now() - Date.parse(lastJob.lastJobAt) <= ACTIVITY_FRESH_MS) {
      return { status: "degraded", signal: "activity-derived", ...base };
    }
    return { status: "degraded", signal: "unavailable", ...base };
  }

  private async counters(client: QueueClient, name: string): Promise<AdminQueueCounters> {
    const [waiting, active, failed, completed, delayed, meta] = await Promise.all([
      client.llen(listKey(name, "wait")),
      client.llen(listKey(name, "active")),
      client.zcard(listKey(name, "failed")),
      client.zcard(listKey(name, "completed")),
      client.zcard(listKey(name, "delayed")),
      client.hgetall(metaKey(name)),
    ]);

    const now = Date.now();
    const windowMs = THROUGHPUT_WINDOW_SECONDS * 1_000;
    const completedKey = listKey(name, "completed");
    const failedKey = listKey(name, "failed");

    const [throughput, lastCompletedAt, lastFailedAt] = await Promise.all([
      this.completedInWindow(client, completedKey, now - windowMs),
      this.newestScore(client, completedKey),
      this.newestScore(client, failedKey),
    ]);

    return {
      name,
      waiting: numberOrZero(waiting),
      active: numberOrZero(active),
      failed: numberOrZero(failed),
      completed: numberOrZero(completed),
      delayed: numberOrZero(delayed),
      paused: Boolean(meta && Object.prototype.hasOwnProperty.call(meta, "paused")),
      throughputPerMinute:
        throughput === null ? null : throughput / (THROUGHPUT_WINDOW_SECONDS / 60),
      throughputWindowSeconds: throughput === null ? null : THROUGHPUT_WINDOW_SECONDS,
      lastCompletedAt,
      lastFailedAt,
    };
  }

  private async completedInWindow(
    client: QueueClient,
    key: string,
    since: number,
  ): Promise<number | null> {
    try {
      const total = await client.call("ZCOUNT", key, String(Math.trunc(since)), "+inf");
      const parsed = Number(total);
      return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
    } catch {
      return null;
    }
  }

  private async newestScore(client: QueueClient, key: string): Promise<string | null> {
    try {
      const rows = await client.call("ZRANGE", key, "-1", "-1", "WITHSCORES");
      if (!Array.isArray(rows) || rows.length < 2) {
        return null;
      }
      return isoFromScore(rows[1]);
    } catch {
      return null;
    }
  }

  private async assertQueue(queue: string): Promise<void> {
    const registered = await this.listQueues();
    if (!registered.includes(queue)) {
      throw new NotFoundException({
        code: "JOB_QUEUE_NOT_FOUND",
        message: "The queue was not found.",
      });
    }
  }

  private async applyLifecycle(queue: string, action: "paused" | "resumed"): Promise<void> {
    const client = this.client();
    const keys = [
      metaKey(queue),
      listKey(queue, "paused"),
      listKey(queue, "wait"),
      listKey(queue, "prioritized"),
      listKey(queue, "marker"),
      listKey(queue, "delayed"),
    ];

    await client.eval(queueLifecycleScript(), keys.length, ...keys, action);
  }

  private async jobIds(
    client: QueueClient,
    queue: string,
    status: AdminJobStatus,
  ): Promise<string[]> {
    const key = listKey(queue, statusKey(status));
    if (status === "failed" || status === "completed" || status === "delayed") {
      return client.zrange(key, 0, LIST_LIMIT - 1);
    }
    return client.lrange(key, 0, LIST_LIMIT - 1);
  }

  private async readJob(
    client: QueueClient,
    queue: string,
    jobId: string,
    status: AdminJobStatus,
  ): Promise<AdminJob | null> {
    const hash = await client.hgetall(jobKey(queue, jobId));
    if (!hash || Object.keys(hash).length === 0) {
      return null;
    }

    const createdAt = timestamp(hash.timestamp);
    const processedAt = timestamp(hash.processedOn);
    const finishedAt = timestamp(hash.finishedOn);
    const parsed = AdminJobSchema.safeParse({
      id: jobId,
      queue,
      name: hash.name?.trim() ? hash.name : "unknown",
      status,
      attempts: numberOrZero(hash.attemptsMade),
      data: parseData(hash.data),
      failedReason: hash.failedReason?.trim() ? hash.failedReason : null,
      createdAt: new Date(createdAt || Date.now()).toISOString(),
      processedAt: processedAt ? new Date(processedAt).toISOString() : null,
      finishedAt: finishedAt ? new Date(finishedAt).toISOString() : null,
    });
    return parsed.success ? parsed.data : null;
  }
}

/** How recently a job must have finished for "activity" to count as a signal. */
const ACTIVITY_FRESH_MS = 10 * 60 * 1_000;

function newestJob(stats: readonly AdminQueueCounters[]): {
  lastJobAt: string | null;
  lastJobStatus: "completed" | "failed" | null;
  lastJobQueue: string | null;
} {
  let lastJobAt: string | null = null;
  let lastJobStatus: "completed" | "failed" | null = null;
  let lastJobQueue: string | null = null;

  for (const queue of stats) {
    for (const [status, value] of [
      ["completed", queue.lastCompletedAt],
      ["failed", queue.lastFailedAt],
    ] as const) {
      if (!value) {
        continue;
      }
      if (!lastJobAt || value > lastJobAt) {
        lastJobAt = value;
        lastJobStatus = status;
        lastJobQueue = queue.name;
      }
    }
  }

  return { lastJobAt, lastJobStatus, lastJobQueue };
}

function safeCursorId(cursor: string): string | undefined {
  try {
    return decodeCursor(cursor).id;
  } catch {
    return undefined;
  }
}