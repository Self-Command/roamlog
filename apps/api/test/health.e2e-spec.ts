import type { INestApplication } from "@nestjs/common";
import { HealthResponseSchema } from "@roamlog/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestDependencyMocks } from "./test-app.js";

describe("health and readiness", () => {
  let app: INestApplication;
  let mocks: TestDependencyMocks;

  beforeAll(async () => {
    ({ app, mocks } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns liveness without touching dependencies", async () => {
    const response = await request(app.getHttpServer()).get("/v1/health").expect(200);

    // The contract validates the implementation, not the other way round:
    // `HealthResponseSchema` is `.strict()` and requires version/uptimeSeconds.
    const parsed = HealthResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new Error(
        `/v1/health does not match HealthResponseSchema: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    expect(parsed.data).toEqual(response.body);
    expect(response.body).toMatchObject({ status: "ok" });
    expect(response.body.version).toBeTypeOf("string");
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);

    expect(mocks.prisma.healthCheck).not.toHaveBeenCalled();
    expect(mocks.redis.ping).not.toHaveBeenCalled();
    expect(mocks.storage.checkHealth).not.toHaveBeenCalled();
  });

  it("checks database, redis, and storage for readiness", async () => {
    const response = await request(app.getHttpServer()).get("/v1/ready").expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      checks: {
        database: { status: "up" },
        redis: { status: "up" },
        storage: { status: "up" },
      },
    });
    expect(mocks.prisma.healthCheck).toHaveBeenCalledOnce();
    expect(mocks.redis.ping).toHaveBeenCalledOnce();
    expect(mocks.storage.checkHealth).toHaveBeenCalledOnce();
  });

  it("returns 503 when a dependency is unavailable", async () => {
    mocks.storage.checkHealth.mockRejectedValueOnce(new Error("S3 unavailable"));

    const response = await request(app.getHttpServer()).get("/v1/ready").expect(503);

    expect(response.body).toMatchObject({
      status: "unavailable",
      checks: {
        database: { status: "up" },
        redis: { status: "up" },
        storage: { status: "down" },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("S3 unavailable");
  });

  it("reports degraded, not unavailable, and stays 200 when only Redis is down", async () => {
    // Redis is a cache/rate-limit/quota backend: the API keeps serving, so the
    // instance must not be pulled out of the load balancer (R1_REDIS_RESILIENCE).
    mocks.redis.ping.mockRejectedValueOnce(new Error("Redis connection is closed"));

    const response = await request(app.getHttpServer()).get("/v1/ready").expect(200);

    expect(response.body).toMatchObject({
      status: "degraded",
      checks: {
        database: { status: "up" },
        redis: { status: "down" },
        storage: { status: "up" },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("Redis connection is closed");
    // The process is still alive and serving liveness.
    await request(app.getHttpServer()).get("/v1/health").expect(200);
  });

  it("exposes process and HTTP metrics without accepting them as routes", async () => {
    await request(app.getHttpServer()).get("/v1/health").expect(200);
    const response = await request(app.getHttpServer()).get("/v1/metrics").expect(200);

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("process_cpu_seconds_total");
    expect(response.text).toContain("roamlog_http_requests_total");
  });

  it("sets security headers and only allows configured browser origins", async () => {
    const allowed = await request(app.getHttpServer())
      .get("/v1/health")
      .set("Origin", "http://localhost:3000")
      .expect(200);

    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
    expect(allowed.headers["x-frame-options"]).toBe("DENY");

    const denied = await request(app.getHttpServer())
      .get("/v1/health")
      .set("Origin", "https://evil.example")
      .expect(200);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
