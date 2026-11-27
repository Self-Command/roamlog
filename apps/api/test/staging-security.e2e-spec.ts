import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createTestApp } from "./test-app.js";
import { WORKSPACE_A_ID } from "./identity-fixtures.js";

const ALLOWED_ORIGIN = "http://localhost:3000";

async function withApp(run: (app: INestApplication) => Promise<void>): Promise<void> {
  const { app } = await createTestApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

describe("staging security regressions", () => {
  it("marks API responses as non-cacheable for browser clients", async () => {
    await withApp(async (app) => {
      const health = await request(app.getHttpServer()).get("/v1/health");
      expect(health.status).toBe(200);
      expect(health.headers["cache-control"]).toBe("no-store");

      const unauthorized = await request(app.getHttpServer()).get("/v1/me");
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers["cache-control"]).toBe("no-store");
    });
  });

  it("does not rate limit normal Better Auth session reads", async () => {
    await withApp(async (app) => {
      const statuses: number[] = [];
      for (let index = 0; index < 15; index += 1) {
        const response = await request(app.getHttpServer())
          .get("/v1/auth/get-session")
          .set("Origin", ALLOWED_ORIGIN);
        statuses.push(response.status);
      }
      expect(statuses).not.toContain(429);
    });
  });

  it("rate limits sensitive auth mutations and returns Retry-After", async () => {
    await withApp(async (app) => {
      const responses = [];
      for (let index = 0; index < 11; index += 1) {
        responses.push(
          await request(app.getHttpServer())
            .post("/v1/auth/sign-in/email")
            .set("Origin", ALLOWED_ORIGIN)
            .send({
              email: `auth-limit-${index}@roamlog.test`,
              password: "Definitely-Wrong-Aa1!",
            }),
        );
      }

      expect(responses.slice(0, 10).map((response) => response.status)).not.toContain(429);
      const limited = responses[10];
      expect(limited?.status).toBe(429);
      expect(limited?.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
      expect(limited?.headers["x-ratelimit-degraded"]).toBe("true");
      expect(limited?.body).toMatchObject({ code: "RATE_LIMITED", status: 429 });
    });
  });

  it("rate limits public share reads at 60/min/IP", async () => {
    await withApp(async (app) => {
      const token = "a".repeat(43);
      for (let index = 0; index < 60; index += 1) {
        const response = await request(app.getHttpServer()).get(`/v1/public/trips/${token}`);
        expect(response.status).not.toBe(429);
      }

      const limited = await request(app.getHttpServer()).get(`/v1/public/trips/${token}`);
      expect(limited.status).toBe(429);
      expect(limited.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
      expect(limited.headers["x-ratelimit-degraded"]).toBe("true");
      expect(limited.body).toMatchObject({ code: "RATE_LIMITED", status: 429 });
    });
  });

  it("rate limits public share password attempts at 20/min/IP", async () => {
    await withApp(async (app) => {
      const token = "b".repeat(43);
      for (let index = 0; index < 20; index += 1) {
        const response = await request(app.getHttpServer()).get(
          `/v1/public/trips/${token}?password=wrong-${index}`,
        );
        expect(response.status).not.toBe(429);
      }

      const limited = await request(app.getHttpServer()).get(
        `/v1/public/trips/${token}?password=wrong-final`,
      );
      expect(limited.status).toBe(429);
      expect(limited.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
      expect(limited.headers["x-ratelimit-degraded"]).toBe("true");
    });
  });

  it("rate limits media presign requests at 20/min/IP", async () => {
    await withApp(async (app) => {
      for (let index = 0; index < 20; index += 1) {
        const response = await request(app.getHttpServer())
          .post(`/v1/workspaces/${WORKSPACE_A_ID}/media/presign`)
          .send({
            fileName: `upload-${index}.png`,
            mimeType: "image/png",
            size: 1_024,
          });
        expect(response.status).not.toBe(429);
      }

      const limited = await request(app.getHttpServer())
        .post(`/v1/workspaces/${WORKSPACE_A_ID}/media/presign`)
        .send({
          fileName: "upload-final.png",
          mimeType: "image/png",
          size: 1_024,
        });
      expect(limited.status).toBe(429);
      expect(limited.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
      expect(limited.headers["x-ratelimit-degraded"]).toBe("true");
    });
  });

  it("rejects disallowed Origin and Referer on custom and auth writes", async () => {
    await withApp(async (app) => {
      for (const headers of [
        { Origin: "https://evil.example" },
        { Referer: "https://evil.example/somewhere" },
      ]) {
        const response = await request(app.getHttpServer())
          .post("/v1/workspaces")
          .set(headers)
          .send({});
        expect(response.status).toBe(403);
        expect(response.headers["content-type"]).toContain("application/problem+json");
        expect(response.body).toMatchObject({ code: "CSRF_ORIGIN_REJECTED", status: 403 });
      }

      const authResponse = await request(app.getHttpServer())
        .post("/v1/auth/sign-in/email")
        .set("Origin", "https://evil.example")
        .send({ email: "evil@roamlog.test", password: "Definitely-Wrong-Aa1!" });
      expect(authResponse.status).toBe(403);
      expect(authResponse.body.code).toBe("CSRF_ORIGIN_REJECTED");
    });
  });

  it("allows non-browser writes without Origin and configured browser origins", async () => {
    await withApp(async (app) => {
      const nonBrowser = await request(app.getHttpServer()).post("/v1/workspaces").send({});
      expect(nonBrowser.status).toBe(401);
      expect(nonBrowser.body.code).toBe("UNAUTHENTICATED");

      const browser = await request(app.getHttpServer())
        .post("/v1/workspaces")
        .set("Origin", ALLOWED_ORIGIN)
        .send({});
      expect(browser.status).toBe(401);
      expect(browser.body.code).toBe("UNAUTHENTICATED");

      const safeRead = await request(app.getHttpServer())
        .get("/v1/me")
        .set("Origin", "https://evil.example");
      expect(safeRead.status).toBe(401);
      expect(safeRead.body.code).toBe("UNAUTHENTICATED");
    });
  });
});
