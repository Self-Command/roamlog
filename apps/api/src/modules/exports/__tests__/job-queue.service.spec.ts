import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { RedisService } from "../../redis/redis.service.js";
import { JobQueueService, QUEUE_UNAVAILABLE_CODE } from "../job-queue.service.js";

/**
 * Queue ingress is **fail-closed**: a Redis outage must never look like a
 * successful enqueue, and must not be reported as a 500 server bug either.
 */
describe("JobQueueService with an unavailable Redis", () => {
  function queueWith(rpush: ReturnType<typeof vi.fn>): JobQueueService {
    return new JobQueueService({
      client: { rpush },
    } as unknown as RedisService);
  }

  const request = {
    queue: "export" as const,
    name: "export.generate",
    jobId: "export-abc123",
    data: { exportId: "e1", workspaceId: "w1" },
  };

  it("answers 503 QUEUE_UNAVAILABLE and never fabricates a queued job", async () => {
    const rpush = vi
      .fn()
      .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:6379"));
    const queue = queueWith(rpush);

    const error = await queue.enqueue(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const exception = error as ServiceUnavailableException;
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toMatchObject({
      code: QUEUE_UNAVAILABLE_CODE,
      dependencies: ["redis"],
    });
    // The Redis error text (host/port) must not reach the client.
    expect(JSON.stringify(exception.getResponse())).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(exception.getResponse())).not.toContain("6379");
  });

  it("still enqueues when Redis accepts the command", async () => {
    const rpush = vi.fn().mockResolvedValue(1);
    const queue = queueWith(rpush);

    await expect(queue.enqueue(request)).resolves.toEqual({
      jobId: request.jobId,
      queue: "export",
      name: "export.generate",
    });
    expect(rpush).toHaveBeenCalledOnce();
  });
});