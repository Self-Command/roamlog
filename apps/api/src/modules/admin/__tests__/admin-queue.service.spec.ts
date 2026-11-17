import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminQueueService } from "../admin-queue.service.js";

function jobHash(overrides: Record<string, string> = {}) {
  return {
    name: "send-email",
    data: JSON.stringify({ emailId: "e1" }),
    timestamp: "1763370000000",
    attemptsMade: "2",
    failedReason: "boom",
    ...overrides,
  };
}

describe("AdminQueueService", () => {
  function setup() {
    const client = {
      llen: vi.fn(),
      zcard: vi.fn(),
      lrange: vi.fn(),
      zrange: vi.fn(),
      hgetall: vi.fn(),
      zscore: vi.fn(),
      exists: vi.fn(),
      zrem: vi.fn(),
      lpush: vi.fn(),
      hset: vi.fn(),
    };
    const redis = { client };
    const service = new AdminQueueService(redis as never);
    return { client, service };
  }

  it("reads queue counters from BullMQ-compatible Redis keys", async () => {
    const { client, service } = setup();
    client.llen.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    client.zcard.mockResolvedValueOnce(2).mockResolvedValueOnce(8);

    const stats = await service.stats(["email"]);

    expect(stats).toEqual([
      { name: "email", waiting: 4, active: 1, failed: 2, completed: 8, delayed: 0 },
    ]);
    expect(client.llen).toHaveBeenCalledWith("email:wait");
    expect(client.llen).toHaveBeenCalledWith("email:active");
    expect(client.zcard).toHaveBeenCalledWith("email:failed");
    expect(client.zcard).toHaveBeenCalledWith("email:completed");
  });

  it("lists failed jobs with contract-shaped fields", async () => {
    const { client, service } = setup();
    client.zrange.mockResolvedValue(["job-1"]);
    client.hgetall.mockResolvedValue(jobHash());

    const page = await service.listJobs({ queue: "email", status: "failed", limit: 20 });

    expect(page.items[0]).toMatchObject({
      id: "job-1",
      queue: "email",
      name: "send-email",
      status: "failed",
      attempts: 2,
      failedReason: "boom",
    });
  });

  it("retries only failed jobs", async () => {
    const { client, service } = setup();
    client.exists.mockResolvedValue(1);
    client.zscore.mockResolvedValue("1");
    client.zrem.mockResolvedValue(1);
    client.lpush.mockResolvedValue(1);
    client.hset.mockResolvedValue(1);

    const result = await service.retryJob("email", "job-1");

    expect(result).toEqual({ queue: "email", jobId: "job-1", queued: true });
    expect(client.zrem).toHaveBeenCalledWith("email:failed", "job-1");
    expect(client.lpush).toHaveBeenCalledWith("email:wait", "job-1");
  });

  it("returns 404 when the job is missing", async () => {
    const { client, service } = setup();
    client.exists.mockResolvedValue(0);

    await expect(service.retryJob("email", "missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns 409 when the job is not in the failed state", async () => {
    const { client, service } = setup();
    client.exists.mockResolvedValue(1);
    client.zscore.mockResolvedValue(null);

    await expect(service.retryJob("email", "done")).rejects.toBeInstanceOf(ConflictException);
  });
});
