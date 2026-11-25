/**
 * SETTINGS_WORKSPACE_DANGER — real-stack UI acceptance for
 * `/w/[slug]/settings/workspace` and `/w/[slug]/settings/danger`.
 *
 * Stack: real Next.js dev server on http://localhost:3000, real NestJS API and
 * PostgreSQL behind the `/v1` rewrite, real Better Auth session, real MinIO
 * upload + media worker. Nothing is mocked.
 *
 * The only usable local account is `verify@roamlog.test`, which is **Admin of
 * `roamlog-crew`** and Owner of its own archive workspace (verified through
 * `GET /v1/me/workspaces` below). Owner-only confirmations are therefore
 * exercised on that owner workspace, while the `roamlog-crew` danger page
 * proves the role-based disabling an Admin must see.
 */
import { expect, test, type Page, type Response } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expectNoHorizontalOverflow } from "../support/helpers";

const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const WORKSPACE_SLUG = "roamlog-crew";
const WORKSPACE_PATH = `/w/${WORKSPACE_SLUG}`;
const ACCOUNT = { email: "verify@roamlog.test", password: "Roamlog-Verify-Aa1!" };
const EVIDENCE_DIR = path.join(process.cwd(), ".audit", "settings-workspace");
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, "evidence.json");

/** 96×96 orange logo with a dark inset square, generated for this spec. */
const LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAAnklEQVR42u3bsQkAIAwAwdTBHbKqm+sGdkIgBz/B9R9nlx4FAkCAAAECBAgQIAECBAgQIECAAAkQIECAAA0Cylw9AwQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAAB6gPkWQUkQIAAAQIECBAgAQIECBAgQIAACRAgQL+7xNIRWJpkdecAAAAASUVORK5CYII=",
  "base64",
);

interface Evidence {
  generatedAt: string;
  workspaceSettings: Record<string, unknown>;
  danger: {
    adminRole: string;
    ownerWorkspace: string;
    exportTriggered: boolean;
    deleteGate: boolean;
    transferGate: boolean;
  };
}

const evidence: Evidence = {
  generatedAt: new Date().toISOString(),
  workspaceSettings: {},
  danger: {
    adminRole: "",
    ownerWorkspace: "",
    exportTriggered: false,
    deleteGate: false,
    transferGate: false,
  },
};

mkdirSync(EVIDENCE_DIR, { recursive: true });

/**
 * The shared dev API is restarted by other agents while work continues; a
 * sign-in during that window answers with a non-JSON page. Wait for `/v1/health`
 * first (same guard as `e2e/support/accounts.ts:167-180`).
 */
async function waitForApi(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get(`${WEB_URL}/v1/health`, { timeout: 3_000 })).status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(200);
}

async function login(page: Page): Promise<void> {
  await waitForApi(page);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
    // The dev server's first paint can precede hydration; a native submit would
    // turn into a GET with the credentials in the query string.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel("邮箱").fill(ACCOUNT.email);
    await page.getByLabel("密码").fill(ACCOUNT.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();

    const landed = await page
      .waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;
    await page.waitForTimeout(2_000);
  }
  throw new Error("登录失败：三次尝试都没有进入工作区。");
}

function expectPatch(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/v1\/workspaces\/[^/]+$/.test(new URL(response.url()).pathname),
    { timeout: 120_000 },
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, name),
    fullPage: true,
    animations: "disabled",
  });
}

test.describe.configure({ mode: "serial" });

