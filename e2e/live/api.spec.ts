import { expect, test } from "@playwright/test";

import { loadLiveFixture } from "../live-support/fixture";

test.describe("Live API smoke", () => {
  test("health and readiness expose structured status", async ({ request }) => {
    const health = await request.get("/v1/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const ready = await request.get("/v1/ready");
    expect([200, 503]).toContain(ready.status());
    const readyBody = await ready.json();
    expect(readyBody).toMatchObject({
      status: expect.stringMatching(/^(ok|unavailable)$/),
      checks: {
        database: { status: expect.stringMatching(/^(up|down)$/) },
        redis: { status: expect.stringMatching(/^(up|down)$/) },
        storage: { status: expect.stringMatching(/^(up|down)$/) },
      },
    });
    expect(readyBody.checks.database.status).toBe("up");
  });

  test("unauthenticated admin is denied and a verified admin without TOTP is gated", async ({
    request,
  }) => {
    const unauthenticated = await request.get("/v1/admin/metrics");
    expect(unauthenticated.status()).toBe(401);

    const fixture = loadLiveFixture();
    const gated = await request.get("/v1/admin/metrics", {
      headers: {
        cookie: fixture.pendingAdmin.sessionCookie,
      },
    });
    expect(gated.status()).toBe(403);
    expect(await gated.json()).toMatchObject({
      code: "ADMIN_2FA_REQUIRED",
    });
  });

  test("cross-tenant trip lookup returns 404", async ({ request }) => {
    const fixture = loadLiveFixture();

    const response = await request.get(`/v1/trips/${fixture.outsider.tripId}`, {
      headers: {
        cookie: fixture.web.sessionCookie,
      },
    });
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({
      status: 404,
    });
  });
});
