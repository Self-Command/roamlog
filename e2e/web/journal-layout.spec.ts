import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import {
  API_URL,
  OWNER_ACCOUNT,
  deleteSmokeAccount,
  provisionWorkspaceMember,
  signInViaApi,
  type SmokeAccount,
} from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

const WORKSPACE_SLUG = process.env.E2E_JOURNAL_WORKSPACE_SLUG ?? "roamlog-crew";
const IMAGE_ORIGIN = "https://journal-e2e.roamlog.test";
const OUT_DIR = path.join(process.cwd(), ".audit", "journal-layout");
const RUN_ID = `${Date.now()}`;
const ENTRY_TITLE = `E2E 排版验收 ${RUN_ID}`;
const TRIP_TITLE = `E2E 排版旅行 ${RUN_ID}`;
const VIEWER_ACCOUNT: SmokeAccount = {
  email: "e2e-journal-viewer@roamlog.test",
  password: "Roamlog-JournalViewer-Aa1!",
  name: "JournalViewer",
};

let ownerApi: APIRequestContext;
let workspaceId = "";
let tripId = "";
let entryId = "";
let shareUrl = "";

test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

function svgImage(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#18334a"/>
      <stop offset="1" stop-color="#e98a42"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <circle cx="500" cy="110" r="58" fill="#f4b860"/>
  <path d="M0 420 140 250 270 380 390 220 640 420V480H0Z" fill="#2f6f62"/>
  <text x="32" y="70" font-family="monospace" font-size="26" fill="white">${label}</text>
</svg>`;
}

async function routeJournalImages(page: Page): Promise<void> {
  await page.route(`${IMAGE_ORIGIN}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1) ?? "image";
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: svgImage(name),
    });
  });
}

function galleryAttrs(index: number) {
  return {
    src: `${IMAGE_ORIGIN}/gallery-${index}.svg`,
    alt: `图库图片 ${index}`,
    title: null,
    caption: `图库图注 ${index}`,
    width: 640,
    height: 480,
    mediaId: null,
  };
}

function entryFixture(columnCount: 2 | 3 = 2): {
  contentJson: Record<string, unknown>;
  contentHtml: string;
} {
  const gallery = [1, 2, 3].map(galleryAttrs);
  const columnLabels =
    columnCount === 2
      ? ["左栏：图文混排的第一栏。", "右栏：移动端应折叠到下一行。"]
      : [
          "左栏：图文混排的第一栏。",
          "中栏：三栏布局用于验证等宽与移动端折叠。",
          "右栏：移动端应折叠到下一行。",
        ];
  const contentJson = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "自动排版验收" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "左侧图片应该与这段文字自动环绕。" }],
      },
      {
        type: "image",
        attrs: {
          src: `${IMAGE_ORIGIN}/float.svg`,
          alt: "左侧浮动图片",
          title: null,
          caption: "左浮动图片与文字自动环绕",
          alignment: "left",
          displayWidth: 480,
          displayHeight: 320,
          linkHref: null,
          linkBlank: false,
          mediaId: null,
        },
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "这段文字用于验证图片旁边的自动换行、窄屏取消浮动，以及保存后的顺序不变。",
          },
        ],
      },
      {
        type: "gallery",
        attrs: { columns: 3 },
        content: gallery.map((attrs) => ({ type: "galleryImage", attrs })),
      },
      {
        type: "columns",
        attrs: { columns: columnCount },
        content: columnLabels.map((label, index) => ({
          type: "column",
          attrs: { index },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: label }],
            },
          ],
        })),
      },
    ],
  };
  const contentHtml = `
    <h2>自动排版验收</h2>
    <p>左侧图片应该与这段文字自动环绕。</p>
    <figure data-type="image" data-align="left">
      <img src="${IMAGE_ORIGIN}/float.svg" alt="左侧浮动图片" width="480" height="320" loading="lazy" decoding="async">
      <figcaption>左浮动图片与文字自动环绕</figcaption>
    </figure>
    <p>这段文字用于验证图片旁边的自动换行、窄屏取消浮动，以及保存后的顺序不变。</p>
    <div data-type="gallery" data-columns="3">
      ${gallery
        .map(
          (attrs) =>
            `<figure data-type="gallery-item"><img src="${attrs.src}" alt="${attrs.alt}" width="640" height="480" loading="lazy" decoding="async"><figcaption>${attrs.caption}</figcaption></figure>`,
        )
        .join("")}
    </div>
    <div data-type="columns" data-columns="${columnCount}">
      ${columnLabels
        .map(
          (label, index) =>
            `<div data-type="column" data-column-index="${index}"><p>${label}</p></div>`,
        )
        .join("")}
    </div>
  `;
  return { contentJson, contentHtml };
}

