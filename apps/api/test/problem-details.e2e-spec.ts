import type { INestApplication } from "@nestjs/common";
import { ProblemDetailsSchema } from "@roamlog/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp } from "./test-app.js";

describe("Problem Details", () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns RFC 7807 JSON for an unknown route", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/does-not-exist")
      .set("x-request-id", "test-request-123")
      .expect(404)
      .expect("content-type", /application\/problem\+json/);

    const body = ProblemDetailsSchema.parse(response.body);
    expect(body).toMatchObject({
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
      instance: "/v1/does-not-exist",
      errors: [],
    });
    expect(response.headers["x-request-id"]).toBe("test-request-123");
    expect(response.body).not.toHaveProperty("stack");
  });

  it("replaces unsafe request ids and still echoes a generated id", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/does-not-exist")
      .set("x-request-id", "x".repeat(129))
      .expect(404);

    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
