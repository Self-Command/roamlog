/**
 * Admin operations copy sweep (task ADMIN_COPY_ROUND2).
 *
 * The admin console is an operator surface, so its states may name the backend
 * as a service ("后台 API 不可用") and may report a setting as unwired
 * ("未接入（不生效）"). What it may never do is teach an operator the transport
 * contract: endpoint paths, response field names, JSON shapes, public env var
 * names, or the demo-prefill affordance. Every rule below is one of those.
 *
 * The sweep logs in as a real super_admin against the real stack, walks every
 * primary admin page (opening the user and workspace detail sheets, where the
 * old endpoint-shaped copy used to live), asserts the visible text, and writes
 * a desktop screenshot per page to `.audit/admin-copy/`.
 */
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "b1b-admin@roamlog.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Roamlog-B1b-Aa1!";

const AUDIT_DIR = path.join(process.cwd(), ".audit", "admin-copy");
// The storage state carries a live session cookie, so it is kept in the OS temp
// directory instead of the committing-adjacent `.audit/` tree.
const STATE_FILE = path.join(os.tmpdir(), "roamlog-admin-ops-copy-state.json");

// The session is created once by the real login form in `beforeAll` below, then
// reused by every page in this file.
test.use({
  storageState: STATE_FILE,
  baseURL: ADMIN_URL,
  viewport: { width: 1440, height: 1000 },
  // Trace recording churns artifacts under the workspace and intermittently
  // fails the context close on Windows; this sweep's evidence is the visible
  // text dump plus the per-page screenshots.
  trace: "off",
});

interface CopyRule {
  label: string;
  pattern: RegExp;
}

