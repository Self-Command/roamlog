import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  API_URL,
  OWNER_ACCOUNT,
  WORKSPACE_SLUG,
  signInViaApi,
} from "../support/accounts";

const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3003";
const OUT_DIR = path.resolve(process.cwd(), ".audit", "release-blockers", "web-copy");

test.describe.configure({ mode: "serial" });

async function hideDevTools(page: import("@playwright/test").Page): Promise<void> {
  await page.addStyleTag({
    content:
      "nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button]{display:none!important}",
  });
}

async function shot(
  page: import("@playwright/test").Page,
  name: string,
  width: number,
  height: number,
): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} ${width}px horizontal overflow`).toBeLessThanOrEqual(1);
  await hideDevTools(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-${width}.png`) });
}

test("shell, auth, members, and security copy is user-facing", async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "登录 Roamlog" })).toBeVisible();
  await expect(page.getByText("把每次旅行留下来。")).toBeVisible();
  await expect(page.getByText("Every trip deserves a memory.")).toHaveCount(0);
  await expect(page.getByText("WELCOME BACK")).toHaveCount(0);
  await expect(page.getByText("SECURITY CHECK")).toHaveCount(0);
  await shot(page, "login", 1440, 1000);
  await shot(page, "login", 390, 844);

  await page.goto(`${WEB_URL}/register`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "创建账号" })).toBeVisible();
  await expect(page.getByText("开始使用")).toBeVisible();
  await expect(page.getByText("CREATE YOUR ARCHIVE")).toHaveCount(0);
  await shot(page, "register", 1440, 1000);
  await shot(page, "register", 390, 844);

  await page.goto(`${WEB_URL}/forgot-password`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("账号恢复")).toBeVisible();
  await shot(page, "forgot-password", 1440, 1000);
  await shot(page, "forgot-password", 390, 844);

  await page.goto(`${WEB_URL}/this-route-does-not-exist`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "找不到这个页面" })).toBeVisible();
  await expect(page.getByText(/Wave/u)).toHaveCount(0);
  await shot(page, "not-found", 1440, 1000);
  await shot(page, "not-found", 390, 844);

  await signInViaApi(page.request, OWNER_ACCOUNT, "http://localhost:3000", API_URL);
  const workspace = encodeURIComponent(WORKSPACE_SLUG);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${WEB_URL}/w/${workspace}/members`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "成员与邀请" })).toBeVisible();
  await expect(page.getByText("工作区成员").first()).toBeVisible();
  await expect(
    page.getByText(/所有者 · 免费版/u).filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("成员列表")).toBeVisible();
  await expect(page.getByText("WORKSPACE PEOPLE")).toHaveCount(0);
  await expect(page.getByText("PENDING INVITATIONS")).toHaveCount(0);
  await shot(page, "members", 1440, 1000);
  await shot(page, "members", 390, 844);

  await page.goto(`${WEB_URL}/w/${workspace}/settings/security`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("账号安全").first()).toBeVisible();
  await expect(page.getByText("ACCOUNT SECURITY")).toHaveCount(0);
  await expect(page.getByText("ACCOUNT / SECURITY")).toHaveCount(0);
  await expect(page.getByText("ENABLED")).toHaveCount(0);
  await shot(page, "security", 1440, 1000);
  await shot(page, "security", 390, 844);
});
