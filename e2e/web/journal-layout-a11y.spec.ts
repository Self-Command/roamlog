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
const IMAGE_ORIGIN = "https://journal-a11y.roamlog.test";
const OUT_DIR = path.join(process.cwd(), ".audit", "journal-layout");
const RUN_ID = `${Date.now()}`;
const ENTRY_TITLE = `A11Y 排版验收 ${RUN_ID}`;
const TRIP_TITLE = `A11Y 排版旅行 ${RUN_ID}`;

let ownerApi: APIRequestContext;
let workspaceId = "";
let tripId = "";
let shareUrl = "";

test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

function svgImage(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#18334a"/>
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

function galleryImage(index: number) {
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

function entryFixture(): {
  contentJson: Record<string, unknown>;
  contentHtml: string;
} {
  const images = [1, 2].map(galleryImage);
  const contentJson = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "键盘排版验收" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "键盘测试段落。" }],
      },
      {
        type: "image",
        attrs: {
          src: `${IMAGE_ORIGIN}/hero.svg`,
          alt: "键盘测试图片",
          title: null,
          caption: "键盘测试图注",
          alignment: "left",
          displayWidth: 480,
          displayHeight: 320,
          linkHref: null,
          linkBlank: false,
          mediaId: null,
        },
      },
      {
        type: "gallery",
        attrs: { columns: 2 },
        content: images.map((attrs) => ({ type: "galleryImage", attrs })),
      },
      {
        type: "columns",
        attrs: { columns: 2 },
        content: [
          {
            type: "column",
            attrs: { index: 0 },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "左栏键盘测试" }],
              },
            ],
          },
          {
            type: "column",
            attrs: { index: 1 },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "右栏键盘测试" }],
              },
            ],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "列表 Tab 测试" }],
              },
            ],
          },
        ],
      },
    ],
  };
  const contentHtml = `
    <h2>键盘排版验收</h2>
    <p>键盘测试段落。</p>
    <figure data-type="image" data-align="left">
      <img src="${IMAGE_ORIGIN}/hero.svg" alt="键盘测试图片" width="480" height="320" loading="lazy" decoding="async">
      <figcaption>键盘测试图注</figcaption>
    </figure>
    <div data-type="gallery" data-columns="2">
      ${images
        .map(
          (image) =>
            `<figure data-type="gallery-item"><img src="${image.src}" alt="${image.alt}" width="640" height="480" loading="lazy" decoding="async"><figcaption>${image.caption}</figcaption></figure>`,
        )
        .join("")}
    </div>
    <div data-type="columns" data-columns="2">
      <div data-type="column" data-column-index="0"><p>左栏键盘测试</p></div>
      <div data-type="column" data-column-index="1"><p>右栏键盘测试</p></div>
    </div>
    <ul><li><p>列表 Tab 测试</p></li></ul>
  `;

  return { contentJson, contentHtml };
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

async function openAuthenticatedEntry(page: Page): Promise<Locator> {
  await routeJournalImages(page);
  await login(page);
  return openEntry(page);
}

async function selectedColumnIndex(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    return (
      element?.closest<HTMLElement>('[data-type="column"]')?.getAttribute("data-column-index") ??
      null
    );
  });
}

async function activeAriaLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement ? active.getAttribute("aria-label") : null;
  });
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

  const fixture = entryFixture();
  const entryResponse = await ownerApi.post(`/v1/trips/${tripId}/entries`, {
    data: {
      title: ENTRY_TITLE,
      date: "2026-11-22",
      location: "京都",
      mood: "calm",
      weather: "sunny",
      ...fixture,
      excerpt: "键盘与可访问性验收",
    },
  });
  expect(entryResponse.status(), await entryResponse.text()).toBe(201);

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
});

