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

  it("includes migration, build, worker, and dependency health metadata", () => {
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
        consumers: 5,
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

    expect(system.migration.version).toBe("0002_two_factor_state");
    expect(system.worker.consumers).toBe(5);
    expect(system.checks.storage.status).toBe("down");
    expect(system.queues[0]?.paused).toBe(false);
  });
});
