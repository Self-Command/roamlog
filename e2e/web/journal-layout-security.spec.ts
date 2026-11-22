import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { API_URL, OWNER_ACCOUNT, signInViaApi } from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

const WORKSPACE_SLUG = "verify-crew";
const IMAGE_ORIGIN = "https://journal-security.roamlog.test";
const OUT_DIR = path.join(process.cwd(), ".audit", "journal-layout");
const RUN_ID = `${Date.now()}`;
const ENTRY_TITLE = `安全排版验收 ${RUN_ID}`;
const TRIP_TITLE = `安全排版旅行 ${RUN_ID}`;
const SAFE_LINK = "https://example.com/safe";
const SAFE_IMAGE_LINK = "https://example.com/image";

let ownerApi: APIRequestContext;
let workspaceId = "";
let tripId = "";
let entryId = "";
let shareUrl = "";

test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

function unsafeJson(): Record<string, unknown> {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "安全排版验收" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "安全链接",
            marks: [
              {
                type: "link",
                attrs: { href: SAFE_LINK, target: "_blank" },
              },
            ],
          },
          { type: "text", text: " 危险链接" },
          {
            type: "text",
            text: "危险链接文本",
            marks: [
              {
                type: "link",
                attrs: { href: "javascript:alert(1)", target: "_blank" },
              },
            ],
          },
          {
            type: "text",
            text: "数据链接文本",
            marks: [
              {
                type: "link",
                attrs: { href: "data:text/html,<script>alert(2)</script>" },
              },
            ],
          },
          {
            type: "text",
            text: " protocol-relative",
            marks: [
              {
                type: "link",
                attrs: { href: "//evil.example/steal" },
              },
            ],
          },
          {
            type: "text",
            text: " backslash",
            marks: [
              {
                type: "link",
                attrs: { href: "/\\evil.example" },
              },
            ],
          },
        ],
      },
      {
        type: "image",
        attrs: {
          src: `${IMAGE_ORIGIN}/safe.svg`,
          alt: "安全图片",
          title: null,
          caption: "安全图片",
          alignment: "right",
          displayWidth: 320,
          displayHeight: 240,
          linkHref: SAFE_IMAGE_LINK,
          linkBlank: true,
          mediaId: null,
        },
      },
      {
        type: "gallery",
        attrs: { columns: 2 },
        content: [
          {
            type: "galleryImage",
            attrs: {
              src: `${IMAGE_ORIGIN}/gallery.svg`,
              alt: "安全图库",
              title: null,
              caption: "安全图库图注",
              width: 640,
              height: 480,
              mediaId: null,
            },
          },
        ],
      },
      {
        type: "columns",
        attrs: { columns: 2 },
        content: [
          {
            type: "column",
            attrs: { index: 0 },
            content: [{ type: "paragraph", content: [{ type: "text", text: "左栏" }] }],
          },
          {
            type: "column",
            attrs: { index: 1 },
            content: [{ type: "paragraph", content: [{ type: "text", text: "右栏" }] }],
          },
        ],
      },
    ],
  };
}

function unsafeHtml(): string {
  return `
    <h2>安全排版验收</h2>
    <p>
      <a href="${SAFE_LINK}" target="_blank" rel="opener">安全链接</a>
      <a href="javascript:alert(1)" target="_blank">危险链接文本</a>
      <a href="data:text/html,boom">数据链接文本</a>
    </p>
    <figure data-type="image" data-align="right" class="evil" style="display:none" onclick="alert(1)">
      <a href="${SAFE_IMAGE_LINK}" target="_blank" rel="opener">
        <img src="${IMAGE_ORIGIN}/safe.svg" alt="安全图片" width="320" height="240"
          loading="eager" decoding="sync" class="evil" style="width:9999px"
          srcset="javascript:alert(1) 1x" onerror="alert(2)">
      </a>
      <figcaption>安全图片</figcaption>
    </figure>
    <figure data-type="image" data-align="diagonal">
      <img src="javascript:alert(3)" alt="坏图" onerror="alert(4)">
    </figure>
    <figure data-type="image" data-align="left">
      <figcaption>空图不该留下</figcaption>
    </figure>
    <div data-type="gallery" data-columns="2">
      <figure data-type="gallery-item">
        <figcaption>空图库项</figcaption>
      </figure>
    </div>
    <div data-type="gallery" data-columns="99" data-extra="x" class="evil">
      <figure data-type="gallery-item" onmouseover="alert(5)">
        <img src="${IMAGE_ORIGIN}/gallery.svg" alt="安全图库" class="evil">
        <figcaption>安全图库图注</figcaption>
      </figure>
    </div>
    <div data-type="columns" data-columns="99" data-extra="x">
      <div data-type="column" data-column-index="99">
        <p>左栏</p>
      </div>
      <div data-type="column" data-column-index="1">
        <p>右栏</p>
      </div>
    </div>
    <script>alert(6)</script>
  `;
}

