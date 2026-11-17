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
      options: { keyPrefix: "roamlog:" },
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
      del: vi.fn(),
      eval: vi.fn(),
      call: vi.fn(),
    };
    const redis = { client };
    const service = new AdminQueueService(redis as never);
    return { client, service };
  }

  it("reads queue counters from BullMQ-compatible Redis keys", async () => {
    const { client, service } = setup();
    client.llen.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    client.zcard.mockResolvedValueOnce(2).mockResolvedValueOnce(8);
    client.hgetall.mockResolvedValue({ paused: "1" });

    const stats = await service.stats(["email"]);

    expect(stats).toEqual([
      {
        name: "email",
        waiting: 4,
        active: 1,
        failed: 2,
        completed: 8,
        delayed: 0,
        paused: true,
      },
    ]);
    expect(client.llen).toHaveBeenCalledWith("email:wait");
    expect(client.llen).toHaveBeenCalledWith("email:active");
    expect(client.zcard).toHaveBeenCalledWith("email:failed");
    expect(client.zcard).toHaveBeenCalledWith("email:completed");
    expect(client.hgetall).toHaveBeenCalledWith("email:meta");
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

  it("pauses and resumes a queue with BullMQ-compatible keys", async () => {
    const { client, service } = setup();
    client.eval.mockResolvedValue(0);

    await service.pauseQueue("email");
    expect(client.eval).toHaveBeenCalledWith(
      expect.any(String),
      6,
      "email:meta",
      "email:paused",
      "email:wait",
      "email:prioritized",
      "email:marker",
      "email:delayed",
      "paused",
    );

    await service.resumeQueue("email");
    expect(client.eval).toHaveBeenLastCalledWith(
      expect.any(String),
      6,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "resumed",
    );
  });

  it("clears failed jobs and removes their BullMQ job hashes", async () => {
    const { client, service } = setup();
    client.zrange.mockResolvedValue(["job-1", "job-2"]);
    client.zrem.mockResolvedValue(1);
    client.del.mockResolvedValue(1);

    await expect(service.clearFailed("email")).resolves.toBe(2);

    expect(client.zrem).toHaveBeenCalledWith("email:failed", "job-1");
    expect(client.zrem).toHaveBeenCalledWith("email:failed", "job-2");
    expect(client.del).toHaveBeenCalledWith("email:job-1");
    expect(client.del).toHaveBeenCalledWith("email:job-2");
  });

  it("reports worker consumers from BullMQ client names", async () => {
    const { client, service } = setup();
    const names = ["media", "email"].map((queue) => Buffer.from(queue).toString("base64"));
    client.call.mockResolvedValue(
      [
        `id=1 name=roamlog:${names[0]}:w:`,
        `id=2 name=roamlog:${names[1]}:w:`,
        "id=3 name=roamlog-api",
      ].join("\n"),
    );

    await expect(service.workerHealth(["media", "email"])).resolves.toEqual({
      status: "up",
      consumers: 2,
    });
  });

  it("rejects unknown queues before touching Redis", async () => {
    const { client, service } = setup();

    await expect(service.pauseQueue("unknown")).rejects.toBeInstanceOf(NotFoundException);
    expect(client.eval).not.toHaveBeenCalled();
  });
});
