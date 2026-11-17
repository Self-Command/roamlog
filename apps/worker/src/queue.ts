import { Queue, Worker, type JobsOptions, type Job, type RedisOptions } from "bullmq";
import type { WorkerLogger } from "./logger.js";
import { serializeError } from "./logger.js";
import {
  MissingIdempotencyKeyError,
  type JobProcessor,
  type ProcessorContext,
} from "./processor.js";
import {
  QUEUE_DEFINITIONS,
  QUEUE_NAMES,
  assertValidJobId,
  normalizePrefix,
  queueDefaultJobOptions,
  redisConnectionOptions,
  type QueueName,
  type QueueProcessors,
} from "./queues.js";

export * from "./queues.js";

const silentLogger: WorkerLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface WorkerRuntimeOptions {
  redisUrl?: string;
  connection?: RedisOptions;
  prefix?: string;
  processors: QueueProcessors;
  queueNames?: readonly QueueName[];
  logger?: WorkerLogger;
}

export interface WorkerRuntime {
  readonly prefix: string;
  readonly queueNames: readonly QueueName[];
  readonly queues: ReadonlyMap<QueueName, Queue<unknown, unknown, string>>;
  readonly workers: ReadonlyMap<QueueName, Worker<unknown, unknown, string>>;
  close(force?: boolean): Promise<void>;
}

export type EnqueueJobOptions = Omit<JobsOptions, "jobId"> & {
  jobId: string;
};

export async function enqueueJob<TData>(
  queue: Queue<TData, unknown, string>,
  jobName: string,
  data: TData,
  options: EnqueueJobOptions,
): Promise<Job<TData, unknown, string>> {
  if (!jobName.trim()) {
    throw new Error("jobName must not be empty");
  }
  assertValidJobId(options.jobId);

  const { jobId, ...jobOptions } = options;
  const queueHandle = queue as unknown as Queue<unknown, unknown, string>;
  const job = await queueHandle.add(jobName, data, {
    ...jobOptions,
    jobId,
  });
  return job as unknown as Job<TData, unknown, string>;
}

function processorContext(queue: QueueName, jobId: string, logger: WorkerLogger): ProcessorContext {
  return {
    queue,
    jobId,
    logger,
  };
}

function requireProcessor(processors: QueueProcessors, queue: QueueName): JobProcessor {
  const processor = processors[queue];
  if (!processor) {
    throw new Error(`No processor registered for queue "${queue}"`);
  }
  return processor;
}

function attachLogging(
  worker: Worker<unknown, unknown, string>,
  queue: QueueName,
  processor: JobProcessor,
  prefix: string,
  logger: WorkerLogger,
): void {
  worker.on("active", (job) => {
    const maxAttempts = job.opts.attempts ?? QUEUE_DEFINITIONS[queue].retries + 1;
    logger.info(
      {
        event: "job.active",
        queue,
        prefix,
        jobId: job.id,
        jobName: job.name,
        processor: processor.name,
        attempt: job.attemptsStarted,
        maxAttempts,
      },
      "job active",
    );
  });

  worker.on("completed", (job) => {
    const durationMs =
      job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined;
    logger.info(
      {
        event: "job.completed",
        queue,
        prefix,
        jobId: job.id,
        jobName: job.name,
        processor: processor.name,
        durationMs,
      },
      "job completed",
    );
  });

  worker.on("failed", (job, error) => {
    const maxAttempts = job?.opts.attempts ?? QUEUE_DEFINITIONS[queue].retries + 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    const terminal = attemptsMade >= maxAttempts;
    logger.error(
      {
        event: terminal ? "job.dead" : "job.failed",
        queue,
        prefix,
        jobId: job?.id,
        jobName: job?.name,
        processor: processor.name,
        attemptsMade,
        maxAttempts,
        terminal,
        error: serializeError(error),
      },
      terminal ? "job exhausted retries and remains failed" : "job failed; retry scheduled",
    );
  });

  worker.on("stalled", (jobId, previousState) => {
    logger.warn(
      {
        event: "job.stalled",
        queue,
        prefix,
        jobId,
        previousState,
      },
      "job stalled",
    );
  });

  worker.on("error", (error) => {
    logger.error(
      {
        event: "worker.error",
        queue,
        prefix,
        error: serializeError(error),
      },
      "worker error",
    );
  });
}

export async function startWorkerRuntime(options: WorkerRuntimeOptions): Promise<WorkerRuntime> {
  const logger = options.logger ?? silentLogger;
  const prefix = normalizePrefix(options.prefix ?? "roamlog");
  const connection =
    options.connection ?? redisConnectionOptions(options.redisUrl ?? "redis://localhost:6379");
  const queueNames = [...new Set(options.queueNames ?? QUEUE_NAMES)];

  if (queueNames.length === 0) {
    throw new Error("At least one queue must be selected");
  }

  const queues = new Map<QueueName, Queue<unknown, unknown, string>>();
  const workers = new Map<QueueName, Worker<unknown, unknown, string>>();

  try {
    for (const queueName of queueNames) {
      const processor = requireProcessor(options.processors, queueName);
      const policy = QUEUE_DEFINITIONS[queueName];
      const queue = new Queue<unknown, unknown, string>(queueName, {
        connection: { ...connection },
        prefix,
        defaultJobOptions: queueDefaultJobOptions(policy),
      });
      queues.set(queueName, queue);
      queue.on("error", (error) => {
        logger.error(
          {
            event: "queue.error",
            queue: queueName,
            prefix,
            error: serializeError(error),
          },
          "queue error",
        );
      });

      const worker = new Worker<unknown, unknown, string>(
        queueName,
        async (job) => {
          const idempotencyKey = job.opts.jobId;
          if (!idempotencyKey) {
            throw new MissingIdempotencyKeyError(job.name);
          }
          return processor.handle(job, processorContext(queueName, idempotencyKey, logger));
        },
        {
          connection: { ...connection },
          prefix,
          concurrency: policy.concurrency,
        },
      );
      workers.set(queueName, worker);
      attachLogging(worker, queueName, processor, prefix, logger);
    }

    await Promise.all([
      ...[...queues.values()].map((queue) => queue.waitUntilReady()),
      ...[...workers.values()].map((worker) => worker.waitUntilReady()),
    ]);
  } catch (error) {
    await Promise.allSettled([...workers.values()].map((worker) => worker.close(true)));
    await Promise.allSettled([...queues.values()].map((queue) => queue.close()));
    throw error;
  }

  let closing: Promise<void> | undefined;
  return {
    prefix,
    queueNames,
    queues,
    workers,
    close(force = false) {
      closing ??= (async () => {
        await Promise.allSettled([...workers.values()].map((worker) => worker.close(force)));
        await Promise.allSettled([...queues.values()].map((queue) => queue.close()));
      })();
      return closing;
    },
  };
}
