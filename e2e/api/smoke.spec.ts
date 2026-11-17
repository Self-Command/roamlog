import { expect, test, type APIRequestContext } from "@playwright/test";

async function apiIsReachable(request: APIRequestContext): Promise<boolean> {
  try {
    await request.get("/v1/health", { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

test("API health responds with HTTP 200", async ({ request }) => {
  test.skip(
    !(await apiIsReachable(request)),
    "API is not running. Start it with `pnpm --filter @roamlog/api dev` or set E2E_START_API=1.",
  );

  const response = await request.get("/v1/health");
  expect(response.status()).toBe(200);
});

test("unauthenticated admin metrics are rejected with HTTP 401", async ({ request }) => {
  test.skip(
    !(await apiIsReachable(request)),
    "API is not running. Start it with `pnpm --filter @roamlog/api dev` or set E2E_START_API=1.",
  );

  const response = await request.get("/v1/admin/metrics");
  expect(response.status()).toBe(401);
});
