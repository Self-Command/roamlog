/**
 * Provider Admin journeys.
 *
 * The suite uses the real Admin login, Better Auth TOTP, real Admin/API
 * processes, and a local OpenAI-compatible HTTP stub. The API must be started
 * with PROVIDER_EGRESS_ALLOW_PRIVATE=true in a non-production environment; CI
 * supplies that test-only setting. No product request is mocked.
 */
import {
  expect,
  request as playwrightRequest,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ADMIN_URL,
  API_URL,
  createSuperAdminAccount,
  deleteSuperAdmin,
  enableSuperAdminTotp,
  loginOnAdmin,
  provisionSuperAdmin,
  provisionWorkspaceMember,
  signInViaApi,
  type SmokeAccount,
  WEB_URL,
} from "../../support/accounts";
import { expectNoHorizontalOverflow } from "../../support/helpers";
import { startProviderStub, type ProviderStub } from "../../support/provider-stub";
import { registerFailureEvidence, uniqueRunId } from "../../support/smoke";

registerFailureEvidence(test);

const EVIDENCE_DIR = path.join(process.cwd(), ".audit", "settings-provider-e2e");
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, "provider-admin-e2e.json");
const runId = uniqueRunId();
const prefix = `e2e-provider-${runId}`;
const superAdmin = createSuperAdminAccount(runId);
const viewer: SmokeAccount = {
  email: `e2e-provider-viewer-${runId}@roamlog.test`,
  password: "Roamlog-Smoke-Aa1!",
  name: "Provider Viewer",
};

interface ProviderSummary {
  id: string;
  label: string;
  version: number;
  enabled: boolean;
  adapter: string;
  preset: string | null;
  secrets: Array<{ field: string; hasValue: boolean; last4: string | null }>;
}

interface ProviderGroup {
  version: number;
  routingMode: string;
  maxAttempts: number;
  cooldownSeconds: number;
  providers: ProviderSummary[];
}

interface Evidence {
  generatedAt: string;
  stubBaseUrl: string;
  providerLabels: string[];
  screenshots: string[];
  modelDiscoveryRequest: Record<string, unknown> | null;
  savedGroups: Record<string, unknown>;
  notes: string[];
}

const evidence: Evidence = {
  generatedAt: new Date().toISOString(),
  stubBaseUrl: "",
  providerLabels: [],
  screenshots: [],
  modelDiscoveryRequest: null,
  savedGroups: {},
  notes: [],
};

let stub: ProviderStub;
let context: BrowserContext;
let page: Page;
let superAdminTotpSecret = "";

function providerDialog(pageToUse: Page) {
  return pageToUse.getByRole("dialog", { name: /^(添加服务商|编辑服务商)$/ });
}