test("工区设置：Logo、周起始日、可见性、密度、强调色保存后在刷新后保持", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);

  await page.goto(`${WORKSPACE_PATH}/settings/workspace`);
  await expect(page.getByRole("heading", { name: "工作区设置" })).toBeVisible();

  // --- Logo: upload → PATCH 200 → still there after reload ------------------
  const logoSection = page.locator("section[aria-labelledby='workspace-logo-title']");

  // Re-runs start from whatever the previous run left behind.
  const removeLogo = logoSection.getByRole("button", { name: "移除" });
  if ((await removeLogo.count()) > 0) {
    const removal = expectPatch(page);
    await removeLogo.click();
    expect((await removal).status()).toBe(200);
    await expect(page.getByText("工作区标志已移除。")).toBeVisible();
    await expect(logoSection.locator("img")).toHaveCount(0, { timeout: 15_000 });
  }

  const logoPatch = expectPatch(page);
  await page.getByLabel("选择工作区标志").setInputFiles({
    name: "roamlog-crew-logo.png",
    mimeType: "image/png",
    buffer: LOGO_PNG,
  });
  const logoResponse = await logoPatch;
  expect(logoResponse.status(), await logoResponse.text()).toBe(200);

  await expect(page.getByText("工作区标志已更新。")).toBeVisible({ timeout: 90_000 });

  await page.reload();
  await expect(page.getByRole("heading", { name: "工作区设置" })).toBeVisible();
  await expect(logoSection.locator("img")).toBeVisible({ timeout: 30_000 });
  evidence.workspaceSettings.logoAfterReload = true;

  // --- Week start / visibility / density / accent / notifications -----------
  await page.getByLabel("周起始日").selectOption("3");
  await page.getByLabel("默认可见性").selectOption("private");
  await page.getByLabel("界面密度").selectOption("compact");
  await page.getByLabel("强调色十六进制值").fill("#3b9eff");
  await page.getByLabel("站内通知").click();
  await expect(page.getByLabel("站内通知")).toHaveAttribute("data-state", "unchecked");

  const settingsPatch = expectPatch(page);
  await page.getByRole("button", { name: "保存更改" }).click();
  const settingsResponse = await settingsPatch;
  expect(settingsResponse.status(), await settingsResponse.text()).toBe(200);

  const payload = JSON.parse(settingsResponse.request().postData() ?? "{}") as Record<
    string,
    unknown
  >;
  evidence.workspaceSettings.patchBody = payload;

  // Only the changed fields are submitted, and `settings` carries the merged
  // object the API replaces wholesale.
  expect(Object.keys(payload).sort()).toEqual(["settings", "weekStartsOn"]);
  expect(payload.weekStartsOn).toBe(3);
  expect(payload.settings).toEqual({
    defaultVisibility: "private",
    notificationDefaults: { inApp: false, email: true },
    density: "compact",
    accentColor: "#3b9eff",
  });
  expect(payload).not.toHaveProperty("name");
  expect(payload).not.toHaveProperty("slug");
  expect(payload).not.toHaveProperty("timezone");

  await expect(page.getByText("工作区设置已保存。")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("周起始日")).toHaveValue("3");
  await expect(page.getByLabel("默认可见性")).toHaveValue("private");
  await expect(page.getByLabel("界面密度")).toHaveValue("compact");
  await expect(page.getByLabel("强调色十六进制值")).toHaveValue("#3b9eff");
  await expect(page.getByLabel("站内通知")).toHaveAttribute("data-state", "unchecked");
  await expect(page.getByLabel("邮件通知")).toHaveAttribute("data-state", "checked");
  evidence.workspaceSettings.persistedAfterReload = true;

  await shot(page, "desktop-1440-workspace.png");

  // --- Restore the shared workspace so other journeys see neutral defaults --
  await page.getByLabel("周起始日").selectOption("1");
  await page.getByLabel("默认可见性").selectOption("workspace");
  await page.getByLabel("界面密度").selectOption("comfortable");
  await page.getByLabel("强调色十六进制值").fill("");
  await page.getByLabel("站内通知").click();
  const restorePatch = expectPatch(page);
  await page.getByRole("button", { name: "保存更改" }).click();
  expect((await restorePatch).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel("周起始日")).toHaveValue("1");
  await expect(page.getByLabel("默认可见性")).toHaveValue("workspace");
  await expect(page.getByLabel("界面密度")).toHaveValue("comfortable");
  await expect(page.getByLabel("强调色十六进制值")).toHaveValue("");
  await expect(page.getByText("当前使用主题默认强调色。")).toBeVisible();
  await expect(page.getByLabel("站内通知")).toHaveAttribute("data-state", "checked");

  // --- Slug is editable now, and client-side validation rejects bad values --
  const slug = page.getByLabel("Slug");
  await expect(slug).toBeEditable();
  await slug.fill("Roamlog Crew!");
  await expect(
    page.getByText("Slug 只能使用小写字母、数字和单个连字符，且不能以连字符开头或结尾。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "保存更改" })).toBeDisabled();
  evidence.workspaceSettings.slugEditable = true;
  evidence.workspaceSettings.slugValidationRejected = true;

  // Never persist a slug change here: it would move the URL other agents use.
  await slug.fill(WORKSPACE_SLUG);
  await expect(
    page.getByText("Slug 只能使用小写字母、数字和单个连字符，且不能以连字符开头或结尾。"),
  ).toHaveCount(0);

  // Accent colour is validated client-side against the #rrggbb contract rule.
  await page.getByLabel("强调色十六进制值").fill("#zzzzzz");
  await expect(page.getByText("强调色必须是 #rrggbb 形式的六位十六进制色值。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存更改" })).toBeDisabled();
  await page.getByLabel("强调色十六进制值").fill("");
  await expect(
    page.getByText("强调色必须是 #rrggbb 形式的六位十六进制色值。"),
  ).toHaveCount(0);
});

