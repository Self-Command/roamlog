import { describe, expect, it, vi } from "vitest";

import { AI_RESUME_PRODUCER_ATTEMPTS, AiRunStore } from "../ai-run.store.js";

function stream(): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      controller.close();
    },
  });
}

function harness() {
  const context = {
    createNewResumableStream: vi.fn(),
    resumeExistingStream: vi.fn(),
    hasExistingStream: vi.fn(),
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  };
  const store = new AiRunStore({} as never, logger as never);
  (store as unknown as { resumable: () => typeof context }).resumable = () => context;
  return { context, logger, store };
}

describe("AiRunStore resumable producer", () => {
  it("returns the first successful producer without retrying", async () => {
    const { context, logger, store } = harness();
    const readable = stream();
    context.createNewResumableStream.mockResolvedValue(readable);

    await expect(store.createResumableStream("stream-1", () => stream())).resolves.toBe(readable);
    expect(context.createNewResumableStream).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("retries a transient producer creation failure and logs recovery", async () => {
    const { context, logger, store } = harness();
    const readable = stream();
    context.createNewResumableStream
      .mockRejectedValueOnce(new Error("redis command failed"))
      .mockResolvedValueOnce(readable);

    await expect(store.createResumableStream("stream-2", () => stream())).resolves.toBe(readable);
    expect(context.createNewResumableStream).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.resume_producer_recovered",
        streamId: "stream-2",
        attempt: 2,
      }),
      "ai.resume_producer_recovered",
    );
  });

  it("fails closed after the bounded retry budget is exhausted", async () => {
    const { context, logger, store } = harness();
    context.createNewResumableStream.mockRejectedValue(new Error("redis unavailable"));

    await expect(store.createResumableStream("stream-3", () => stream())).rejects.toThrow(
      "redis unavailable",
    );
    expect(context.createNewResumableStream).toHaveBeenCalledTimes(AI_RESUME_PRODUCER_ATTEMPTS);
    expect(logger.warn).toHaveBeenCalledTimes(AI_RESUME_PRODUCER_ATTEMPTS);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.resume_producer_unavailable",
        streamId: "stream-3",
        attempts: AI_RESUME_PRODUCER_ATTEMPTS,
      }),
      "ai.resume_producer_unavailable",
    );
  });

  it("does not retry an already-finished stream", async () => {
    const { context, store } = harness();
    context.createNewResumableStream.mockResolvedValue(null);

    await expect(store.createResumableStream("stream-4", () => stream())).resolves.toBeNull();
    expect(context.createNewResumableStream).toHaveBeenCalledTimes(1);
  });

  it("reports a Redis status lookup failure as not resumable", async () => {
    const { context, store } = harness();
    context.hasExistingStream.mockRejectedValue(new Error("redis unavailable"));

    await expect(store.hasResumableStream("stream-5")).resolves.toBe(false);
  });
});
