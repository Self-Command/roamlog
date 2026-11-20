/**
 * FORGOT_PASSWORD_FIX — real UI acceptance for account recovery.
 *
 * Runs against the real local stack (web :3000 → API :4000 → Postgres) with no
 * login, so the page under test is the one a logged-out visitor gets.
 *
 * The regression being guarded: `requestPasswordReset()` used to POST
 * `/v1/auth/forget-password`, which Better Auth 1.7 does not mount
 * (`createAuthEndpoint("/request-password-reset")`), so the request 404'd while
 * the UI still said the mail was sent. Better Auth answers 200 even when
 * `sendResetPassword` throws (`dist/context/create-context.mjs:215-224`), so the
 * gateway also appends `emailDelivery` — the UI must honour it.
 *
 * Usage:
 *   E2E_SKIP_WEB_SERVER=1 E2E_SKIP_ADMIN_SERVER=1 \
 *   node node_modules/@playwright/test/cli.js test e2e/web/forgot-password.spec.ts \
 *     --project=web --reporter=list
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";

// Other suites wipe `test-results/` while this one runs; keep evidence in
// `.audit/` instead (same reason as `prod-copy.spec.ts`).
test.use({ trace: "off", video: "off" });

const EMAIL = "verify@roamlog.test";
const AUDIT_DIR = path.resolve(process.cwd(), ".audit/forgot-password");
const RESET_PATH = "/v1/auth/request-password-reset";

/** The three states the form can legitimately show. */
const SUCCESS_COPY = "重置链接已发送到收件箱";
const NOT_CONFIGURED_COPY = "邮件服务未配置";
const FAILED_COPY = "邮件未能发出";

mkdirSync(AUDIT_DIR, { recursive: true });

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

async function submitReset(page: Page) {
  await page.getByLabel("邮箱").fill(EMAIL);
  await page.getByRole("button", { name: /发送重置链接/ }).click();
}

/**
 * Next.js injects its own `<div role="alert" id="__next-route-announcer__">`,
 * so role queries must be scoped to the form to describe the form's own state.
 */
function outcomes(page: Page) {
  const form = page.locator("form");
  return { form, success: form.getByRole("status"), alert: form.getByRole("alert") };
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: path.join(AUDIT_DIR, `${name}.png`), fullPage: true });
}

test("request goes through /v1/auth/request-password-reset, answers 200, and the page never lies", async ({
  page,
}) => {
  const authPaths: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/auth/")) {
      authPaths.push(new URL(request.url()).pathname);
    }
  });

  await page.goto("/forgot-password");
  // Public page: the marketing copy describes a working feature, not a stub.
  await expect(page.getByText(/当前仅执行邮箱格式校验/u)).toHaveCount(0);
  await expect(page.getByText(/真实环境会发送/u)).toHaveCount(0);

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes(RESET_PATH) && candidate.request().method() === "POST",
    ),
    submitReset(page),
  ]);

  // 1. No more 404: the status is the regression signal.
  const status = response.status();
  expect(status).toBe(200);

  // 2. The right endpoint was used; the removed one was never called.
  expect(authPaths).toContain(RESET_PATH);
  expect(authPaths.some((candidate) => candidate.includes("forget-password"))).toBe(false);

  const body = (await response.json()) as { status?: boolean; emailDelivery?: string };

  // 3. Exactly one outcome is on screen — never success *and* a failure note.
  const { success, alert } = outcomes(page);
  await expect(success.or(alert)).toBeVisible();
  expect((await success.count()) + (await alert.count())).toBe(1);

  // 4. The rendered outcome must match the delivery verdict the API returned.
  if (body.emailDelivery === "not_configured") {
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(NOT_CONFIGURED_COPY);
    await expect(success).toHaveCount(0);
  } else if (body.emailDelivery === "failed") {
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(FAILED_COPY);
    await expect(success).toHaveCount(0);
    await expect(page.getByText(SUCCESS_COPY)).toHaveCount(0);
  } else {
    await expect(success).toBeVisible();
    await expect(success).toContainText(SUCCESS_COPY);
    await expect(alert).toHaveCount(0);
  }

  // Evidence: current code, real request, desktop + mobile.
  await shoot(page, `desktop-1440-${body.emailDelivery ?? "sent"}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await shoot(page, `mobile-390-${body.emailDelivery ?? "sent"}`);

  writeFileSync(
    path.join(AUDIT_DIR, "last-run.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        endpoint: new URL(response.url()).pathname,
        status,
        responseBody: body,
        authRequests: authPaths,
      },
      null,
      2,
    ),
  );
});

test("mail not configured shows the honest message, not a success note", async ({ page }) => {
  await page.route(`**${RESET_PATH}`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      // The exact failure body the API returns when no transport is configured.
      body: JSON.stringify({ status: true, emailDelivery: "not_configured" }),
    }),
  );

  await page.goto("/forgot-password");
  await submitReset(page);

  const { success, alert } = outcomes(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(NOT_CONFIGURED_COPY);
  await expect(alert).toContainText("请联系管理员");
  await expect(success).toHaveCount(0);
  await expect(page.getByText(SUCCESS_COPY)).toHaveCount(0);

  await shoot(page, `desktop-1440-not_configured`);
  await page.setViewportSize({ width: 390, height: 844 });
  await shoot(page, `mobile-390-not_configured`);
});

test("a dead relay (200 + emailDelivery=failed) is reported as failure", async ({ page }) => {
  await page.route(`**${RESET_PATH}`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: true,
        message: "If this email exists in our system, check your email for the reset link",
        emailDelivery: "failed",
      }),
    }),
  );

  await page.goto("/forgot-password");
  await submitReset(page);

  const { success, alert } = outcomes(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(FAILED_COPY);
  await expect(success).toHaveCount(0);
  await expect(page.getByText(SUCCESS_COPY)).toHaveCount(0);
});

test("a delivered request keeps the neutral success copy", async ({ page }) => {
  await page.route(`**${RESET_PATH}`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: true,
        message: "If this email exists in our system, check your email for the reset link",
      }),
    }),
  );

  await page.goto("/forgot-password");
  await submitReset(page);

  const { success, alert } = outcomes(page);
  await expect(success).toBeVisible();
  await expect(success).toContainText(SUCCESS_COPY);
  await expect(alert).toHaveCount(0);
});

test("a real 404 is surfaced as an error, never as success", async ({ page }) => {
  await page.route(`**${RESET_PATH}`, (route: Route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ message: "Not found", code: "NOT_FOUND" }),
    }),
  );

  await page.goto("/forgot-password");
  await submitReset(page);

  const { success, alert } = outcomes(page);
  await expect(alert).toBeVisible();
  await expect(success).toHaveCount(0);

  writeFileSync(
    path.join(AUDIT_DIR, "last-stub-run.txt"),
    `${stamp()} stub-404 guard executed\n`,
  );
});