import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp } from "./test-app.js";
import { WORKSPACE_A_ID } from "./identity-fixtures.js";

describe("identity route wiring", () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it("mounts the Better Auth catch-all under /v1/auth", async () => {
    const response = await request(app.getHttpServer()).get("/v1/auth/get-session");
    expect(response.status).not.toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
  });

  it.each([
    ["get", "/v1/me"],
    ["post", "/v1/workspaces"],
    ["get", `/v1/workspaces/${WORKSPACE_A_ID}/members`],
    ["get", `/v1/workspaces/${WORKSPACE_A_ID}/audit`],
  ] as const)("requires authentication for %s %s", async (method, path) => {
    const response =
      method === "post"
        ? await request(app.getHttpServer()).post(path).send({})
        : await request(app.getHttpServer()).get(path);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHENTICATED");
  });
});