/** Copy that must never reach an operator's screen. */
const FORBIDDEN_COPY: readonly CopyRule[] = [
  { label: "admin endpoint path (/v1/admin)", pattern: /\/v1\/admin/ },
  { label: "any endpoint path (/v1/)", pattern: /\/v1\// },
  { label: "relative endpoint fragment (admin/metrics)", pattern: /\badmin\/[a-z]/ },
  { label: "public env var name (NEXT_PUBLIC_)", pattern: /NEXT_PUBLIC_/ },
  { label: "runtime env var name (ROAMLOG_*)", pattern: /ROAMLOG_[A-Z_]+/ },
  { label: "demo prefill affordance (演示预填)", pattern: /演示预填/ },
  { label: "transport serialisation (JSON)", pattern: /\bJSON\b/ },
  {
    label: "response field name with a value (emailDelivery:)",
    pattern:
      /\b(?:emailDelivery|twoFactorEnabled|mediaBytes|workspaceId|workspaceName|memberCount|activeSessionCount|ipAddress|userAgent|expiresAt|joinedAt|acceptedAt|revokedAt|entryCount|tripCount)\s*[:：]/,
  },
  { label: "count field shape (count:)", pattern: /\bcount\s*[:：]/ },
  { label: "array-notation field list (sessions[])", pattern: /[A-Za-z]+\[\]/ },
  { label: "error-code constant (ADMIN_2FA_REQUIRED)", pattern: /\bADMIN_[A-Z_]+\b/ },
];

const PRIMARY_PAGES = [
  { name: "01-overview", path: "/admin", label: "平台总览" },
  { name: "02-users", path: "/admin/users", label: "用户" },
  { name: "03-workspaces", path: "/admin/workspaces", label: "工作区" },
  { name: "04-emails", path: "/admin/emails", label: "邮件" },
  { name: "05-media", path: "/admin/media", label: "媒体" },
  { name: "06-system", path: "/admin/system", label: "系统健康" },
  { name: "07-audit", path: "/admin/audit", label: "审计日志" },
  { name: "08-flags", path: "/admin/flags", label: "功能开关" },
  { name: "09-content", path: "/admin/content", label: "内容审核" },
  { name: "10-queues", path: "/admin/queues", label: "队列" },
] as const;

async function visibleText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

/**
 * Screenshots and assertions are only worth anything once the real payload has
 * replaced the loading skeleton; the copy being checked lives in the loaded
 * states, not in the "正在读取后台数据。" placeholder.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("正在读取后台数据。")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText("读取中").first()).toHaveCount(0, { timeout: 20_000 }).catch(() => {
    // A detail sheet may legitimately still be streaming a secondary resource;
    // the primary payload assertion above is the gate that matters.
  });
}

/**
 * Assert every visible string against the forbidden-copy rules.
 *
 * `allowJsonValueEditor` is the one sanctioned exception and only on
 * `/admin/settings`: some settings *are* JSON documents, so the editor labels a
 * value as `值（JSON）`. That is a data-format label the operator must see; it is
 * not transport talk. The allowance strips exactly those labels and still
 * rejects any other appearance of "JSON".
 */
async function expectCleanCopy(
  page: Page,
  where: string,
  options: { allowJsonValueEditor?: boolean } = {},
): Promise<void> {
  const text = await visibleText(page);
  const jsonEditorLabels = /值（JSON）|JSON 值|JSON 键/g;
  const copyText = options.allowJsonValueEditor
    ? text.replace(jsonEditorLabels, "")
    : text;
  const violations: string[] = [];

  for (const rule of FORBIDDEN_COPY) {
    const haystack = rule.label.includes("JSON") ? copyText : text;
    const match = rule.pattern.exec(haystack);
    if (match) violations.push(`${rule.label} → "${match[0]}"`);
  }

  // Printing the sweep result makes the list reporter itself the evidence.
  console.log(
    `[ops-copy] ${where}: ${text.length} chars visible, ${violations.length} violation(s)` +
      (options.allowJsonValueEditor ? " (json value editor allowed)" : ""),
  );
  expect(violations, `${where}: forbidden copy is visible on screen`).toEqual([]);
}

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(AUDIT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(AUDIT_DIR, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

test.describe("admin operations copy", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    mkdirSync(AUDIT_DIR, { recursive: true });

    const context = await browser.newContext({
      baseURL: ADMIN_URL,
      viewport: { width: 1440, height: 1000 },
      // The shared state file is written below; the login context starts empty.
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "进入平台控制台" })).toBeVisible();
    await page.getByLabel("管理员邮箱").fill(ADMIN_EMAIL);
    await page.getByLabel("密码").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "继续验证" }).click();

    await page.waitForURL(/\/admin(\/|$)/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "平台总览" })).toBeVisible();

    await context.storageState({ path: STATE_FILE });
    await context.close();
  });

  for (const target of PRIMARY_PAGES) {
    test(`${target.label} page has no implementation copy`, async ({ page }) => {
      await page.goto(target.path);
      await settle(page);

      // Authenticated pages must not fall back to the login form.
      await expect(page.getByRole("heading", { name: "进入平台控制台" })).toHaveCount(0);
      await expect(page.locator("main, [role='main']").first()).toBeVisible();

      await expectCleanCopy(page, target.path);
      await shoot(page, target.name);
    });
  }

  test("user detail sheet keeps a real status instead of an endpoint description", async ({
    page,
  }) => {
    await page.goto("/admin/users");
    await settle(page);
    await expect(page.getByRole("button", { name: "详情" }).first()).toBeVisible();
    await page.getByRole("button", { name: "详情" }).first().click();

    // The sheet is the surface that used to spell out sessions[]/workspaces[].
    const sheet = page.getByRole("dialog").last();
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("活跃会话");
    await settle(page);

    await expectCleanCopy(page, "/admin/users → 用户详情");
    // The stale sentence claimed the endpoint lacked the fields; it is gone.
    await expect(sheet).not.toContainText("需要 GET");
    await shoot(page, "11-user-detail");
  });

  test("workspace detail sheet keeps a real status instead of an endpoint description", async ({
    page,
  }) => {
    await page.goto("/admin/workspaces");
    await settle(page);
    await expect(page.getByRole("button", { name: "工作区详情" }).first()).toBeVisible();
    await page.getByRole("button", { name: "工作区详情" }).first().click();

    const sheet = page.getByRole("dialog").last();
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("成员");
    await settle(page);

    await expectCleanCopy(page, "/admin/workspaces → 工作区详情");
    await expect(sheet).not.toContainText("需要 GET");
    await shoot(page, "12-workspace-detail");
  });

  test("emails keeps the test-send placeholder without the endpoint it waits for", async ({
    page,
  }) => {
    await page.goto("/admin/emails");
    await settle(page);

    await expect(page.getByText("测试邮件入口尚未开放")).toBeVisible();
    // No fake affordance: the capability does not exist on the API yet.
    await expect(page.getByRole("button", { name: /测试邮件/ })).toHaveCount(0);
    await expect(page.getByText(/POST \/v1\/admin\/emails\/test/)).toHaveCount(0);

    await expectCleanCopy(page, "/admin/emails → 测试邮件卡片");
  });

  test("system page never exposes the env vars behind unreported values", async ({ page }) => {
    await page.goto("/admin/system");
    await settle(page);

    // Absent values stay explicit, but the variable that would fill them is a
    // build-time detail and must not be named in the console. The API reports no
    // build timestamp in development, so this is the live unreported state.
    await expect(page.getByText(/后端未上报构建时间/)).toBeVisible();
    await expect(page.getByText(/ROAMLOG_API_VERSION|ROAMLOG_BUILD_TIME/)).toHaveCount(0);
    await expect(page.getByText(/NEXT_PUBLIC_/)).toHaveCount(0);
    // The old wording is gone from this page entirely.
    await expect(page.getByText("未接入", { exact: true })).toHaveCount(0);
    // Worker liveness is unprovable here: it reads "无法确认", never "未接入".
    await expect(page.getByText("无法确认")).toBeVisible();

    await expectCleanCopy(page, "/admin/system → 版本与迁移");
  });

  test("settings page states which keys take effect without naming deployment config", async ({
    page,
  }) => {
    await page.goto("/admin/settings");
    await settle(page);

    // The "does not take effect" truth must survive; only the mechanism is gone.
    await expect(page.getByText(/未接入（不生效）/).first()).toBeVisible();
    await expect(page.getByText(/上传限流在部署配置中固定，在此修改不生效/)).toBeVisible();
    await expect(page.getByText(/仍读环境变量，|上传限流未接入/)).toHaveCount(0);

    // No env var names, no endpoint paths on the configuration surface.
    await expect(page.getByText(/ROAMLOG_|NEXT_PUBLIC_/)).toHaveCount(0);
    await expect(page.getByText(/\/v1\//)).toHaveCount(0);

    // Only the JSON value editor may mention JSON; nothing else may.
    await expectCleanCopy(page, "/admin/settings", { allowJsonValueEditor: true });
    await shoot(page, "15-settings");
  });

  test("the same copy holds at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const [target, name] of [
      ["/admin/users", "13-users-390"],
      ["/admin/system", "14-system-390"],
    ] as const) {
      await page.goto(target);
      await settle(page);
      await expectCleanCopy(page, `${target} @390`);
      await shoot(page, name);
    }
  });
});