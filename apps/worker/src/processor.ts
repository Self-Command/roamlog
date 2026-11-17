import type { Job } from "bullmq";
import type { WorkerLogger } from "./logger.js";

export interface ProcessorContext {
  queue: string;
  jobId: string;
  logger: WorkerLogger;
}

/**
 * A queue processor owns every job name in one queue. Handlers must use
 * job.id as their idempotency key before applying side effects.
 */
export interface JobProcessor<TData = unknown, TResult = unknown> {
  readonly name: string;
  handle(job: Job<TData, TResult>, context: ProcessorContext): Promise<TResult>;
}

export class MissingIdempotencyKeyError extends Error {
  readonly code = "JOB_ID_REQUIRED";

  constructor(jobName: string) {
    super(`Job "${jobName}" was enqueued without an explicit jobId idempotency key`);
    this.name = "MissingIdempotencyKeyError";
  }
}

export class ProcessorNotConfiguredError extends Error {
  readonly code = "PROCESSOR_NOT_CONFIGURED";

  constructor(queue: string, jobName: string) {
    super(`No Wave 0 processor is configured for queue "${queue}" and job "${jobName}"`);
    this.name = "ProcessorNotConfiguredError";
  }
}

export function defineProcessor<TData = unknown, TResult = unknown>(
  processor: JobProcessor<TData, TResult>,
): JobProcessor<TData, TResult> {
  if (!processor.name.trim()) {
    throw new Error("A job processor must have a non-empty name");
  }
  return processor;
}

export function createPlaceholderProcessor(queue: string): JobProcessor {
  return defineProcessor({
    name: queue,
    async handle(job) {
      throw new ProcessorNotConfiguredError(queue, job.name);
    },
  });
}
