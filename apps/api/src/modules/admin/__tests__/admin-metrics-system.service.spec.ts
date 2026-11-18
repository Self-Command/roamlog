import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminMetricsService } from "../admin-metrics.service.js";
import { AdminSystemService } from "../admin-system.service.js";
import { NOW } from "../../../../test/identity-fixtures.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
        emailLog: { groupBy: vi.fn() },
      },
    };
    const queue = { stats: vi.fn() };
    const service = new AdminMetricsService(prisma as never, queue as never);
    return { prisma, queue, service };
  }

  function mockDatabase(prisma: ReturnType<typeof setup>["prisma"]) {
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
    prisma.client.emailLog.groupBy.mockResolvedValue([
      { status: "sent", _count: { _all: 3 } },
      { status: "failed", _count: { _all: 1 } },
    ]);
  }

  it("aggregates database counts, per-status email totals, and real queue counters", async () => {
    const { prisma, queue, service } = setup();
    mockDatabase(prisma);
    queue.stats.mockResolvedValue([
      {
        name: "email",
        waiting: 1,
        active: 0,
        failed: 2,
        completed: 10,
        delayed: 0,
        paused: false,
        throughputPerMinute: 0.6,
        throughputWindowSeconds: 300,
        lastCompletedAt: NOW.toISOString(),
        lastFailedAt: null,
      },
    ]);

    const { metrics, degraded } = await service.get();

    expect(degraded).toEqual([]);
    expect(metrics.users).toEqual({ total: 10, active: 7, suspended: 2, new24h: 3 });
    expect(metrics.workspaces).toEqual({ total: 4, active: 3, suspended: 1, new24h: 1 });
    expect(metrics.media).toEqual({ count: 5, bytes: 4096 });
    expect(metrics.exports).toMatchObject({ ready: 2, queued: 0, failed: 0 });
    expect(metrics.emails).toEqual({
      queued: 0,
      sent: 3,
      delivered: 0,
      bounced: 0,
      complained: 0,
      failed: 1,
    });
    expect(metrics.queues[0]).toMatchObject({
      name: "email",
      throughputPerMinute: 0.6,
      throughputWindowSeconds: 300,
    });
  });

  it("fails explicitly when the database is unavailable", async () => {
    const { prisma, service } = setup();
    prisma.client.user.count.mockRejectedValue(new Error("database down"));

    await expect(service.get()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("marks queue metrics degraded without fabricating counters", async () => {
    const { prisma, queue, service } = setup();
    mockDatabase(prisma);
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

  it("reports version, build, migration, observed worker, dependency, and queue state", async () => {
    const { prisma, redis, storage, queue, service } = setup();
    vi.stubEnv("ROAMLOG_API_VERSION", "1.0.0-rc.1");
    vi.stubEnv("ROAMLOG_BUILD_TIME", NOW.toISOString());
    prisma.healthCheck.mockResolvedValue(undefined);
    prisma.client.$queryRaw.mockResolvedValue([
      { migration_name: "0002_two_factor_state", finished_at: NOW },
    ]);
    redis.ping.mockResolvedValue(undefined);
    storage.checkHealth.mockResolvedValue(undefined);
    queue.workerHealth.mockResolvedValue({
      status: "up",
      consumers: 2,
      signal: "consumer-clients",
      blockedConsumers: 2,
      lastJobAt: NOW.toISOString(),
      lastJobStatus: "completed",
      lastJobQueue: "email",
    });
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

    expect(system.version).toBe("1.0.0-rc.1");
    expect(system.checks.database.status).toBe("up");
    expect(system.checks.redis.status).toBe("up");
    expect(system.checks.storage.status).toBe("up");
    expect(system.migration).toEqual({
      version: "0002_two_factor_state",
      appliedAt: NOW.toISOString(),
    });
    expect(system.worker).toMatchObject({
      status: "up",
      consumers: 2,
      signal: "consumer-clients",
      blockedConsumers: 2,
      lastJobStatus: "completed",
      lastJobQueue: "email",
    });
    expect(system.buildTime).toBe(NOW.toISOString());
    expect(system.queues[0]?.name).toBe("email");
    expect(system.queues[0]?.paused).toBe(true);
  });

  it("does not substitute a fake version or build time when none is injected", async () => {
    const { prisma, redis, storage, queue, service } = setup();
    vi.stubEnv("ROAMLOG_API_VERSION", "");
    vi.stubEnv("ROAMLOG_BUILD_TIME", "");
    prisma.healthCheck.mockResolvedValue(undefined);
    prisma.client.$queryRaw.mockResolvedValue([]);
    redis.ping.mockResolvedValue(undefined);
    storage.checkHealth.mockResolvedValue(undefined);
    queue.workerHealth.mockResolvedValue({
      status: "degraded",
      consumers: 0,
      signal: "unavailable",
      blockedConsumers: 0,
      lastJobAt: null,
      lastJobStatus: null,
      lastJobQueue: null,
    });
    queue.stats.mockResolvedValue([]);

    const system = await service.get();

    expect(system.version).toBe("unconfigured");
    expect(system.buildTime).toBeNull();
    expect(system.worker.signal).toBe("unavailable");
  });

  it("degrades checks and worker without throwing, and never claims DOWN without evidence", async () => {
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
    expect(system.worker.status).toBe("degraded");
    expect(system.worker.signal).toBe("unavailable");
    expect(system.queues).toEqual([]);
  });
});