function unsafeContent(): { contentJson: Record<string, unknown>; contentHtml: string } {
  return { contentJson: unsafeJson(), contentHtml: unsafeHtml() };
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(OWNER_ACCOUNT.email);
  await page.getByLabel("密码").fill(OWNER_ACCOUNT.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

async function openEntry(page: Page): Promise<Locator> {
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

async function assertSanitizedHtml(html: string): Promise<void> {
  expect(html).toContain(SAFE_LINK);
  expect(html).toContain(SAFE_IMAGE_LINK);
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('data-type="image"');
  expect(html).toContain('data-align="right"');
  expect(html).toContain('data-type="gallery"');
  expect(html).toContain('data-columns="3"');
  expect(html).toContain('data-type="columns"');
  expect(html).toContain('data-columns="2"');
  expect(html).toContain('data-column-index="0"');
  expect(html).not.toMatch(/data-align="diagonal"/i);
  expect(html).not.toMatch(/javascript:/i);
  expect(html).not.toMatch(/data:text\/html/i);
  expect(html).not.toMatch(/onerror|onclick|onmouseover/i);
  expect(html).not.toMatch(/\sstyle=/i);
  expect(html).not.toMatch(/\sclass=/i);
  expect(html).not.toMatch(/\ssrcset=/i);
  expect(html).not.toMatch(/data-extra/i);
  expect(html).not.toMatch(/<script/i);
  expect(html).toContain("危险链接文本");
  expect(html).not.toContain("空图不该留下");
  expect(html).not.toContain("空图库项");
  expect(html).not.toMatch(/<a(?![^>]*\bhref=)[^>]*>/i);
  expect(html).not.toMatch(/<a\b[^>]*>[^<]*危险链接文本/i);
}

async function assertNoEmptyImageStructures(root: Locator): Promise<void> {
  await expect(root.locator('figure[data-type="image"]:not(:has(img[src]))')).toHaveCount(0);
  await expect(root.locator('figure[data-type="gallery-item"]:not(:has(img[src]))')).toHaveCount(0);
}

async function assertDangerousAnchorsAbsent(root: Locator): Promise<void> {
  await expect(root.locator('a[href^="javascript:"], a[href^="data:"], a[href^="//"]')).toHaveCount(
    0,
  );
  await expect(root.locator("a:not([href])")).toHaveCount(0);
  await expect(root.locator("a", { hasText: "危险链接文本" })).toHaveCount(0);
  await expect(root.getByText("危险链接文本", { exact: false }).first()).toBeVisible();
}

function assertNoDangerousJsonHref(value: unknown): void {
  const json = JSON.stringify(value);
  expect(json).not.toContain('"href":"javascript:');
  expect(json).not.toContain('"href":"data:text/html');
  expect(json).not.toContain('"href":"//evil.example');
  expect(json).not.toContain('"href":"/\\\\evil.example');
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

  const entryResponse = await ownerApi.post(`/v1/trips/${tripId}/entries`, {
    data: {
      title: ENTRY_TITLE,
      date: "2026-11-22",
      location: "京都",
      mood: "calm",
      weather: "sunny",
      ...unsafeContent(),
      excerpt: "安全排版真实栈验收",
    },
  });
  expect(entryResponse.status(), await entryResponse.text()).toBe(201);
  const created = (await entryResponse.json()) as {
    id: string;
    contentJson: Record<string, unknown>;
    contentHtml: string;
  };
  entryId = created.id;
  await assertSanitizedHtml(created.contentHtml);
  expect(JSON.stringify(created.contentJson)).toContain(SAFE_LINK);
  expect(JSON.stringify(created.contentJson)).toContain('"target":"_blank"');
  expect(JSON.stringify(created.contentJson)).toContain('"rel":"noopener noreferrer"');
  assertNoDangerousJsonHref(created.contentJson);

  const shareResponse = await ownerApi.post(`/v1/trips/${tripId}/share-links`, {
    data: { allowIndex: false, showBudget: false },
  });
  expect(shareResponse.status(), await shareResponse.text()).toBe(201);
  shareUrl = ((await shareResponse.json()) as { url: string }).url;

  await writeFile(
    path.join(OUT_DIR, "security-e2e-created.json"),
    JSON.stringify({ entryId, shareUrl, created }, null, 2),
  );
});

test.afterAll(async () => {
  if (!ownerApi) return;
  if (tripId) {
    const response = await ownerApi.delete(`/v1/trips/${tripId}`);
    expect([200, 204], await response.text()).toContain(response.status());
  }
  await ownerApi.dispose();
});

test("keeps safe layout and removes dangerous JSON/HTML in detail and share", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.context().route(`${IMAGE_ORIGIN}/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#18334a"/></svg>',
    });
  });
  await page.context().route("https://example.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>safe</title>" });
  });

  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await login(page);
  const sheet = await openEntry(page);
  await assertDangerousAnchorsAbsent(sheet);
  await assertNoEmptyImageStructures(sheet);
  await expect(sheet.locator(`a[href="${SAFE_LINK}"]`)).toHaveAttribute("target", "_blank");
  await expect(sheet.locator('figure[data-type="image"][data-align="right"]')).toHaveCount(1);
  await expect(sheet.locator('figure[data-type="image"]')).toHaveCount(1);
  await expect(sheet.locator('figure[data-type="gallery-item"]')).toHaveCount(1);
  // The detail editor renders contentJson, whose gallery is legitimately 2
  // columns; the malicious HTML value 99 is normalized to 3 for the share view.
  await expect(sheet.locator('div[data-type="gallery"][data-columns="2"]')).toHaveCount(1);
  await expect(sheet.locator('div[data-type="columns"][data-columns="2"]')).toHaveCount(1);
  await expect(sheet.locator('[data-type="column"][data-column-index="0"]')).toHaveCount(1);

  const persistedResponse = await ownerApi.get(`/v1/entries/${entryId}`);
  expect(persistedResponse.status(), await persistedResponse.text()).toBe(200);
  const persisted = (await persistedResponse.json()) as {
    contentJson: Record<string, unknown>;
    contentHtml: string;
  };
  await assertSanitizedHtml(persisted.contentHtml);
  expect(JSON.stringify(persisted.contentJson)).toContain(SAFE_LINK);
  expect(JSON.stringify(persisted.contentJson)).toContain('"target":"_blank"');
  expect(JSON.stringify(persisted.contentJson)).toContain('"rel":"noopener noreferrer"');
  assertNoDangerousJsonHref(persisted.contentJson);

  await page.screenshot({
    path: path.join(OUT_DIR, "security-e2e-detail-1440.png"),
    fullPage: false,
    animations: "disabled",
  });

  await sheet.getByRole("button", { name: "关闭" }).click();
  const sharePage = await page.context().newPage();
  await sharePage.setViewportSize({ width: 1440, height: 1000 });
  await sharePage.goto(shareUrl, { waitUntil: "domcontentloaded" });
  const article = sharePage.locator(".journal-layout").first();
  await expect(article).toBeVisible();
  await assertDangerousAnchorsAbsent(article);
  await assertNoEmptyImageStructures(article);
  await expect(article.locator(`a[href="${SAFE_LINK}"]`)).toHaveAttribute("target", "_blank");
  await expect(article.locator('figure[data-type="image"][data-align="right"]')).toHaveCount(1);
  await expect(article.locator('figure[data-type="image"]')).toHaveCount(1);
  await expect(article.locator('figure[data-type="gallery-item"]')).toHaveCount(1);
  await expect(article.locator('div[data-type="gallery"][data-columns="3"]')).toHaveCount(1);
  await expect(article.locator('div[data-type="columns"][data-columns="2"]')).toHaveCount(1);

  const safeLink = article.locator(`a[href="${SAFE_LINK}"]`);
  const popupPromise = sharePage.waitForEvent("popup");
  await safeLink.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/https:\/\/example\.com\/safe/u);
  await popup.close();

  await expectNoHorizontalOverflow(sharePage, "security share 1440");
  await sharePage.screenshot({
    path: path.join(OUT_DIR, "security-e2e-share-1440.png"),
    fullPage: false,
    animations: "disabled",
  });

  await sharePage.setViewportSize({ width: 390, height: 844 });
  await sharePage.reload();
  await expectNoHorizontalOverflow(sharePage, "security share 390");
  await sharePage.screenshot({
    path: path.join(OUT_DIR, "security-e2e-share-390.png"),
    fullPage: false,
    animations: "disabled",
  });

  expect(dialogs).toEqual([]);
  await writeFile(
    path.join(OUT_DIR, "security-e2e-run.json"),
    JSON.stringify(
      {
        entryId,
        shareUrl,
        persistedHtmlSanitized: true,
        safeLinkTarget: await safeLink.getAttribute("target"),
        dangerousTextPreserved: await article
          .getByText("危险链接文本", { exact: false })
          .first()
          .isVisible(),
        dangerousTextAnchors: await article.locator("a", { hasText: "危险链接文本" }).count(),
        emptyAnchors: await article.locator("a:not([href])").count(),
        emptyImageFigures: await article
          .locator('figure[data-type="image"]:not(:has(img[src]))')
          .count(),
        emptyGalleryItems: await article
          .locator('figure[data-type="gallery-item"]:not(:has(img[src]))')
          .count(),
        safeImageFigures: await article.locator('figure[data-type="image"]').count(),
        safeGalleryItems: await article.locator('figure[data-type="gallery-item"]').count(),
        galleryColumns: await article
          .locator('div[data-type="gallery"]')
          .first()
          .getAttribute("data-columns"),
        columnsColumns: await article
          .locator('div[data-type="columns"]')
          .first()
          .getAttribute("data-columns"),
        dialogs,
      },
      null,
      2,
    ),
  );
  await sharePage.close();
});