async function login(page: Page, account: SmokeAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

async function openEntry(page: Page): Promise<ReturnType<Page["locator"]>> {
  await page.goto(`/w/${WORKSPACE_SLUG}/journal`);
  await expect(page.getByRole("heading", { name: "全部日志" })).toBeVisible();
  await page.getByLabel("搜索日志").fill(ENTRY_TITLE);
  const card = page.getByRole("button", { name: new RegExp(ENTRY_TITLE) }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();

  const sheet = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: ENTRY_TITLE }) })
    .first();
  await expect(sheet).toBeVisible();
  return sheet;
}

async function assertDesktopLayout(page: Page, sheet: ReturnType<Page["locator"]>): Promise<void> {
  await expect(sheet.getByRole("textbox", { name: "日志正文" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "插入多栏" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "插入图库" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "插入图片" })).toBeVisible();

  await expect(sheet.locator('figure[data-type="image"][data-align="left"]')).toHaveCount(1);
  await expect(sheet.locator('div[data-type="gallery"][data-columns="3"]')).toHaveCount(1);
  await expect(sheet.locator('figure[data-type="gallery-item"]')).toHaveCount(3);
  await expect(sheet.getByText("图库图注 2")).toBeVisible();

  const firstColumns = sheet.locator('div[data-type="columns"][data-columns="2"]').first();
  await expect(firstColumns).toBeVisible();
  const columnBoxes = await firstColumns
    .locator('[data-type="column"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  expect(columnBoxes).toHaveLength(2);
  expect(Math.min(...columnBoxes.map((box) => box.width))).toBeGreaterThan(100);
  expect(Math.abs((columnBoxes[0]?.y ?? 0) - (columnBoxes[1]?.y ?? 0))).toBeLessThan(2);

  const galleryBoxes = await sheet
    .locator('figure[data-type="gallery-item"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  expect(new Set(galleryBoxes.map((box) => Math.round(box.x))).size).toBe(3);
}

async function assertMobileLayout(page: Page, sheet: ReturnType<Page["locator"]>): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, "journal editor 390");

  const gallery = sheet.locator('div[data-type="gallery"]').first();
  await expect(gallery).toBeVisible();
  const galleryGrid = gallery.locator("[data-node-view-content]").first();
  await expect(galleryGrid).toBeVisible();
  const galleryColumns = await galleryGrid.evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.split(/\s+/u).filter(Boolean).length,
  );
  expect(galleryColumns).toBe(2);

  const columnsContent = sheet
    .locator('div[data-type="columns"]')
    .first()
    .locator("[data-node-view-content]")
    .first();
  await expect(columnsContent).toBeVisible();
  const columnsDirection = await columnsContent.evaluate(
    (element) => getComputedStyle(element).flexDirection,
  );
  expect(columnsDirection).toBe("column");

  const imageFloat = await sheet
    .locator('figure[data-type="image"]')
    .first()
    .evaluate((element) => getComputedStyle(element).float);
  expect(imageFloat).toBe("none");

  await sheet.getByText("Controls 左栏").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(OUT_DIR, "e2e-mobile-390.png"),
    fullPage: false,
    animations: "disabled",
  });
}

