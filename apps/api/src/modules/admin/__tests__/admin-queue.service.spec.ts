import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminQueueService, countBlockedConsumers } from "../admin-queue.service.js";

const QUEUE_PREFIX = "roamlog:";

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

interface CounterValues {
  waiting?: number;
  active?: number;
  failed?: number;
  completed?: number;
  delayed?: number;
  paused?: boolean;
}

describe("AdminQueueService", () => {
  function setup() {
    const client = {
      options: { keyPrefix: QUEUE_PREFIX },
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
      scan: vi.fn(),
    };

    // A registered `email` queue plus an unrelated API ingress key that must be
    // ignored by queue discovery.
    client.scan.mockResolvedValue([
      "0",
      [`${QUEUE_PREFIX}email:wait`, `${QUEUE_PREFIX}email:meta`, `${QUEUE_PREFIX}jobs:ingress`],
    ]);
    client.call.mockImplementation(async (command: string, ...args: unknown[]) => {
      if (command === "ZCOUNT") {
        return 3;
      }
      if (command === "ZRANGE") {
        const key = String(args[0]);
        return key.endsWith(":completed") ? ["job-9", "1763370300000"] : [];
      }
      if (command === "CLIENT") {
        return "";
      }
      return null;
    });

    const redis = { client };
    const service = new AdminQueueService(redis as never);
    return { client, service };
  }

  function respondCounters(client: ReturnType<typeof setup>["client"], values: CounterValues) {
    client.llen.mockImplementation(async (key: string) => {
      if (key.endsWith(":wait")) return values.waiting ?? 0;
      if (key.endsWith(":active")) return values.active ?? 0;
      return 0;
    });
    client.zcard.mockImplementation(async (key: string) => {
      if (key.endsWith(":failed")) return values.failed ?? 0;
      if (key.endsWith(":completed")) return values.completed ?? 0;
      if (key.endsWith(":delayed")) return values.delayed ?? 0;
      return 0;
    });
    client.hgetall.mockImplementation(async () => (values.paused ? { paused: "1" } : {}));
  }

  it("discovers registered queues from BullMQ Redis keys instead of a hardcoded list", async () => {
    const { client, service } = setup();
    respondCounters(client, { waiting: 1 });

    await expect(service.listQueues()).resolves.toEqual(["email"]);
    expect(client.scan).toHaveBeenCalledWith("0", "MATCH", "roamlog:*", "COUNT", 500);
  });

  it("reads queue counters from BullMQ keys and derives throughput from completion timestamps", async () => {
    const { client, service } = setup();
    respondCounters(client, { waiting: 4, active: 1, failed: 2, completed: 8, paused: true });

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
        throughputPerMinute: 0.6,
        throughputWindowSeconds: 300,
        lastCompletedAt: new Date(1_763_370_300_000).toISOString(),
        lastFailedAt: null,
      },
    ]);
    expect(client.llen).toHaveBeenCalledWith("email:wait");
    expect(client.llen).toHaveBeenCalledWith("email:active");
    expect(client.zcard).toHaveBeenCalledWith("email:failed");
    expect(client.zcard).toHaveBeenCalledWith("email:completed");
    expect(client.hgetall).toHaveBeenCalledWith("email:meta");
    expect(client.call).toHaveBeenCalledWith(
      "ZCOUNT",
      "email:completed",
      expect.any(String),
      "+inf",
    );
  });

  it("reports throughput as unavailable when Redis cannot answer the window", async () => {
    const { client, service } = setup();
    respondCounters(client, { completed: 8 });
    client.call.mockImplementation(async (command: string) => {
      if (command === "ZCOUNT") {
        throw new Error("ZCOUNT unsupported");
      }
      if (command === "ZRANGE") {
        throw new Error("ZRANGE unsupported");
      }
      return "";
    });

    const [stats] = await service.stats(["email"]);

    expect(stats?.throughputPerMinute).toBeNull();
    expect(stats?.throughputWindowSeconds).toBeNull();
    expect(stats?.lastCompletedAt).toBeNull();
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

  it("counts blocked BullMQ consumers from CLIENT LIST flags and command", async () => {
    const { client, service } = setup();
    respondCounters(client, { waiting: 2 });
    client.call.mockImplementation(async (command: string, ...args: unknown[]) => {
      if (command === "CLIENT") {
        return [
          "id=1 flags=b db=0 cmd=bzpopmin name=",
          "id=2 flags=b db=0 cmd=bzpopmin name=",
          "id=3 flags=N db=0 cmd=get name=roamlog-api",
        ].join("\n");
      }
      if (command === "ZCOUNT") {
        return 0;
      }
      if (command === "ZRANGE") {
        return String(args[0]).endsWith(":failed") ? ["job-7", "1763370400000"] : [];
      }
      return null;
    });

    const health = await service.workerHealth(["email"]);

    expect(health).toMatchObject({
      status: "up",
      signal: "consumer-clients",
      consumers: 2,
      blockedConsumers: 2,
      lastJobStatus: "failed",
      lastJobQueue: "email",
    });
  });

  it("reports down only when queued work has no consumer and no active job", async () => {
    const { client, service } = setup();
    respondCounters(client, { waiting: 5 });

    const health = await service.workerHealth(["email"]);

    expect(health).toMatchObject({
      status: "down",
      signal: "consumer-clients",
      consumers: 0,
    });
  });

  it("derives an activity signal when consumers are busy instead of blocked", async () => {
    const { client, service } = setup();
    respondCounters(client, { active: 2 });

    const health = await service.workerHealth(["email"]);

    expect(health).toMatchObject({ status: "up", signal: "activity-derived", consumers: 0 });
    expect(health.lastJobAt).toBe(new Date(1_763_370_300_000).toISOString());
  });

  it("reports an unavailable signal instead of fabricating DOWN when CLIENT LIST fails", async () => {
    const { client, service } = setup();
    respondCounters(client, {});
    client.call.mockRejectedValue(new Error("CLIENT LIST is not supported"));

    const health = await service.workerHealth(["email"]);

    expect(health).toMatchObject({
      status: "degraded",
      signal: "unavailable",
      consumers: 0,
      lastJobAt: null,
    });
  });

  it("parses only blocked BullMQ blocking commands as consumers", () => {
    const output = [
      "id=1 flags=b db=0 cmd=bzpopmin name=",
      "id=2 flags=b db=0 cmd=blmpop name=",
      "id=3 flags=b db=0 cmd=subscribe name=",
      "id=4 flags=N db=0 cmd=bzpopmin name=",
      "id=5 flags=b db=0 cmd=brpoplpush name=",
    ].join("\n");

    expect(countBlockedConsumers(output)).toBe(3);
  });

  it("rejects unknown queues before touching Redis", async () => {
    const { client, service } = setup();

    await expect(service.pauseQueue("unknown")).rejects.toBeInstanceOf(NotFoundException);
    expect(client.eval).not.toHaveBeenCalled();
  });
});