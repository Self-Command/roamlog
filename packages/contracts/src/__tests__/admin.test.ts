import { describe, expect, it } from "vitest";

import {
  AdminAuditExportQuerySchema,
  AdminSystemSchema,
  ClearAdminQueueResponseSchema,
  PauseAdminQueueResponseSchema,
  ResumeAdminQueueResponseSchema,
} from "../api/admin";

describe("Admin operations contracts", () => {
  it("parses queue lifecycle responses and audit export filters", () => {
    expect(PauseAdminQueueResponseSchema.parse({ queue: "email", paused: true })).toEqual({
      queue: "email",
      paused: true,
    });
    expect(ResumeAdminQueueResponseSchema.parse({ queue: "email", paused: false })).toEqual({
      queue: "email",
      paused: false,
    });
    expect(
      ClearAdminQueueResponseSchema.parse({
        queue: "email",
        cleared: true,
        removedJobs: 3,
      }),
    ).toEqual({ queue: "email", cleared: true, removedJobs: 3 });

    expect(
      AdminAuditExportQuerySchema.parse({
        actorType: "admin",
        targetType: "user",
        ip: "127.0.0.1",
        q: "suspend",
        from: "2026-11-01",
        to: "2026-11-17",
        sort: "createdAt:desc",
      }),
    ).toMatchObject({
      actorType: "admin",
      targetType: "user",
      q: "suspend",
    });
  });

  it("parses a healthy system snapshot with observed worker signals", () => {
    const system = AdminSystemSchema.parse({
      version: "1.0.0",
      environment: "test",
      nodeVersion: "v24.0.0",
      buildTime: "2026-11-17T08:00:00.000Z",
      startedAt: "2026-11-17T08:01:00.000Z",
      uptimeSeconds: 120,
      migration: {
        version: "0002_two_factor_state",
        appliedAt: "2026-11-17T08:00:30.000Z",
      },
      worker: {
        status: "up",
        version: "1.0.0",
        consumers: 2,
        signal: "consumer-clients",
        blockedConsumers: 2,
        lastJobAt: "2026-11-17T08:01:45.000Z",
        lastJobStatus: "completed",
        lastJobQueue: "email",
      },
      checks: {
        database: { status: "up", latencyMs: 2 },
        redis: { status: "up", latencyMs: 1 },
        storage: { status: "down", latencyMs: null },
      },
      queues: [
        {
          name: "email",
          waiting: 1,
          active: 0,
          failed: 2,
          delayed: 0,
          paused: false,
        },
      ],
    });

    expect(system.buildTime).toBe("2026-11-17T08:00:00.000Z");
    expect(system.migration).toEqual({
      version: "0002_two_factor_state",
      appliedAt: "2026-11-17T08:00:30.000Z",
    });
    expect(system.worker.status).toBe("up");
    expect(system.worker.signal).toBe("consumer-clients");
    expect(system.worker.consumers).toBe(2);
    expect(system.worker.blockedConsumers).toBe(2);
    expect(system.worker.lastJobAt).toBe("2026-11-17T08:01:45.000Z");
    expect(system.worker.lastJobStatus).toBe("completed");
    expect(system.worker.lastJobQueue).toBe("email");
    expect(system.checks.storage.status).toBe("down");
    expect(system.checks.storage.latencyMs).toBeNull();
    expect(system.queues[0]?.paused).toBe(false);
  });

  it("parses an unavailable worker signal without fabricating build or job metadata", () => {
    const system = AdminSystemSchema.parse({
      version: "unconfigured",
      environment: "production",
      nodeVersion: "v24.0.0",
      // Deployment injects no build timestamp: it must stay null, never the
      // container start time.
      buildTime: null,
      startedAt: "2026-11-17T09:00:00.000Z",
      uptimeSeconds: 0,
      migration: {
        version: null,
        appliedAt: null,
      },
      worker: {
        status: "degraded",
        version: "unconfigured",
        consumers: 0,
        // Neither `CLIENT LIST` nor queue activity yielded a signal.
        signal: "unavailable",
        blockedConsumers: 0,
        lastJobAt: null,
        lastJobStatus: null,
        lastJobQueue: null,
      },
      checks: {
        database: { status: "up", latencyMs: 4 },
        redis: { status: "down", latencyMs: null },
        storage: { status: "up", latencyMs: 3 },
      },
      queues: [],
    });

    expect(system.buildTime).toBeNull();
    expect(system.migration).toEqual({ version: null, appliedAt: null });
    expect(system.worker.status).toBe("degraded");
    expect(system.worker.signal).toBe("unavailable");
    expect(system.worker.consumers).toBe(0);
    expect(system.worker.blockedConsumers).toBe(0);
    expect(system.worker.lastJobAt).toBeNull();
    expect(system.worker.lastJobStatus).toBeNull();
    expect(system.worker.lastJobQueue).toBeNull();
    expect(system.checks.redis).toEqual({ status: "down", latencyMs: null });
    expect(system.queues).toEqual([]);
  });

  it("keeps worker status and worker signal as separate enums", () => {
    // `up` is a valid worker *status* but never a valid *signal*: collapsing
    // the two would make a non-observed worker look confirmed healthy.
    const worker = {
      status: "up",
      version: "1.0.0",
      consumers: 1,
      signal: "up",
      blockedConsumers: 0,
      lastJobAt: null,
      lastJobStatus: null,
      lastJobQueue: null,
    };

    expect(
      AdminSystemSchema.safeParse({
        version: "1.0.0",
        environment: "test",
        nodeVersion: "v24.0.0",
        buildTime: null,
        startedAt: "2026-11-17T08:01:00.000Z",
        uptimeSeconds: 1,
        migration: { version: null, appliedAt: null },
        worker,
        checks: {
          database: { status: "up", latencyMs: 1 },
          redis: { status: "up", latencyMs: 1 },
          storage: { status: "up", latencyMs: 1 },
        },
        queues: [],
      }).success,
    ).toBe(false);
  });
});