async function assertShareLayout(page: Page): Promise<void> {
  await page.goto(shareUrl);
  await expect(page.getByRole("heading", { name: TRIP_TITLE })).toBeVisible();
  await expect(page.getByRole("heading", { name: ENTRY_TITLE })).toBeVisible();

  const article = page.locator(".journal-layout").first();
  await expect(article.locator('figure[data-type="image"][data-align="left"]')).toHaveCount(1);
  await expect(article.locator('div[data-type="gallery"][data-columns="3"]')).toHaveCount(1);
  await expect(article.locator('div[data-type="columns"]')).toHaveCount(2);
  await expect(article.getByText("图库图注 2")).toBeVisible();

  const galleryImage = article.locator('figure[data-type="gallery-item"] img').nth(1);
  await galleryImage.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(OUT_DIR, "e2e-share-1440.png"),
    fullPage: false,
    animations: "disabled",
  });
  await galleryImage.click();
  await expect(page.getByRole("dialog", { name: "照片查看" })).toBeVisible();
  await page.screenshot({
    path: path.join(OUT_DIR, "e2e-share-lightbox-1440.png"),
    fullPage: false,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "照片查看" })).not.toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(shareUrl);
  await expectNoHorizontalOverflow(page, "public share 390");
  const mobileArticle = page.locator(".journal-layout").first();
  const galleryColumns = await mobileArticle
    .locator('div[data-type="gallery"]')
    .first()
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(/\s+/u).filter(Boolean).length,
    );
  expect(galleryColumns).toBe(2);
  const columnsDirection = await mobileArticle
    .locator('div[data-type="columns"]')
    .first()
    .evaluate((element) => getComputedStyle(element).flexDirection);
  expect(columnsDirection).toBe("column");
  const imageFloat = await mobileArticle
    .locator('figure[data-type="image"]')
    .first()
    .evaluate((element) => getComputedStyle(element).float);
  expect(imageFloat).toBe("none");

  await mobileArticle.getByText("Controls 左栏").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(OUT_DIR, "e2e-share-390.png"),
    fullPage: false,
    animations: "disabled",
  });
}