test("keeps the format toolbar and image settings keyboard accessible", async ({ page }) => {
  test.setTimeout(120_000);
  const sheet = await openAuthenticatedEntry(page);
  const toolbar = sheet.getByRole("toolbar", { name: "日志格式工具栏" });
  await expect(toolbar).toBeVisible();

  const buttons = await toolbar.getByRole("button").all();
  expect(buttons.length).toBeGreaterThan(20);
  for (const button of buttons) {
    await expect(button).toHaveAttribute("aria-label", /\S+/u);
    const tabIndex = await button.evaluate((element) => element.tabIndex);
    expect(tabIndex).toBeGreaterThanOrEqual(0);
  }

  let firstButton: Locator | undefined;
  for (const button of buttons) {
    if (!(await button.isDisabled())) {
      firstButton = button;
      break;
    }
  }
  expect(firstButton).toBeTruthy();
  await firstButton!.focus();
  await page.keyboard.press("Tab");
  expect(await activeAriaLabel(page)).not.toBeNull();

  const image = sheet.locator('figure[data-type="image"] img');
  await image.scrollIntoViewIfNeeded();
  await image.click();

  const imageToolbar = page.getByRole("toolbar", { name: "图片工具" });
  await expect(imageToolbar).toBeVisible();
  const defaultAlignment = imageToolbar.getByRole("button", { name: "默认对齐" });
  const leftAlignment = imageToolbar.getByRole("button", { name: "左浮动" });
  await expect(leftAlignment).toHaveAttribute("aria-pressed", "true");
  await expect(defaultAlignment).toHaveAttribute("aria-pressed", "false");

  await defaultAlignment.focus();
  await page.keyboard.press("Enter");
  await expect(defaultAlignment).toHaveAttribute("aria-pressed", "true");
  await expect(leftAlignment).toHaveAttribute("aria-pressed", "false");

  const settings = imageToolbar.getByRole("button", { name: "图片设置" });
  await settings.focus();
  await page.keyboard.press("Enter");
  const form = page.getByRole("form", { name: "图片设置表单" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("替代文本")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form).not.toBeVisible();
  // Radix closes the portal on one frame and the NodeView restores its toolbar
  // on the next. Wait for the trigger to be mounted again before asserting
  // focus; otherwise a loaded CI runner can observe the gap as "not focused".
  await expect(settings).toBeVisible({ timeout: 10_000 });
  await expect(settings).toBeFocused({ timeout: 10_000 });
});

test("navigates columns and activates the column toolbar with the keyboard", async ({ page }) => {
  test.setTimeout(120_000);
  const sheet = await openAuthenticatedEntry(page);
  const columns = sheet.locator('div[data-type="columns"]').first();
  await expect(columns).toHaveAttribute("data-columns", "2");

  await sheet.getByText("左栏键盘测试").click();
  await expect(page.getByRole("toolbar", { name: "多栏工具" })).toBeVisible();
  expect(await selectedColumnIndex(page)).toBe("0");

  await page.keyboard.press("Tab");
  expect(await selectedColumnIndex(page)).toBe("1");
  await page.keyboard.press("Shift+Tab");
  expect(await selectedColumnIndex(page)).toBe("0");

  const columnsToolbar = page.getByRole("toolbar", { name: "多栏工具" });
  const addAfter = columnsToolbar.getByRole("button", { name: "右侧加列" });
  await addAfter.focus();
  await page.keyboard.press("Enter");
  await expect(columns).toHaveAttribute("data-columns", "3");

  const deleteColumn = columnsToolbar.getByRole("button", { name: "删除当前列" });
  await deleteColumn.focus();
  await page.keyboard.press("Enter");
  await expect(columns).toHaveAttribute("data-columns", "2");

  const listText = sheet.getByText("列表 Tab 测试");
  await listText.scrollIntoViewIfNeeded();
  await listText.click();
  const selectionAfterListClick = await page.evaluate(() => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    return {
      text: selection?.toString() ?? "",
      anchorText: node?.textContent ?? null,
      column: element
        ?.closest<HTMLElement>('[data-type="column"]')
        ?.getAttribute("data-column-index"),
      activeTag: document.activeElement?.tagName ?? null,
      activeLabel: document.activeElement?.getAttribute("aria-label"),
    };
  });
  expect(
    selectionAfterListClick.column ?? null,
    JSON.stringify(selectionAfterListClick),
  ).toBeNull();
  await expect(page.getByRole("toolbar", { name: "多栏工具" })).not.toBeVisible();
  await page.keyboard.press("Tab");
  expect(await selectedColumnIndex(page), JSON.stringify(selectionAfterListClick)).toBeNull();
});

test("opens gallery previews by keyboard and restores focus on the public share", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const sheet = await openAuthenticatedEntry(page);
  const galleryImage = sheet.locator('figure[data-type="gallery-item"] img').nth(1);
  await galleryImage.scrollIntoViewIfNeeded();
  await galleryImage.click();

  const galleryToolbar = page.getByRole("toolbar", { name: "图库工具" });
  await expect(galleryToolbar).toBeVisible();
  const preview = galleryToolbar.getByRole("button", { name: "预览图库" });
  await preview.focus();
  await page.keyboard.press("Enter");

  const lightbox = page.getByRole("dialog", { name: "照片查看" });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByAltText("图库图片 1").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lightbox).not.toBeVisible();
  await expect(page.getByRole("button", { name: "预览图库" })).toBeFocused({
    timeout: 5_000,
  });
  const galleryPreviewFocus = true;

  await page.screenshot({
    path: path.join(OUT_DIR, "a11y-1440.png"),
    fullPage: false,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, "journal a11y editor 390");
  await page.screenshot({
    path: path.join(OUT_DIR, "a11y-390.png"),
    fullPage: false,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(shareUrl);
  const shareGalleryImage = page.locator('.journal-layout div[data-type="gallery"] img').first();
  await expect(shareGalleryImage).toHaveAttribute("role", "button");
  await expect(shareGalleryImage).toHaveAttribute("tabindex", "0");
  await expect(shareGalleryImage).toHaveAttribute("aria-label", /^查看图片：/u);

  await shareGalleryImage.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "照片查看" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "照片查看" })).not.toBeVisible();
  const shareGalleryFocus = await shareGalleryImage.evaluate(
    (element) => document.activeElement === element,
  );
  expect.soft(shareGalleryFocus).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, "journal a11y share 390");
  await page.screenshot({
    path: path.join(OUT_DIR, "a11y-share-390.png"),
    fullPage: false,
    animations: "disabled",
  });

  await writeFile(
    path.join(OUT_DIR, "a11y-run.json"),
    JSON.stringify(
      {
        entryTitle: ENTRY_TITLE,
        shareUrl,
        assertions: {
          galleryEditorPreviewFocus: galleryPreviewFocus,
          shareGalleryKeyboard: shareGalleryFocus,
          noHorizontalOverflow: true,
        },
        screenshots: ["a11y-1440.png", "a11y-390.png", "a11y-share-390.png"],
      },
      null,
      2,
    ),
  );
});
