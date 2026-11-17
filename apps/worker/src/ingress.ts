import IORedis from "ioredis";
import type { Queue } from "bullmq";

import type { WorkerLogger } from "./logger.js";
import type { QueueName } from "./queues.js";

export const JOB_INGRESS_KEY = "jobs:ingress";

interface IngressEnvelope {
  queue: QueueName;
  name: string;
  jobId: string;
  data: unknown;
  delayMs?: number;
}

export interface JobIngress {
  close(): Promise<void>;
}

/**
 * Bridges the API's dependency-free Redis ingress list into BullMQ, preserving
 * deterministic job ids so duplicate API requests collapse into one job.
 */
export async function startJobIngress(options: {
  redisUrl: string;
  prefix: string;
  queues: ReadonlyMap<QueueName, Queue<unknown, unknown, string>>;
  logger: WorkerLogger;
}): Promise<JobIngress> {
  const prefix = options.prefix.replace(/:+$/, "");
  const redis = new IORedis(options.redisUrl, {
    keyPrefix: `${prefix}:`,
    maxRetriesPerRequest: null,
    connectionName: "roamlog-worker-ingress",
  });
  let stopped = false;

  const loop = (async () => {
    while (!stopped) {
      try {
        const item = await redis.blpop(JOB_INGRESS_KEY, 5);
        if (!item) {
          continue;
        }
        const raw = item[1];
        const envelope = JSON.parse(raw) as IngressEnvelope;
        const queue = options.queues.get(envelope.queue);
        if (!queue) {
          options.logger.warn(
            { queue: envelope.queue, jobId: envelope.jobId },
            "ingress queue is not running",
          );
          continue;
        }
        await queue.add(envelope.name, envelope.data, {
          jobId: envelope.jobId,
          ...(envelope.delayMs && envelope.delayMs > 0
            ? { delay: envelope.delayMs }
            : {}),
        });
      } catch (error) {
        if (stopped) {
          break;
        }
        options.logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "job ingress failed",
        );
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  })();

  return {
    async close() {
      stopped = true;
      redis.disconnect();
      await Promise.race([loop, new Promise((resolve) => setTimeout(resolve, 6_000))]);
    },
  };
}