async function openAddProvider(pageToUse: Page) {
  await pageToUse.getByRole("button", { name: "添加服务商" }).first().click();
  const dialog = providerDialog(pageToUse);
  await expect(dialog.getByRole("heading", { name: "添加服务商", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  return dialog;
}

async function fillConfig(
  dialog: ReturnType<typeof providerDialog>,
  values: Record<string, string>,
) {
  for (const [label, value] of Object.entries(values)) {
    const field = dialog.getByLabel(label, { exact: false });
    await expect(field, `config field ${label} must exist`).toBeVisible();
    await field.fill(value);
  }
}

async function selectProviderType(
  dialog: ReturnType<typeof providerDialog>,
  label: string,
): Promise<void> {
  const select = dialog.getByLabel("类型", { exact: false });
  await expect(select).toBeVisible();
  if (await select.isEnabled()) {
    await select.selectOption({ label });
  }
}

async function saveProvider(dialog: ReturnType<typeof providerDialog>) {
  await dialog.getByRole("button", { name: "保存服务商", exact: true }).click();
}

async function waitForDialogClosed(dialog: ReturnType<typeof providerDialog>) {
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

async function addMapProvider(pageToUse: Page, label: string, typeLabel: string, apiKey: string) {
  const dialog = await openAddProvider(pageToUse);
  await dialog.getByLabel("名称", { exact: false }).fill(label);
  await selectProviderType(dialog, typeLabel);
  const region = dialog.getByRole("checkbox", {
    name: typeLabel === "腾讯地图" ? "中国" : "全球",
    exact: true,
  });
  await expect(region).toBeVisible();
  if (!(await region.isChecked())) {
    await region.click();
  }
  await expect(region).toBeChecked();
  const baseUrl = dialog.getByLabel("Base URL", { exact: false });
  if ((await baseUrl.count()) > 0 && (await baseUrl.inputValue()) === "") {
    await baseUrl.fill(
      typeLabel === "腾讯地图"
        ? "https://apis.map.qq.com/ws"
        : "https://api.geoapify.com/v1/geocode/autocomplete",
    );
  }
  await dialog.getByLabel("API Key", { exact: false }).fill(apiKey);
  await saveProvider(dialog);
  await waitForDialogClosed(dialog);
  await expect(pageToUse.getByText(label, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
}

async function readGroup(pageToUse: Page, group: "ai" | "places" | "mail" | "storage") {
  return pageToUse.evaluate(async (groupName) => {
    const response = await fetch(`/v1/admin/provider-groups/${groupName}`, {
      headers: { Accept: "application/json" },
    });
    return {
      status: response.status,
      body: (await response.json()) as ProviderGroup,
    };
  }, group);
}

async function cleanupProviders(pageToUse: Page): Promise<string[]> {
  const removed: string[] = [];
  for (const group of ["ai", "places", "mail", "storage"] as const) {
    const response = await readGroup(pageToUse, group);
    if (response.status !== 200) {
      continue;
    }
    for (const provider of response.body.providers) {
      if (!provider.label.startsWith(prefix)) {
        continue;
      }
      const status = await pageToUse.evaluate(
        async ({ id, version }) => {
          const response = await fetch(
            `/v1/admin/providers/${encodeURIComponent(id)}?expectedVersion=${version}`,
            { method: "DELETE", headers: { Accept: "application/json" } },
          );
          return response.status;
        },
        { id: provider.id, version: provider.version },
      );
      if (status < 300) {
        removed.push(provider.label);
      }
    }
  }
  return removed;
}

async function shot(pageToCapture: Page, name: string): Promise<string> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await pageToCapture.evaluate(async () => {
    await document.fonts.ready;
  });
  const target = path.join(EVIDENCE_DIR, name);
  await pageToCapture.screenshot({
    path: target,
    fullPage: true,
    animations: "disabled",
  });
  const relative = path.relative(process.cwd(), target).split(path.sep).join("/");
  evidence.screenshots.push(relative);
  return relative;
}

async function loginAsSuperAdmin(pageToUse: Page): Promise<void> {
  await pageToUse.route("**/v1/auth/sign-in/email", async (route) => {
    const response = await route.fetch({
      url: `${API_URL}/v1/auth/sign-in/email`,
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB_URL },
      postData: route.request().postData(),
    });
    await route.fulfill({ response });
  });
  await loginOnAdmin(pageToUse, superAdmin, superAdminTotpSecret);
  await expect(pageToUse.getByRole("navigation", { name: "管理后台主导航" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  expect(
    process.env.PROVIDER_EGRESS_ALLOW_PRIVATE,
    "Provider E2E requires PROVIDER_EGRESS_ALLOW_PRIVATE=true for the local stub",
  ).toBe("true");

  stub = await startProviderStub();
  evidence.stubBaseUrl = stub.baseUrl;
  provisionSuperAdmin(superAdmin);
  superAdminTotpSecret = await enableSuperAdminTotp(superAdmin);
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  await loginAsSuperAdmin(page);
});

test.afterEach(async () => {
  if (!page) {
    return;
  }
  try {
    await cleanupProviders(page);
  } catch {
    evidence.notes.push("Provider cleanup failed after a test; CI uses a disposable database.");
  }
});

test.afterAll(async () => {
  if (page) {
    try {
      await cleanupProviders(page);
    } catch {
      evidence.notes.push("Final provider cleanup failed.");
    }
  }
  evidence.providerLabels = [...new Set(evidence.providerLabels)];
  evidence.notes.push(`stub requests: ${stub?.requests.length ?? 0}`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  await context?.close();
  deleteSuperAdmin(superAdmin.email);
  await stub?.close();
});

test("map providers coexist, reorder, and expose strict priority mode", async () => {
  const tencent = `${prefix}-腾讯地图`;
  const geoapify = `${prefix}-Geoapify`;

  await page.goto(`${ADMIN_URL}/admin/services/places`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "地图服务", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await addMapProvider(page, tencent, "腾讯地图", `tencent-${runId}`);
  await addMapProvider(page, geoapify, "Geoapify", `geoapify-${runId}`);
  evidence.providerLabels.push(tencent, geoapify);

  const table = page.getByTestId("provider-table");
  await expect(table.getByText(tencent, { exact: true })).toBeVisible();
  await expect(table.getByText(geoapify, { exact: true })).toBeVisible();
  await expect(table.getByText(/••••/).first()).toBeVisible();

  await page.getByRole("button", { name: "调整顺序", exact: true }).click();
  const orderList = page.getByRole("list", { name: "服务商优先级顺序" });
  await expect(orderList).toBeVisible();
  await page.getByRole("button", { name: `${tencent}下移`, exact: true }).click();
  await page.getByRole("button", { name: "保存顺序", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "优先级顺序已保存" }).first(),
  ).toBeVisible({
    timeout: 30_000,
  });

  const afterOrder = await readGroup(page, "places");
  expect(afterOrder.status).toBe(200);
  const labels = afterOrder.body.providers
    .filter((provider) => provider.label.startsWith(prefix))
    .map((provider) => provider.label);
  expect(labels).toEqual([geoapify, tencent]);
  evidence.savedGroups.placesOrder = labels;

  const policy = await page.evaluate(async () => {
    const current = await fetch("/v1/admin/provider-groups/places", {
      headers: { Accept: "application/json" },
    });
    const group = (await current.json()) as { version: number };
    const response = await fetch("/v1/admin/provider-groups/places", {
      method: "PATCH",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        routingMode: "priority_failover",
        maxAttempts: 3,
        cooldownSeconds: 30,
        expectedVersion: group.version,
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(policy.status).toBe(200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "严格优先级回退", exact: true })).toBeVisible();

  evidence.savedGroups.placesPolicy = policy.body;
  await shot(page, "providers-map-1440.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, "provider map list 390");
  await shot(page, "providers-map-390.png");
});

test("AI provider discovers models without auto-selecting, saves masked key, and probes", async () => {
  const label = `${prefix}-Stub AI`;
  await page.goto(`${ADMIN_URL}/admin/services/ai`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "AI 服务", exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const dialog = await openAddProvider(page);
  await dialog.getByLabel("名称", { exact: false }).fill(label);
  await selectProviderType(dialog, "自定义 OpenAI 兼容");
  await dialog.getByLabel("Base URL", { exact: false }).fill(`${stub.baseUrl}/v1`);
  await dialog.getByLabel("API Key", { exact: false }).fill(`stub-key-${runId}`);
  evidence.providerLabels.push(label);

  // This assertion intentionally stays red until the model picker task lands.
  await expect(dialog.getByText(/已获取\s*2\s*个模型|2 个模型/)).toBeVisible({
    timeout: 20_000,
  });
  const modelPicker = dialog.getByLabel("默认模型", { exact: false });
  await expect(modelPicker).toHaveValue("");
  await modelPicker.click();
  await dialog.getByRole("option", { name: /stub-model-1/ }).click();
  evidence.modelDiscoveryRequest = {
    requestedAt: new Date().toISOString(),
    models: ["stub-model-1", "stub-model-2"],
  };

  await saveProvider(dialog);
  await waitForDialogClosed(dialog);
  await expect(page.getByTestId("provider-table").getByText(label, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("provider-table").getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText(/••••/).first()).toBeVisible();
  await expect(await page.content()).not.toContain(`stub-key-${runId}`);

  await page
    .getByRole("button", { name: `测试 ${label}`, exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /连接正常|测试通过|healthy/i }),
  ).toBeVisible({ timeout: 30_000 });

  await shot(page, "providers-ai-1440.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, "provider ai 390");
  await shot(page, "providers-ai-390.png");
});

test("mail and storage enforce one active provider", async () => {
  const mailA = `${prefix}-Mail A`;
  const mailB = `${prefix}-Mail B`;
  const storageA = `${prefix}-Storage A`;
  const storageB = `${prefix}-Storage B`;

  await page.goto(`${ADMIN_URL}/admin/services/mail`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "发信服务", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const mailDialog = await openAddProvider(page);
  await mailDialog.getByLabel("名称", { exact: false }).fill(mailA);
  await selectProviderType(mailDialog, "Resend");
  await fillConfig(mailDialog, {
    发件地址: `Roamlog <no-reply+${runId}@example.test>`,
  });
  await mailDialog.getByLabel("Resend API Key", { exact: false }).fill(`re_${runId}_a`);
  await saveProvider(mailDialog);
  await waitForDialogClosed(mailDialog);
  evidence.providerLabels.push(mailA);
  await expect(page.getByTestId("provider-table").getByText(mailA, { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const mailConflictDialog = await openAddProvider(page);
  await mailConflictDialog.getByLabel("名称", { exact: false }).fill(mailB);
  await selectProviderType(mailConflictDialog, "Resend");
  await fillConfig(mailConflictDialog, {
    发件地址: `Roamlog <no-reply+${runId}@example.test>`,
  });
  await mailConflictDialog.getByLabel("Resend API Key", { exact: false }).fill(`re_${runId}_b`);
  await expect(mailConflictDialog.getByRole("note").filter({ hasText: mailA })).toBeVisible({
    timeout: 30_000,
  });
  const mailEnabled = mailConflictDialog.getByRole("switch", { name: "启用服务商" });
  await expect(mailEnabled).not.toBeChecked();
  await mailEnabled.click();
  await expect(mailEnabled).toBeChecked();
  await saveProvider(mailConflictDialog);
  const mailActiveConflict = page.getByRole("dialog", {
    name: "服务商启用冲突",
    exact: true,
  });
  await expect(mailActiveConflict).toBeVisible({ timeout: 30_000 });
  await expect(mailActiveConflict).toContainText(/只允许一个启用的(?:服务商|实例)/);
  await mailActiveConflict.getByRole("button", { name: "保留草稿", exact: true }).click();
  await expect(mailActiveConflict).toBeHidden();
  await mailConflictDialog.getByRole("button", { name: "取消", exact: true }).click();
  await mailConflictDialog.getByRole("button", { name: "放弃修改", exact: true }).click();
  await waitForDialogClosed(mailConflictDialog);
  await expect(page.getByText(mailB, { exact: true })).toHaveCount(0);

  await page.goto(`${ADMIN_URL}/admin/services/storage`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "存储服务", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const storageDialog = await openAddProvider(page);
  await storageDialog.getByLabel("名称", { exact: false }).fill(storageA);
  await selectProviderType(storageDialog, "S3 兼容存储");
  await fillConfig(storageDialog, {
    "S3 Endpoint": `https://s3-${runId}.example.test`,
    Bucket: `roamlog-${runId}`,
  });
  await storageDialog.getByLabel("Access Key", { exact: false }).fill(`access-${runId}`);
  await storageDialog.getByLabel("Secret Key", { exact: false }).fill(`secret-${runId}`);
  await saveProvider(storageDialog);
  await waitForDialogClosed(storageDialog);
  evidence.providerLabels.push(storageA);
  await expect(page.getByTestId("provider-table").getByText(storageA, { exact: true })).toBeVisible(
    {
      timeout: 30_000,
    },
  );

  const storageConflictDialog = await openAddProvider(page);
  await storageConflictDialog.getByLabel("名称", { exact: false }).fill(storageB);
  await selectProviderType(storageConflictDialog, "S3 兼容存储");
  await fillConfig(storageConflictDialog, {
    "S3 Endpoint": `https://s3-${runId}.example.test`,
    Bucket: `roamlog-${runId}`,
  });
  await storageConflictDialog.getByLabel("Access Key", { exact: false }).fill(`access-${runId}`);
  await storageConflictDialog.getByLabel("Secret Key", { exact: false }).fill(`secret-${runId}`);
  await expect(storageConflictDialog.getByRole("note").filter({ hasText: storageA })).toBeVisible({
    timeout: 30_000,
  });
  const storageEnabled = storageConflictDialog.getByRole("switch", {
    name: "启用服务商",
  });
  await expect(storageEnabled).not.toBeChecked();
  await storageEnabled.click();
  await expect(storageEnabled).toBeChecked();
  await saveProvider(storageConflictDialog);
  const storageActiveConflict = page.getByRole("dialog", {
    name: "服务商启用冲突",
    exact: true,
  });
  await expect(storageActiveConflict).toBeVisible({ timeout: 30_000 });
  await expect(storageActiveConflict).toContainText(/只允许一个启用的(?:服务商|实例)/);
  await shot(page, "providers-active-conflict-1440.png");
  await storageActiveConflict.getByRole("button", { name: "保留草稿", exact: true }).click();
  await expect(storageActiveConflict).toBeHidden();
  await storageConflictDialog.getByRole("button", { name: "取消", exact: true }).click();
  await storageConflictDialog.getByRole("button", { name: "放弃修改", exact: true }).click();
  await waitForDialogClosed(storageConflictDialog);
  await expect(page.getByText(storageB, { exact: true })).toHaveCount(0);
});

test("secret reveal is explicit and never survives a reload", async () => {
  const label = `${prefix}-Secret Map`;
  const key = `secret-${runId}-only-in-dialog`;

  await page.goto(`${ADMIN_URL}/admin/services/places`, { waitUntil: "domcontentloaded" });
  await addMapProvider(page, label, "Geoapify", key);
  evidence.providerLabels.push(label);
  await page
    .getByRole("button", { name: `编辑 ${label}`, exact: true })
    .first()
    .click();
  const dialog = providerDialog(page);
  await expect(dialog.getByText(/••••/)).toBeVisible();
  await expect(dialog.getByLabel("API Key", { exact: false })).toHaveValue("");

  await dialog.getByRole("button", { name: "显示明文", exact: true }).click();
  await expect(dialog.getByText("确认显示这个密钥？", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确认显示", exact: true }).click();
  await expect(dialog.getByLabel("API Key", { exact: false })).toHaveValue(key);
  await dialog.getByRole("button", { name: "立即隐藏", exact: true }).click();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(await page.content()).not.toContain(key);
  await expect(page.getByTestId("provider-table").getByText(/••••/).first()).toBeVisible();
});

test("non-super-admin cannot call the provider admin API", async () => {
  provisionWorkspaceMember(viewer, "verify-crew", "viewer");
  const api = await playwrightRequest.newContext({ baseURL: API_URL });
  try {
    await signInViaApi(api, viewer);
    const response = await api.get("/v1/admin/provider-groups/ai", {
      headers: { origin: ADMIN_URL, Accept: "application/json" },
    });
    expect([401, 403]).toContain(response.status());
  } finally {
    await api.dispose();
    deleteSuperAdmin(viewer.email);
  }
});