async function assertViewerReadOnly(browser: Browser): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await routeJournalImages(page);
  try {
    await login(page, VIEWER_ACCOUNT);
    const sheet = await openEntry(page);
    await expect(sheet.getByRole("textbox", { name: "日志正文" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await expect(sheet.getByRole("toolbar", { name: "日志格式工具栏" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "写日志" })).toHaveCount(0);
    await expect(sheet.locator('div[data-type="gallery"]')).toHaveCount(1);
    await expect(sheet.locator('div[data-type="columns"]')).toHaveCount(2);
  } finally {
    await context.close();
  }
}

test.beforeAll(async () => {
  await mkdir(OUT_DIR, { recursive: true });
  ownerApi = await playwrightRequest.newContext({ baseURL: API_URL });
  await signInViaApi(ownerApi, OWNER_ACCOUNT);

  const workspacesResponse = await ownerApi.get("/v1/me/workspaces");
  expect(workspacesResponse.status(), await workspacesResponse.text()).toBe(200);
  const workspaces = (await workspacesResponse.json()) as Array<{ id: string; slug: string }>;
  workspaceId = workspaces.find((workspace) => workspace.slug === WORKSPACE_SLUG)?.id ?? "";
  expect(workspaceId, `workspace ${WORKSPACE_SLUG} must exist`).toBeTruthy();

  // The journal viewer is a real account in the same workspace. Provision it
  // per run instead of relying on a manually-created local account.
  provisionWorkspaceMember(VIEWER_ACCOUNT, WORKSPACE_SLUG, "viewer");

  const tripResponse = await ownerApi.post(`/v1/workspaces/${workspaceId}/trips`, {
    data: {
      title: TRIP_TITLE,
      startDate: "2026-11-22",
      endDate: "2026-11-24",
      origin: "上海",
      destinations: ["京都"],
      countryCodes: ["JP"],
      visibility: "workspace",
    },
  });
  expect(tripResponse.status(), await tripResponse.text()).toBe(201);
  tripId = ((await tripResponse.json()) as { id: string }).id;

  const fixture = entryFixture();
  const entryResponse = await ownerApi.post(`/v1/trips/${tripId}/entries`, {
    data: {
      title: ENTRY_TITLE,
      date: "2026-11-22",
      location: "京都",
      mood: "calm",
      weather: "sunny",
      ...fixture,
      excerpt: "自动排版、网格与多栏验收",
    },
  });
  expect(entryResponse.status(), await entryResponse.text()).toBe(201);
  entryId = ((await entryResponse.json()) as { id: string }).id;

  const shareResponse = await ownerApi.post(`/v1/trips/${tripId}/share-links`, {
    data: { allowIndex: false, showBudget: false },
  });
  expect(shareResponse.status(), await shareResponse.text()).toBe(201);
  shareUrl = ((await shareResponse.json()) as { url: string }).url;
});

test.afterAll(async () => {
  if (!ownerApi) return;
  if (tripId) {
    const response = await ownerApi.delete(`/v1/trips/${tripId}`);
    expect([200, 204], await response.text()).toContain(response.status());
  }
  await ownerApi.dispose();
  deleteSmokeAccount(VIEWER_ACCOUNT.email);
});

test("persists image, gallery and multi-column layout through the real stack", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await routeJournalImages(page);
  await login(page, OWNER_ACCOUNT);

  let sheet = await openEntry(page);
  await assertDesktopLayout(page, sheet);

  await sheet.getByRole("button", { name: "插入多栏" }).click();
  await page.getByRole("menuitem", { name: "插入 3 栏" }).click();
  const insertedColumns = sheet.locator('div[data-type="columns"][data-columns="3"]').first();
  await expect(insertedColumns).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "日志正文" })).toBeFocused();
  await page.keyboard.type("Controls 左栏");
  const controlledColumns = sheet
    .locator('div[data-type="columns"]')
    .filter({ hasText: "Controls 左栏" })
    .first();

  const columnsToolbar = page.getByRole("toolbar", { name: "多栏工具" });
  await expect(columnsToolbar).toBeVisible();
  await columnsToolbar.getByRole("button", { name: "右侧加列" }).click();
  await expect(controlledColumns).toHaveAttribute("data-columns", "4");
  await columnsToolbar.getByRole("button", { name: "删除当前列" }).click();
  await expect(controlledColumns).toHaveAttribute("data-columns", "3");

  const caption = sheet.getByLabel("图片图注");
  await caption.fill("E2E 图注持久化");
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet.getByRole("status")).toContainText("已保存", { timeout: 30_000 });

  await sheet.getByRole("button", { name: "关闭" }).click();
  await expect(sheet).not.toBeVisible();
  await page.reload();
  sheet = await openEntry(page);
  await expect(sheet.locator('div[data-type="columns"]')).toHaveCount(2);
  await expect(sheet.locator('div[data-type="columns"][data-columns="2"]')).toHaveCount(1);
  await expect(sheet.locator('div[data-type="columns"][data-columns="3"]')).toHaveCount(1);
  await expect(sheet.getByText("Controls 左栏")).toBeVisible();
  await expect(sheet.getByText("E2E 图注持久化")).toBeVisible();
  await expect(sheet.locator('figure[data-type="gallery-item"]')).toHaveCount(3);
  await expect(sheet.locator('figure[data-type="image"][data-align="left"]')).toHaveCount(1);

  await sheet.getByText("Controls 左栏").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(OUT_DIR, "e2e-desktop-1440.png"),
    fullPage: false,
    animations: "disabled",
  });

  await assertMobileLayout(page, sheet);
  await sheet.getByRole("button", { name: "关闭" }).click();
  await expect(sheet).not.toBeVisible();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await assertShareLayout(page);
  await assertViewerReadOnly(browser);

  const persisted = await ownerApi.get(`/v1/entries/${entryId}`);
  expect(persisted.status(), await persisted.text()).toBe(200);
  const persistedBody = (await persisted.json()) as { contentHtml: string };
  expect(persistedBody.contentHtml).toContain('data-type="gallery"');
  expect(persistedBody.contentHtml).toContain('data-type="columns"');
  expect(persistedBody.contentHtml).toContain('data-columns="3"');
  expect(persistedBody.contentHtml).toContain("E2E 图注持久化");

  await writeFile(
    path.join(OUT_DIR, "e2e-run.json"),
    JSON.stringify(
      {
        workspaceId,
        tripId,
        entryId,
        shareUrl,
        imagesStubbed: IMAGE_ORIGIN,
        persistedStatus: persisted.status(),
        assertions: {
          persistedHtml: true,
          desktopEditor1440: true,
          mobileEditor390: true,
          publicShare1440: true,
          publicShare390: true,
          galleryLightbox: true,
          viewerReadOnly: true,
          noHorizontalOverflow: true,
        },
        viewerFixture: VIEWER_ACCOUNT.email,
        layoutUpdate: "inserted and expanded through the browser controls",
        captionEdit: "edited and saved through the browser",
        knownDefect: null,
      },
      null,
      2,
    ),
  );
});