test("危险区：三张卡片、角色禁用、删除需输入名称、转移需二次确认", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);

  await page.goto(`${WORKSPACE_PATH}/settings/danger`);
  await expect(page.getByRole("heading", { name: "危险区" })).toBeVisible();

  const exportCard = page.getByRole("region", { name: "导出数据" });
  const transferCard = page.getByRole("region", { name: "转移所有权" });
  const deleteCard = page.getByRole("region", { name: "删除工作区" });
  await expect(exportCard).toBeVisible();
  await expect(transferCard).toBeVisible();
  await expect(deleteCard).toBeVisible();

  // Export is available to every member (export:create is a read-level action).
  await expect(exportCard.getByRole("button", { name: "开始导出" })).toBeEnabled();
  await expect(exportCard.getByLabel("导出格式")).toBeEnabled();

  // Trigger the real queue call and prove the status panel reacts to it.
  const createExportCall = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/exports",
    { timeout: 30_000 },
  );
  await exportCard.getByRole("button", { name: "开始导出" }).click();
  const createdExport = await createExportCall;
  expect(createdExport.status(), await createdExport.text()).toBe(202);
  const createdExportBody = (await createdExport.json()) as {
    id: string;
    workspaceId: string;
    scope: string;
    format: string;
  };
  expect(createdExportBody.scope).toBe("workspace");
  expect(createdExportBody.format).toBe("zip");
  // The queue call carries the Workspace being edited, not "the first one".
  expect(new URL(createdExport.url()).searchParams.get("workspaceId")).toBe(
    createdExportBody.workspaceId,
  );
  evidence.danger.exportTriggered = createdExport.status() === 202;

  const currentExport = exportCard.getByRole("group", { name: "当前导出" });
  await expect(currentExport).toBeVisible({ timeout: 20_000 });
  await expect(
    currentExport
      .getByRole("button", { name: "下载导出文件" })
      .or(currentExport.getByText("正在后台生成", { exact: false }))
      .or(currentExport.getByText("导出失败", { exact: false })),
  ).toBeVisible({ timeout: 30_000 });

  // verify@roamlog.test is Admin of roamlog-crew → owner-only cards are off.
  await expect(transferCard.getByRole("button", { name: "转移所有权" })).toBeDisabled();
  await expect(transferCard.getByText("只有 Owner 可以转移所有权")).toBeVisible();
  await expect(deleteCard.getByRole("button", { name: "删除此工作区" })).toBeDisabled();
  await expect(deleteCard.getByText("只有 Owner 可以删除工作区")).toBeVisible();
  evidence.danger.adminRole = "admin";

  await shot(page, "desktop-1440-danger.png");

  // --- Owner-only confirmations on the account's own workspace --------------
  const workspacesResponse = await page.request.get(`${WEB_URL}/v1/me/workspaces`);
  expect(workspacesResponse.status()).toBe(200);
  const workspaces = (await workspacesResponse.json()) as Array<{
    slug: string;
    name: string;
    role: string;
  }>;
  const ownerWorkspace = workspaces.find((workspace) => workspace.role === "owner");
  expect(ownerWorkspace, "the verify account must own one workspace").toBeTruthy();
  evidence.danger.ownerWorkspace = ownerWorkspace?.slug ?? "";

  await page.goto(`/w/${ownerWorkspace?.slug}/settings/danger`);
  await expect(page.getByRole("heading", { name: "危险区" })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除此工作区" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "转移所有权" })).toBeEnabled();

  // Delete: the confirm button stays disabled until the exact name is typed.
  await page.getByRole("button", { name: "删除此工作区" }).click();
  const deleteDialog = page.getByRole("dialog");
  await expect(deleteDialog.getByText("删除工作区")).toBeVisible();
  const confirmDelete = deleteDialog.getByRole("button", { name: "确认删除" });
  await expect(confirmDelete).toBeDisabled();
  await deleteDialog
    .getByLabel("输入工作区名称以确认")
    .fill(ownerWorkspace?.name ?? "unknown");
  await expect(confirmDelete).toBeEnabled();
  evidence.danger.deleteGate = true;
  await deleteDialog.getByRole("button", { name: "取消" }).click();
  await expect(deleteDialog).not.toBeVisible();

  // Transfer: a second confirmation dialog, with its own confirmation button.
  await page.getByRole("button", { name: "转移所有权" }).click();
  const transferDialog = page.getByRole("dialog");
  await expect(
    transferDialog.getByRole("heading", { name: "确认转移所有权" }),
  ).toBeVisible();
  await expect(
    transferDialog.getByText("你会立即降为 Admin", { exact: false }),
  ).toBeVisible();
  await expect(transferDialog.getByRole("button", { name: "确认转移" })).toBeDisabled();
  evidence.danger.transferGate = true;
  await transferDialog.getByRole("button", { name: "取消" }).click();
  await expect(transferDialog).not.toBeVisible();
});

