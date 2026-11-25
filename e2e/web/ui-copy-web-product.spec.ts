import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  API_URL,
  OWNER_ACCOUNT,
  WEB_URL,
  WORKSPACE_SLUG,
  findWorkspace,
  provisionWorkspaceMember,
  signInViaApi,
  type SmokeAccount,
} from "../support/accounts";

const OUT_DIR = path.resolve(process.cwd(), ".audit", "release-blockers", "web-copy");
const SHARE_TOKEN = "roamlog-demo-share-2026-kyoto-trip";
const AI_ACCOUNT: SmokeAccount = {
  email: "copy-product-ai@roamlog.test",
  password: "Copy-Product-Aa1!",
  name: "文案验收账号",
};

type Width = 1440 | 390;

interface ScreenshotEvidence {
  name: string;
  width: Width;
  path: string;
  overflow: number;
}

const evidence: {
  generatedAt: string;
  baseUrl: string;
  workspace: string | null;
  tripId: string | null;
  screenshots: ScreenshotEvidence[];
  aiComposerHeight: number | null;
  aiComposerMobileHeight: number | null;
  assertions: string[];
} = {
  generatedAt: new Date().toISOString(),
  baseUrl: WEB_URL,
  workspace: null,
  tripId: null,
  screenshots: [],
  aiComposerHeight: null,
  aiComposerMobileHeight: null,
  assertions: [],
};

async function hideDevTools(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button]{display:none!important}",
  });
}

