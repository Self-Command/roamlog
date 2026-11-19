import { ReadyResponseSchema } from "@roamlog/contracts";
import { describe, expect, it, vi } from "vitest";

import type { Response } from "express";

import type { MetricsService } from "../observability/metrics.service.js";
import type { PinoLoggerService } from "../observability/pino-logger.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { StorageService } from "../storage/storage.service.js";
import { HealthController } from "../health/health.controller.js";
import { ReadinessService } from "../health/readiness.service.js";
import type { RedisService } from "./redis.service.js";

/**
 * Readiness semantics (agreed with the product owner):
 *
 * - every dependency up                        → `ok`          + HTTP 200
 * - only Redis down (db/storage healthy)       → `degraded`    + HTTP 200
 * - database or object storage down            → `unavailable` + HTTP 503
 *
 * Redis is a cache / rate-limit / quota dependency: losing it degrades the
 * service but must not pull the instance out of the load balancer, otherwise a
 * single Redis outage takes the whole API down. That is the exact production
 * failure this task fixes.
 */
interface FakeResponse {
  statusCode: number;
  status(code: number): FakeResponse;
}

function response(): FakeResponse {
  const fake: FakeResponse = {
    statusCode: 0,
    status(code: number) {
      fake.statusCode = code;
      return fake;
    },
  };
  return fake;
}

function logger(): PinoLoggerService {
  return { warn: vi.fn() } as unknown as PinoLoggerService;
}

function metrics(): MetricsService {
  return { setDependencyHealth: vi.fn() } as unknown as MetricsService;
}

function service(options: { redis: "up" | "down"; database?: "up" | "down"; storage?: "up" | "down" }) {
  return new ReadinessService(
    {
      healthCheck:
        options.database === "down"
          ? vi.fn().mockRejectedValue(new Error("postgres down"))
          : vi.fn().mockResolvedValue(undefined),
    } as unknown as PrismaService,
    {
      ping:
        options.redis === "down"
          ? vi.fn().mockRejectedValue(new Error("Redis connection is closed"))
          : vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService,
    {
      checkHealth:
        options.storage === "down"
          ? vi.fn().mockRejectedValue(new Error("S3 down"))
          : vi.fn().mockResolvedValue(undefined),
    } as unknown as StorageService,
    metrics(),
    logger(),
  );
}

describe("/v1/ready semantics when Redis is unavailable", () => {
  it("reports degraded, not unavailable, and keeps HTTP 200", async () => {
    const readiness = service({ redis: "down" });
    const controller = new HealthController(readiness);
    const res = response();

    const body = await controller.ready(res as unknown as Response);

    expect(body.status).toBe("degraded");
    expect(body.checks.redis.status).toBe("down");
    expect(body.checks.database.status).toBe("up");
    expect(body.checks.storage.status).toBe("up");
    expect(res.statusCode).toBe(200);
    // The response must satisfy the published contract.
    expect(ReadyResponseSchema.safeParse(body).success).toBe(true);
  });

  it("reports ok when every dependency answers", async () => {
    const readiness = service({ redis: "up" });
    const controller = new HealthController(readiness);
    const res = response();

    const body = await controller.ready(res as unknown as Response);

    expect(body.status).toBe("ok");
    expect(res.statusCode).toBe(200);
    expect(ReadyResponseSchema.safeParse(body).success).toBe(true);
  });

  it("stays unavailable with HTTP 503 when the database is down", async () => {
    const readiness = service({ redis: "up", database: "down" });
    const controller = new HealthController(readiness);
    const res = response();

    const body = await controller.ready(res as unknown as Response);

    expect(body.status).toBe("unavailable");
    expect(res.statusCode).toBe(503);
    expect(ReadyResponseSchema.safeParse(body).success).toBe(true);
  });

  it("stays unavailable with HTTP 503 when object storage is down", async () => {
    const readiness = service({ redis: "up", storage: "down" });
    const controller = new HealthController(readiness);
    const res = response();

    const body = await controller.ready(res as unknown as Response);

    expect(body.status).toBe("unavailable");
    expect(res.statusCode).toBe(503);
  });
});