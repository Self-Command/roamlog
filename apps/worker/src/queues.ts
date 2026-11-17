import { createHash } from "node:crypto";
import type { JobsOptions, RedisOptions } from "bullmq";
import type { JobProcessor } from "./processor.js";

export const QUEUE_DEFINITIONS = {
  media: {
    concurrency: 2,
    retries: 3,
    backoffDelayMs: 5_000,
  },
  email: {
    concurrency: 10,
    retries: 5,
    backoffDelayMs: 2_000,
  },
  export: {
    concurrency: 2,
    retries: 2,
    backoffDelayMs: 10_000,
  },
  reminders: {
    concurrency: 5,
    retries: 3,
    backoffDelayMs: 5_000,
  },
  maintenance: {
    concurrency: 1,
    retries: 1,
    backoffDelayMs: 30_000,
  },
} as const;

export type QueueName = keyof typeof QUEUE_DEFINITIONS;
export type QueuePolicy = (typeof QUEUE_DEFINITIONS)[QueueName];
export type QueueProcessors = Partial<Record<QueueName, JobProcessor>>;

export const QUEUE_NAMES = Object.keys(QUEUE_DEFINITIONS) as QueueName[];

export function normalizePrefix(prefix: string): string {
  const normalized = prefix.trim().replace(/:+$/, "");
  if (!normalized) {
    throw new Error("Redis prefix must be a non-empty value");
  }
  return normalized;
}

export function redisConnectionOptions(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error(`Unsupported Redis protocol "${url.protocol}"; expected redis: or rediss:`);
  }

  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isInteger(database) || database < 0) {
    throw new Error(`Invalid Redis database in ${redisUrl}`);
  }

  const port = Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid Redis port in ${redisUrl}`);
  }

  return {
    host: url.hostname,
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database,
    maxRetriesPerRequest: null,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

export function makeDeterministicJobId(
  namespace: string,
  ...parts: ReadonlyArray<string | number | boolean>
): string {
  if (!namespace.trim()) {
    throw new Error("A job ID namespace is required");
  }
  return createHash("sha256")
    .update([namespace, ...parts.map(String)].join("\0"))
    .digest("hex");
}

export function assertValidJobId(jobId: string): void {
  if (!jobId.trim()) {
    throw new Error("jobId must not be empty");
  }
  if (jobId !== jobId.trim()) {
    throw new Error("jobId must not contain leading or trailing whitespace");
  }
  if (jobId.includes(":")) {
    throw new Error("jobId must not contain ':'");
  }
  if (String(Number.parseInt(jobId, 10)) === jobId) {
    throw new Error("jobId must not be an integer");
  }
}

export function queueDefaultJobOptions(policy: QueuePolicy): JobsOptions {
  return {
    attempts: policy.retries + 1,
    backoff: {
      type: "exponential",
      delay: policy.backoffDelayMs,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 1_000,
    },
    removeOnFail: {
      age: 30 * 24 * 60 * 60,
      count: 5_000,
    },
    stackTraceLimit: 10,
  };
}
