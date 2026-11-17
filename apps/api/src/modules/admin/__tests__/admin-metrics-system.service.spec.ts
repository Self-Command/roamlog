import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminMetricsService } from "../admin-metrics.service.js";
import { AdminSystemService } from "../admin-system.service.js";
import { NOW } from "../../../../test/identity-fixtures.js";

describe("AdminMetricsService", () => {
  function setup() {
    const prisma = {
      client: {
        user: { count: vi.fn(), groupBy: vi.fn() },
        workspace: { count: vi.fn() },
        trip: { count: vi.fn() },
        journalEntry: { count: vi.fn() },
        comment: { count: vi.fn() },
        media: { count: vi.fn(), aggregate: vi.fn() },
        export: { groupBy: vi.fn() },
      },
    };
    const queue = { stats: vi.fn() };
    const service = new AdminMetricsService(prisma as never, queue as never);
    return { prisma, queue, service };
  }

  it("aggregates database counts and queue counters", async () => {
    const { prisma, queue, service } = setup();
    prisma.client.user.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    prisma.client.workspace.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prisma.client.trip.count.mockResolvedValue(12);
    prisma.client.journalEntry.count.mockResolvedValue(33);
    prisma.client.comment.count.mockResolvedValue(9);
    prisma.client.media.count.mockResolvedValue(5);
    prisma.client.media.aggregate.mockResolvedValue({ _sum: { size: 4096 } });
    prisma.client.export.groupBy.mockResolvedValue([{ status: "ready", _count: { _all: 2 } }]);
    queue.stats.mockResolvedValue([
      {
        name: "email",
        waiting: 1,
        active: 0,
        failed: 2,
        completed: 10,
        delayed: 0,
        paused: false,
      },
    ]);

    const { metrics, degraded } = await service.get();

    expect(degraded).toEqual([]);
    expect(metrics.users).toEqual({ total: 10, active: 7, suspended: 2, new24h: 3 });
    expect(metrics.workspaces).toEqual({ total: 4, active: 3, suspended: 1, new24h: 1 });
    expect(metrics.media).toEqual({ count: 5, bytes: 4096 });
    expect(metrics.exports).toMatchObject({ ready: 2, queued: 0, failed: 0 });
    expect(metrics.queues[0]?.name).toBe("email");
  });

  it("fails explicitly when the database is unavailable", async () => {
    const { prisma, service } = setup();
    prisma.client.user.count.mockRejectedValue(new Error("database down"));

    await expect(service.get()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("marks queue metrics degraded without fabricating counters", async () => {
    const { prisma, queue, service } = setup();
    prisma.client.user.count.mockResolvedValue(0);
    prisma.client.workspace.count.mockResolvedValue(0);
    prisma.client.trip.count.mockResolvedValue(0);
    prisma.client.journalEntry.count.mockResolvedValue(0);
    prisma.client.comment.count.mockResolvedValue(0);
    prisma.client.media.count.mockResolvedValue(0);
    prisma.client.media.aggregate.mockResolvedValue({ _sum: { size: null } });
    prisma.client.export.groupBy.mockResolvedValue([]);
    queue.stats.mockRejectedValue(new Error("redis down"));

    const { metrics, degraded } = await service.get();

    expect(degraded).toEqual(["queues"]);
    expect(metrics.queues).toEqual([]);
  });
});

describe("AdminSystemService", () => {
  function setup() {
    const prisma = { healthCheck: vi.fn() };
    const redis = { ping: vi.fn() };
    const storage = { checkHealth: vi.fn() };
    const queue = { stats: vi.fn(), workerHealth: vi.fn() };
    prisma.healthCheck = vi.fn();
    const prismaWithRaw = {
      ...prisma,
      client: { $queryRaw: vi.fn() },
    };
    const service = new AdminSystemService(
      prismaWithRaw as never,
      redis as never,
      storage as never,
      queue as never,
    );
    return { prisma: prismaWithRaw, redis, storage, queue, service };
  }

  it("reports build, migration, worker, dependency, and queue state", async () => {
    const { prisma, redis, storage, queue, service } = setup();
    prisma.healthCheck.mockResolvedValue(undefined);
    prisma.client.$queryRaw.mockResolvedValue([
      { migration_name: "0002_two_factor_state", finished_at: NOW },
    ]);
    redis.ping.mockResolvedValue(undefined);
    storage.checkHealth.mockResolvedValue(undefined);
    queue.workerHealth.mockResolvedValue({ status: "up", consumers: 5 });
    queue.stats.mockResolvedValue([
      {
        name: "email",
        waiting: 1,
        active: 0,
        failed: 2,
        completed: 10,
        delayed: 0,
        paused: true,
      },
    ]);

    const system = await service.get();

    expect(system.checks.database.status).toBe("up");
    expect(system.checks.redis.status).toBe("up");
    expect(system.checks.storage.status).toBe("up");
    expect(system.migration).toEqual({
      version: "0002_two_factor_state",
      appliedAt: NOW.toISOString(),
    });
    expect(system.worker.status).toBe("up");
    expect(system.worker.consumers).toBe(5);
    expect(system.buildTime).toBe(system.startedAt);
    expect(system.queues[0]?.name).toBe("email");
    expect(system.queues[0]?.paused).toBe(true);
  });

  it("reports down checks without throwing", async () => {
    const { prisma, redis, storage, queue, service } = setup();
    prisma.healthCheck.mockRejectedValue(new Error("down"));
    prisma.client.$queryRaw.mockRejectedValue(new Error("down"));
    redis.ping.mockRejectedValue(new Error("down"));
    storage.checkHealth.mockRejectedValue(new Error("down"));
    queue.workerHealth.mockRejectedValue(new Error("down"));
    queue.stats.mockRejectedValue(new Error("down"));

    const system = await service.get();

    expect(system.checks.database.status).toBe("down");
    expect(system.checks.redis.status).toBe("down");
    expect(system.checks.storage.status).toBe("down");
    expect(system.migration).toEqual({ version: null, appliedAt: null });
    expect(system.worker.status).toBe("down");
    expect(system.queues).toEqual([]);
  });
});
