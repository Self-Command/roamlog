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

const DEFAULT_QUEUES = ["media", "email", "export", "reminders", "maintenance"] as const;
const LIST_LIMIT = 1_000;

export interface AdminQueueCounters {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  delayed: number;
  paused: boolean;
}

export interface AdminQueueRetryResult {
  queue: string;
  jobId: string;
  queued: true;
}

export interface AdminQueueWorkerHealth {
  status: "up" | "degraded" | "down";
  consumers: number;
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

  async stats(queues: readonly string[] = DEFAULT_QUEUES): Promise<AdminQueueCounters[]> {
    const client = this.client();
    return Promise.all(
      queues.map(async (name) => {
        const [waiting, active, failed, completed, delayed, meta] = await Promise.all([
          client.llen(listKey(name, "wait")),
          client.llen(listKey(name, "active")),
          client.zcard(listKey(name, "failed")),
          client.zcard(listKey(name, "completed")),
          client.zcard(listKey(name, "delayed")),
          client.hgetall(metaKey(name)),
        ]);
        return {
          name,
          waiting: numberOrZero(waiting),
          active: numberOrZero(active),
          failed: numberOrZero(failed),
          completed: numberOrZero(completed),
          delayed: numberOrZero(delayed),
          paused: Boolean(meta && Object.prototype.hasOwnProperty.call(meta, "paused")),
        };
      }),
    );
  }

  async listJobs(query: AdminJobQuery): Promise<AdminJobPage> {
    const client = this.client();
    const queues = query.queue ? [query.queue] : [...DEFAULT_QUEUES];
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
    this.assertQueue(queue);

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
    this.assertQueue(queue);
    await this.applyLifecycle(queue, "paused");
  }

  async resumeQueue(queue: string): Promise<void> {
    this.assertQueue(queue);
    await this.applyLifecycle(queue, "resumed");
  }

  async clearFailed(queue: string): Promise<number> {
    this.assertQueue(queue);
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

  async workerHealth(queues: readonly string[] = DEFAULT_QUEUES): Promise<AdminQueueWorkerHealth> {
    const client = this.client();
    const output = await client.call("CLIENT", "LIST");
    if (typeof output !== "string") {
      throw new Error("Redis CLIENT LIST returned an invalid response");
    }

    const prefix = (client.options?.keyPrefix ?? "").replace(/:+$/, "");
    const names = [...output.matchAll(/\bname=(\S+)/g)].map((match) => match[1] ?? "");
    const workerNames = queues.flatMap((queue) => {
      const encodedQueue = Buffer.from(queue).toString("base64");
      return names.filter(
        (name) =>
          name === `${prefix}:${encodedQueue}:w:` ||
          name.startsWith(`${prefix}:${encodedQueue}:w:`),
      );
    });
    const consumers = workerNames.length;
    const status = consumers === 0 ? "down" : consumers < queues.length ? "degraded" : "up";
    return { status, consumers };
  }

  private assertQueue(queue: string): void {
    if (!DEFAULT_QUEUES.includes(queue as (typeof DEFAULT_QUEUES)[number])) {
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

function safeCursorId(cursor: string): string | undefined {
  try {
    return decodeCursor(cursor).id;
  } catch {
    return undefined;
  }
}
