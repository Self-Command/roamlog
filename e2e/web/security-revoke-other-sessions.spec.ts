import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  deleteSmokeAccount,
  loginOnWeb,
  provisionWorkspaceMember,
  WEB_URL,
} from "../support/accounts";

const WORKSPACE_SLUG = "roamlog-crew";
const RUN_ID = `revoke-other-${Date.now().toString(36)}`;
const ACCOUNT = {
  email: `${RUN_ID}@roamlog.test`,
  password: "Roamlog-Revoke-Other-Aa1!",
  name: `Revoke Other ${RUN_ID}`,
};
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
const OUT_DIR = path.resolve(process.cwd(), ".audit", "auth-revoke-other");

async function shot(page: import("@playwright/test").Page, name: string): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
}

test("退出其他设备只撤销其他会话，当前设备保持登录", async ({ browser }) => {
  test.setTimeout(240_000);
  provisionWorkspaceMember(ACCOUNT, WORKSPACE_SLUG, "viewer");

  const currentContext = await browser.newContext({
    baseURL: WEB_URL,
    viewport: DESKTOP,
    extraHTTPHeaders: { Origin: WEB_URL },
  });
  const otherContext = await browser.newContext({
    baseURL: WEB_URL,
    viewport: DESKTOP,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    extraHTTPHeaders: { Origin: WEB_URL },
  });

  try {
    const currentPage = await currentContext.newPage();
    const otherPage = await otherContext.newPage();
    await Promise.all([loginOnWeb(currentPage, ACCOUNT), loginOnWeb(otherPage, ACCOUNT)]);

    const settingsUrl = `${WEB_URL}/w/${WORKSPACE_SLUG}/settings/security`;
    await currentPage.goto(settingsUrl, { waitUntil: "domcontentloaded" });
    await expect(
      currentPage.getByRole("heading", { name: "账号安全", level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    const devices = currentPage.locator('section[aria-label="登录设备"]');
    await expect(devices.getByText(/共 2 台设备 · 2 个有效会话/u)).toBeVisible({
      timeout: 30_000,
    });

    const revokeResponse = currentPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/revoke-other-sessions" &&
        response.request().method() === "POST",
    );
    await devices.getByRole("button", { name: "退出所有其他设备" }).click();
    const dialog = currentPage.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "退出所有其他设备？" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "退出所有其他设备" }).click();

    expect((await revokeResponse).status()).toBe(200);
    await expect(
      currentPage.getByText("已退出所有其他设备，当前设备保持登录。"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(currentPage).toHaveURL(settingsUrl);

    await currentPage.reload({ waitUntil: "domcontentloaded" });
    await expect(
      currentPage.getByRole("heading", { name: "账号安全", level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(devices.getByText(/共 1 台设备 · 1 个有效会话/u)).toBeVisible({
      timeout: 30_000,
    });
    await devices.scrollIntoViewIfNeeded();
    await shot(currentPage, "current-device-kept-1440");

    await currentPage.setViewportSize(MOBILE);
    await devices.scrollIntoViewIfNeeded();
    await shot(currentPage, "current-device-kept-390");
    await currentPage.setViewportSize(DESKTOP);

    const otherMe = await otherPage.request.get("/v1/me");
    expect(otherMe.status(), await otherMe.text()).toBe(401);
    await otherPage.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(otherPage).toHaveURL(/\/login(?:\?.*)?$/u, { timeout: 30_000 });
  } finally {
    await Promise.allSettled([currentContext.close(), otherContext.close()]);
    deleteSmokeAccount(ACCOUNT.email);
  }
});