async function shot(page: Page, name: string, width: Width): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.waitForTimeout(250);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} ${width}px horizontal overflow`).toBeLessThanOrEqual(1);
  await hideDevTools(page);
  const screenshotPath = path.join(OUT_DIR, `${name}-${width}.png`);
  await page.screenshot({
    path: screenshotPath,
    animations: "disabled",
    fullPage: width === 1440,
  });
  evidence.screenshots.push({
    name,
    width,
    path: path.relative(process.cwd(), screenshotPath).split(path.sep).join("/"),
    overflow,
  });
}

async function expectNoInternalCopy(page: Page): Promise<void> {
  for (const pattern of [
    /TOTAL JOURNEYS/u,
    /DAYS ON THE ROAD/u,
    /TRIP LIBRARY/u,
    /\bCOVER\b/u,
    /\bLOGO\b/iu,
    /JOURNAL \//u,
    /\bVERSION\b/u,
    /\bMINOR\b/u,
    /GEOTAGGED PHOTOS/u,
    /\bAPPROX\b/u,
    /\bViewer\b/u,
    /服务器/u,
  ]) {
    await expect(page.getByText(pattern)).toHaveCount(0);
  }
}

async function ensureAiSession(page: Page): Promise<void> {
  try {
    await signInViaApi(page.request, AI_ACCOUNT);
    return;
  } catch {
    provisionWorkspaceMember(AI_ACCOUNT, WORKSPACE_SLUG, "editor");
    await signInViaApi(page.request, AI_ACCOUNT);
  }
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.afterAll(() => {
  writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
});

test("product pages use user-facing Chinese copy at 1440 and 390", async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await signInViaApi(page.request, OWNER_ACCOUNT);
  const workspace = await findWorkspace(page.request);
  evidence.workspace = workspace.slug;

  const tripsResponse = await page.request.get(
    `${API_URL}/v1/workspaces/${workspace.id}/trips?limit=1`,
  );
  expect(tripsResponse.status(), await tripsResponse.text()).toBe(200);
  const trips = (await tripsResponse.json()) as {
    items: Array<{ id: string; title: string }>;
  };
  const trip = trips.items[0];
  expect(trip, "copy acceptance needs one real trip").toBeTruthy();
  evidence.tripId = trip!.id;

  const workspacePath = encodeURIComponent(workspace.slug);

  await page.goto(`${WEB_URL}/w/${workspacePath}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "旅行总览" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("旅行总数", { exact: true })).toBeVisible();
  await expect(page.getByText("累计天数", { exact: true })).toBeVisible();
  await expectNoInternalCopy(page);
  evidence.assertions.push("dashboard Chinese metrics");
  await shot(page, "dashboard", 1440);
  await shot(page, "dashboard", 390);

  await page.goto(`${WEB_URL}/w/${workspacePath}/trips`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "旅行库" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(`${workspace.name} / 旅行库`, { exact: true })).toBeVisible();
  await expectNoInternalCopy(page);
  evidence.assertions.push("trip library Chinese eyebrow");
  await shot(page, "trips", 1440);
  await shot(page, "trips", 390);

  await page.goto(`${WEB_URL}/w/${workspacePath}/trips/${trip!.id}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1, name: trip!.title })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/版本\s+\d+/u)).toHaveCount(0);
  await expectNoInternalCopy(page);
  evidence.assertions.push("trip workspace Chinese version and permissions");
  await shot(page, "trip-detail", 1440);
  await shot(page, "trip-detail", 390);
  await page.getByLabel("选择旅行封面").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "只支持" }).first(),
  ).toContainText(/JPEG.*PNG.*WebP/u);
  await expect(page.getByText(/浏览器无法显示这个图片格式/)).toHaveCount(0);
  await expect(page.getByText(/上传后会转换为兼容格式/)).toHaveCount(0);
  evidence.assertions.push("cover upload validation uses user-facing Chinese copy");
  await shot(page, "upload-error", 1440);

  await page.goto(`${WEB_URL}/w/${workspacePath}/journal`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "全部日志" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/^日志 \/ \d+ 篇$/u)).toBeVisible();
  await expectNoInternalCopy(page);
  evidence.assertions.push("journal Chinese eyebrow");
  await shot(page, "journal", 1440);
  await shot(page, "journal", 390);

  await page.goto(`${WEB_URL}/w/${workspacePath}/settings/workspace`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "工作区设置" })).toBeVisible({
    timeout: 30_000,
  });
  await expectNoInternalCopy(page);
  evidence.assertions.push("workspace settings Chinese copy");
  await shot(page, "workspace-settings", 1440);
  await shot(page, "workspace-settings", 390);
});

test("AI empty state keeps generic prompts inside the page and composer compact", async ({
  page,
}) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await ensureAiSession(page);
  const workspace = await findWorkspace(page.request);
  const deleted = await page.request.delete(
    `${API_URL}/v1/workspaces/${workspace.id}/ai/conversations`,
    { headers: { origin: WEB_URL } },
  );
  expect([200, 204], await deleted.text()).toContain(deleted.status());
  const workspacePath = encodeURIComponent(workspace.slug);

  await page.goto(`${WEB_URL}/w/${workspacePath}/ai`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "AI 旅行助手" })).toBeVisible({
    timeout: 30_000,
  });
  const composer = page.getByTestId("multimodal-input");
  const suggested = page.getByTestId("suggested-actions");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect(suggested).toBeVisible({ timeout: 30_000 });
  await expect(suggested.getByRole("button")).toHaveCount(4);
  await expect(suggested.getByText("帮我规划一次旅行", { exact: true })).toBeVisible();
  await expect(suggested.getByText("比较几个目的地", { exact: true })).toBeVisible();
  await expect(suggested.getByText("整理行程和预算", { exact: true })).toBeVisible();
  await expect(suggested.getByText("写一篇旅行日志", { exact: true })).toBeVisible();
  await expect(suggested.getByText(/京都|成都|杭州/u)).toHaveCount(0);
  expect(
    await composer.evaluate((node) => {
      const prompts = document.querySelector('[data-testid="suggested-actions"]');
      return prompts ? node.contains(prompts) : false;
    }),
  ).toBe(false);

  await page.setViewportSize({ width: 1440, height: 1000 });
  const desktopBox = await composer.boundingBox();
  expect(desktopBox?.height ?? 0).toBeGreaterThanOrEqual(40);
  expect(desktopBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(160);
  evidence.aiComposerHeight = Math.round(desktopBox?.height ?? 0);
  evidence.assertions.push("AI generic prompts and bounded desktop composer");
  await shot(page, "ai-empty", 1440);
  const composerRoot = page.getByTestId("composer-root");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileBox = await composerRoot.boundingBox();
  expect(mobileBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(150);
  evidence.aiComposerMobileHeight = Math.round(mobileBox?.height ?? 0);
  await shot(page, "ai-empty", 390);
});

test("public share uses Chinese copy at 1440 and 390", async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await signInViaApi(page.request, OWNER_ACCOUNT);
  expect(evidence.tripId, "the product-page test must have found a real trip").toBeTruthy();
  const createdResponse = await page.request.post(
    `${API_URL}/v1/trips/${evidence.tripId}/share-links`,
    {
      data: { showBudget: true },
      headers: { origin: WEB_URL },
    },
  );
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const created = (await createdResponse.json()) as {
    id: string;
    token: string;
    url: string;
  };

  try {
    const sharePath = new URL(created.url).pathname;
    const response = await page.goto(`${WEB_URL}${sharePath}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "real public share must resolve").toBe(200);
    await expect(page.getByText("来自 Roamlog 的分享", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    for (const text of [
      "Shared from Roamlog",
      "ROUTE MAP /",
      "MAPPED STOPS",
      "BUDGET /",
      "END OF SHARED ARCHIVE",
      "Create your own travel archive",
    ]) {
      await expect(page.getByText(text, { exact: false })).toHaveCount(0);
    }
    await expectNoInternalCopy(page);
    await expect(page.getByText(/约\s*US\$0|US\$0/u)).toHaveCount(0);
    await expect(page.getByText(/^\s*\/\s*\d+\s*天$/u)).toHaveCount(0);
    await expect(page.getByText(/未填写\s*→/u)).toHaveCount(0);
    const brokenImages = await page.locator("img").evaluateAll((images) =>
      images.filter((image) => image.complete && image.naturalWidth === 0).length,
    );
    expect(brokenImages, "real share evidence must not contain broken images").toBe(0);
    await shot(page, "public-share", 1440);
    await shot(page, "public-share", 390);
  } finally {
    await page.request
      .delete(`${API_URL}/v1/share-links/${created.id}`, {
        headers: { origin: WEB_URL },
      })
      .catch(() => undefined);
  }

  await page.goto(`${WEB_URL}/share/${SHARE_TOKEN}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText(/路线地图 \/ \d+ 个已定位停靠点/u)).toBeVisible({
    timeout: 30_000,
  });
  await expectNoInternalCopy(page);
  evidence.assertions.push("clean public share copy and seeded route map");
});
