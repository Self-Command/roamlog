/**
 * PRODUCTION_INVITE_FEEDBACK — verifies that invitation failures are rendered
 * inside the open dialog instead of behind its overlay.
 *
 * Run:
 *   $env:E2E_WEB_URL='https://we.spacedo.org'
 *   $env:E2E_SKIP_WEB_SERVER='1'
 *   $env:E2E_SKIP_ADMIN_SERVER='1'
 *   pnpm exec playwright test e2e/web/production-invite-feedback.spec.ts --project=web --workers=1
 */
import { expect, request as playwrightRequest, test, type Browser } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_WEB_URL ?? "https://we.spacedo.org").replace(/\/+$/u, "");
const SSH_HOST = process.env.E2E_PROD_SSH ?? "root@217.217.197.188";
const PG_CONTAINER = process.env.E2E_PROD_PG_CONTAINER ?? "roamlog-postgres-1";
const RUN_ID = `prod-invite-${Date.now().toString(36)}`;
const PASSWORD = "Roamlog-Invite-Aa1!";
const OWNER_EMAIL = `${RUN_ID}-owner@roamlog.test`;
const WORKSPACE_NAME = `邀请反馈验收 ${RUN_ID}`;
const WORKSPACE_SLUG = RUN_ID;
const OUT_DIR = path.resolve(process.cwd(), ".audit", "production", RUN_ID);

type FailureMode = "delivery" | "forbidden" | "network";

function sql(statement: string): string {
  const encoded = Buffer.from(statement, "utf8").toString("base64");
  return execSync(
    `ssh ${SSH_HOST} "printf '%s' '${encoded}' | base64 -d | docker exec -i ${PG_CONTAINER} psql -U roamlog -d roamlog -v ON_ERROR_STOP=1 -f -"`,
    { encoding: "utf8" },
  );
}

function problem(status: number, code: string, detail: string) {
  return {
    type: `https://roamlog.app/errors/${code.toLowerCase().replaceAll("_", "-")}`,
    title: status === 403 ? "Forbidden" : "Service Unavailable",
    status,
    code,
    detail,
    errors: [],
  };
}

test.describe.configure({ mode: "serial", retries: 0 });

test("invitation failures stay visible and retryable inside the dialog", async ({ browser }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT_DIR, { recursive: true });

  const api = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  let workspaceId = "";
  let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;

  try {
    const signUp = await api.post("/v1/auth/sign-up/email", {
      data: { email: OWNER_EMAIL, password: PASSWORD, name: "邀请反馈验收 Owner" },
    });
    expect(signUp.status(), await signUp.text()).toBe(200);
    sql(`UPDATE "User" SET "emailVerified" = true WHERE email = '${OWNER_EMAIL}';`);

    const signIn = await api.post("/v1/auth/sign-in/email", {
      data: { email: OWNER_EMAIL, password: PASSWORD, rememberMe: true },
    });
    expect(signIn.status(), await signIn.text()).toBe(200);

    const workspace = await api.post("/v1/workspaces", {
      data: {
        name: WORKSPACE_NAME,
        slug: WORKSPACE_SLUG,
        defaultCurrency: "CNY",
        timezone: "Asia/Shanghai",
      },
    });
    expect(workspace.status(), await workspace.text()).toBe(201);
    workspaceId = ((await workspace.json()) as { id: string }).id;

    context = await browser.newContext({
      storageState: await api.storageState(),
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    let mode: FailureMode = "delivery";

    await page.route("**/v1/workspaces/*/invitations", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      if (mode === "network") {
        await route.abort("failed");
        return;
      }
      const status = mode === "forbidden" ? 403 : 503;
      const code =
        mode === "forbidden" ? "EMAIL_VERIFICATION_REQUIRED" : "INVITATION_DELIVERY_FAILED";
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(
          problem(
            status,
            code,
            mode === "forbidden"
              ? "Verify your email address before inviting collaborators."
              : "The invitation could not be delivered. No pending invitation was left behind.",
          ),
        ),
      });
    });

    await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/members`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "成员与邀请" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "邀请成员" }).click();
    const dialog = page.getByRole("dialog");
    const email = dialog.getByLabel("邮箱");
    await expect(dialog).toBeVisible();
    await email.fill(`invite-check-${RUN_ID}@example.com`);
    await dialog.getByLabel("角色").selectOption("admin");
    await dialog.getByLabel("留言（可选）").fill("请一起记录这趟旅行。");

    await dialog.getByRole("button", { name: "发送邀请" }).click();
    const deliveryAlert = dialog.getByTestId("invite-member-error");
    await expect(deliveryAlert).toBeVisible({ timeout: 30_000 });
    await expect(deliveryAlert).toContainText("邮件服务暂时不可用");
    await expect(deliveryAlert).toContainText("邀请没有保存");
    await expect(deliveryAlert).toBeFocused();
    await expect(email).toHaveValue(`invite-check-${RUN_ID}@example.com`);
    await expect(dialog.getByLabel("留言（可选）")).toHaveValue("请一起记录这趟旅行。");
    await expect(dialog.getByRole("button", { name: "发送邀请" })).toBeEnabled();
    await page.screenshot({ path: path.join(OUT_DIR, "invite-delivery-error-1440.png") });

    mode = "forbidden";
    await dialog.getByRole("button", { name: "发送邀请" }).click();
    await expect(deliveryAlert).toContainText("请先完成邮箱验证", { timeout: 30_000 });

    mode = "network";
    await dialog.getByRole("button", { name: "发送邀请" }).click();
    await expect(deliveryAlert).toContainText("无法连接服务器", { timeout: 30_000 });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "取消" }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "成员与邀请" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(`invite-check-${RUN_ID}@example.com`)).toHaveCount(0);
    await page.screenshot({ path: path.join(OUT_DIR, "invite-no-phantom-invitation-1440.png") });
  } finally {
    await context?.close();
    if (workspaceId) {
      sql(`DELETE FROM "Workspace" WHERE id = '${workspaceId}';`);
    }
    sql(`DELETE FROM "User" WHERE email = '${OWNER_EMAIL}';`);
    await api.dispose();
  }
});