test("修改 Slug 后跳转到新地址，并在提示里说明 URL 变更（随后还原）", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);

  // Only the account's own archive is used here; `roamlog-crew` keeps its slug
  // so the other agents' journeys stay reachable.
  const listResponse = await page.request.get(`${WEB_URL}/v1/me/workspaces`);
  expect(listResponse.status()).toBe(200);
  const workspaces = (await listResponse.json()) as Array<{
    slug: string;
    name: string;
    role: string;
  }>;
  const ownerWorkspace = workspaces.find((workspace) => workspace.role === "owner");
  expect(ownerWorkspace, "the verify account must own one workspace").toBeTruthy();
  const originalSlug = ownerWorkspace?.slug ?? "";
  const nextSlug = `${originalSlug}-slug-check`;

  await page.goto(`/w/${originalSlug}/settings/workspace`);
  await page.getByLabel("Slug").fill(nextSlug);
  const patch = expectPatch(page);
  await page.getByRole("button", { name: "保存更改" }).click();
  expect((await patch).status()).toBe(200);

  await page.waitForURL(`**/w/${nextSlug}/settings/workspace`, { timeout: 30_000 });
  await expect(
    page.getByText(`Slug 已更新为 ${nextSlug}，页面地址已变更为 /w/${nextSlug}。`),
  ).toBeVisible();

  // Put the address back so the archive keeps its stable URL.
  await page.getByLabel("Slug").fill(originalSlug);
  const restorePatch = expectPatch(page);
  await page.getByRole("button", { name: "保存更改" }).click();
  expect((await restorePatch).status()).toBe(200);
  await page.waitForURL(`**/w/${originalSlug}/settings/workspace`, { timeout: 30_000 });
});

test("移动端 390：两个设置页无横向溢出", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await page.goto(`${WORKSPACE_PATH}/settings/workspace`);
  await expect(page.getByRole("heading", { name: "工作区设置" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "settings/workspace 390");
  await shot(page, "mobile-390-workspace.png");

  await page.goto(`${WORKSPACE_PATH}/settings/danger`);
  await expect(page.getByRole("heading", { name: "危险区" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "settings/danger 390");
  await shot(page, "mobile-390-danger.png");
});

test.afterAll(() => {
  evidence.generatedAt = new Date().toISOString();
  writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
});
