import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import type { Queue, Job } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobProcessor } from "../src/processor.js";
import {
  QUEUE_NAMES,
  enqueueJob,
  redisConnectionOptions,
  startWorkerRuntime,
  type QueueName,
  type QueueProcessors,
  type WorkerRuntime,
} from "../src/queue.js";

const redisUrl =
  process.env.ROAMLOG_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379";
const redisIntegrationEnabled = Boolean(process.env.ROAMLOG_TEST_REDIS_URL);

let adminRedis: IORedis;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForState(
  queue: Queue<unknown, unknown, string>,
  jobId: string,
  expected: "completed" | "failed",
): Promise<Job<unknown, unknown, string>> {
  const deadline = Date.now() + 12_000;
  let lastState = "not-loaded";

  while (Date.now() < deadline) {
    const job = await queue.getJob(jobId);
    if (!job) {
      lastState = "missing";
    } else {
      lastState = await job.getState();
      if (lastState === expected) {
        return job;
      }
      if (lastState === "failed" && expected === "completed") {
        throw new Error(`Job ${jobId} failed instead of completing: ${job.failedReason}`);
      }
    }
    await sleep(50);
  }

  throw new Error(
    `Timed out waiting for job ${jobId} to become ${expected}; last state: ${lastState}`,
  );
}

async function createRuntime(
  processors: QueueProcessors,
  queueNames: readonly QueueName[] = ["email"],
): Promise<{ runtime: WorkerRuntime; prefix: string }> {
  const prefix = `roamlog:test:${process.pid}:${randomUUID()}`;
  const runtime = await startWorkerRuntime({
    redisUrl,
    prefix,
    processors,
    queueNames,
  });
  return { runtime, prefix };
}

async function deletePrefix(prefix: string): Promise<void> {
  const keys = await adminRedis.keys(`${prefix}:*`);
  if (keys.length > 0) {
    await adminRedis.del(...keys);
  }
}

async function destroyRuntime(runtime: WorkerRuntime, prefix: string): Promise<void> {
  try {
    await runtime.close();
  } finally {
    await deletePrefix(prefix);
  }
}

describe.skipIf(!redisIntegrationEnabled)("BullMQ queue integration", () => {
  beforeAll(async () => {
    adminRedis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    adminRedis.on("error", () => undefined);
    try {
      await adminRedis.connect();
      await adminRedis.ping();
    } catch (error) {
      throw new Error(
        `Redis integration tests require a reachable Redis at ${redisConnectionOptions(redisUrl).host}:${
          redisConnectionOptions(redisUrl).port
        }. Start it with docker compose -f docker/compose.yml up -d redis.`,
        { cause: error },
      );
    }
  });

  afterAll(async () => {
    if (adminRedis && adminRedis.status !== "end") {
      await adminRedis.quit();
    }
  });

  it("deduplicates jobs that share an explicit idempotency key", async () => {
    const calls: string[] = [];
    const processor: JobProcessor = {
      name: "dedupe-check",
      async handle(job) {
        calls.push(job.opts.jobId ?? "missing");
      },
    };
    const { runtime, prefix } = await createRuntime({ email: processor });

    try {
      const queue = runtime.queues.get("email");
      if (!queue) {
        throw new Error("email queue was not registered");
      }
      const jobId = `duplicate-${randomUUID()}`;
      const first = await enqueueJob(queue, "email.send", { template: "verify-email" }, { jobId });
      const second = await enqueueJob(queue, "email.send", { template: "verify-email" }, { jobId });

      expect(first.id).toBe(jobId);
      expect(second.id).toBe(jobId);
      await waitForState(queue, jobId, "completed");
      expect(calls).toEqual([jobId]);
      expect(await queue.getCompletedCount()).toBe(1);
    } finally {
      await destroyRuntime(runtime, prefix);
    }
  });

  it("passes the custom job ID to the idempotent processor contract", async () => {
    let receivedJobId: string | undefined;
    let processorName: string | undefined;
    const processor: JobProcessor = {
      name: "job-id-check",
      async handle(job, context) {
        receivedJobId = job.id;
        processorName = context.queue;
      },
    };
    const { runtime, prefix } = await createRuntime({ email: processor });

    try {
      const queue = runtime.queues.get("email");
      if (!queue) {
        throw new Error("email queue was not registered");
      }
      const jobId = `job-id-${randomUUID()}`;
      await enqueueJob(queue, "email.send", { template: "mention" }, { jobId });
      await waitForState(queue, jobId, "completed");

      expect(receivedJobId).toBe(jobId);
      expect(processorName).toBe("email");
    } finally {
      await destroyRuntime(runtime, prefix);
    }
  });

  it("marks a failing job as failed without stopping the worker", async () => {
    const calls: string[] = [];
    const processor: JobProcessor = {
      name: "failure-check",
      async handle(job) {
        const data = job.data as { mode: "fail" | "pass" };
        calls.push(data.mode);
        if (data.mode === "fail") {
          throw new Error("intentional queue test failure");
        }
      },
    };
    const { runtime, prefix } = await createRuntime({ email: processor });

    try {
      const queue = runtime.queues.get("email");
      const worker = runtime.workers.get("email");
      if (!queue || !worker) {
        throw new Error("email queue or worker was not registered");
      }

      const failedJobId = `failed-${randomUUID()}`;
      await enqueueJob(queue, "email.send", { mode: "fail" }, { jobId: failedJobId, attempts: 1 });
      const failed = await waitForState(queue, failedJobId, "failed");

      expect(await failed.getState()).toBe("failed");
      expect(failed.failedReason).toContain("intentional queue test failure");
      expect(worker.isRunning()).toBe(true);

      const completedJobId = `recovered-${randomUUID()}`;
      await enqueueJob(
        queue,
        "email.send",
        { mode: "pass" },
        { jobId: completedJobId, attempts: 1 },
      );
      await waitForState(queue, completedJobId, "completed");

      expect(calls).toEqual(["fail", "pass"]);
    } finally {
      await destroyRuntime(runtime, prefix);
    }
  });

  it("registers all five queues and closes every worker gracefully", async () => {
    const processors = Object.fromEntries(
      QUEUE_NAMES.map((queueName) => [
        queueName,
        {
          name: `${queueName}-lifecycle`,
          async handle() {
            return undefined;
          },
        } satisfies JobProcessor,
      ]),
    ) as QueueProcessors;
    const { runtime, prefix } = await createRuntime(processors, QUEUE_NAMES);

    try {
      expect([...runtime.queues.keys()]).toEqual(QUEUE_NAMES);
      expect([...runtime.workers.keys()]).toEqual(QUEUE_NAMES);
      for (const worker of runtime.workers.values()) {
        expect(worker.isRunning()).toBe(true);
      }

      await runtime.close();
      for (const worker of runtime.workers.values()) {
        expect(worker.isRunning()).toBe(false);
      }
    } finally {
      await destroyRuntime(runtime, prefix);
    }
  });
});
