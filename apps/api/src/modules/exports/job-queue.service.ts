import { createHash } from "node:crypto";

import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import { RedisService } from "../redis/redis.service.js";

export const INGRESS_QUEUE_KEY = "jobs:ingress";

export type JobQueueName = "media" | "email" | "export" | "reminders" | "maintenance";

export interface EnqueueRequest {
  queue: JobQueueName;
  name: string;
  jobId: string;
  data: unknown;
  delayMs?: number;
}

export interface EnqueuedJob {
  jobId: string;
  queue: JobQueueName;
  name: string;
}

export function deterministicJobId(namespace: string, ...parts: ReadonlyArray<string | number>): string {
  return `${namespace}-${createHash("sha256")
    .update([namespace, ...parts.map(String)].join("\u0000"))
    .digest("hex")
    .slice(0, 32)}`;
}

/**
 * The API process does not depend on BullMQ directly. It appends a signed job
 * envelope to a Redis ingress list; the worker drains this list into BullMQ
 * with the same deterministic jobId, so duplicate API requests remain
 * idempotent at the queue boundary.
 */
@Injectable()
export class JobQueueService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async enqueue(request: EnqueueRequest): Promise<EnqueuedJob> {
    if (!request.jobId.trim() || request.jobId.includes(":")) {
      throw new BadRequestException({
        code: "INVALID_JOB_ID",
        message: "Queue job ids must be non-empty and contain no ':' characters.",
      });
    }
    const envelope = JSON.stringify({
      queue: request.queue,
      name: request.name,
      jobId: request.jobId,
      data: request.data,
      delayMs: Math.max(0, Math.trunc(request.delayMs ?? 0)),
      enqueuedAt: new Date().toISOString(),
    });
    await this.redis.client.rpush(INGRESS_QUEUE_KEY, envelope);
    return { jobId: request.jobId, queue: request.queue, name: request.name };
  }
}
