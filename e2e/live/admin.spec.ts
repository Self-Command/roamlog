import { expect, test } from "@playwright/test";

import { loginOnAdmin } from "../live-support/browser";
import { loadLiveFixture } from "../live-support/fixture";

test.describe("Admin live API journey", () => {
  test("TOTP challenge, metrics, suspend user, and audit evidence", async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = loadLiveFixture();
    await loginOnAdmin(page, fixture);

    await expect(page.getByRole("heading", { name: "平台总览" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("用户总数")).toBeVisible();
    await expect(page.getByText("真实 Admin API")).toBeVisible();
    await page.screenshot({
      path: "test-results/live/admin-metrics.png",
      fullPage: true,
    });

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
    await page.getByPlaceholder("姓名或邮箱").fill(fixture.target.email);
    const targetRow = page.getByRole("row", { name: new RegExp(fixture.target.name) });
    await expect(targetRow).toBeVisible();
    await targetRow.getByRole("button", { name: "暂停账户" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "暂停账户" })).toBeVisible();
    await page.getByLabel("输入用户姓名确认").fill(fixture.target.name);
    await page.getByRole("button", { name: "确认暂停" }).click();
    await expect(page.getByText("已提交：admin.user.suspend")).toBeVisible();

    const suspended = await page.request.get(`/v1/admin/users/${fixture.target.id}`);
    expect(suspended.status()).toBe(200);
    expect(await suspended.json()).toMatchObject({
      id: fixture.target.id,
      status: "suspended",
    });

    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
    await expect(page.getByText("admin.user.updated").first()).toBeVisible();
    await expect(page.getByText(fixture.target.id.slice(-8)).first()).toBeVisible();
    await page.screenshot({
      path: "test-results/live/admin-audit.png",
      fullPage: true,
    });

    const audit = await page.request.get("/v1/admin/audit?limit=100");
    expect(audit.status()).toBe(200);
    const auditPage = (await audit.json()) as {
      items: Array<{ action: string; targetId: string }>;
    };
    expect(auditPage.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.user.updated",
          targetId: fixture.target.id,
        }),
      ]),
    );
  });

  test("asks a platform admin without verified TOTP to finish two-step verification", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const fixture = loadLiveFixture();

    await page.goto("/login");
    await page.getByLabel("管理员邮箱").fill(fixture.pendingAdmin.email);
    await page.getByLabel("密码").fill(fixture.pendingAdmin.password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/admin");

    await expect(page.getByText("先完成两步验证", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "先完成两步验证" })).toBeVisible();
  });
});
