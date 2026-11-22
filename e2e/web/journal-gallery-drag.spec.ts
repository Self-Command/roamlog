import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { API_URL, OWNER_ACCOUNT, WORKSPACE_SLUG, signInViaApi } from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";
import { gpsPng } from "../support/photo-fixtures";

const OUT_DIR = path.join(process.cwd(), ".audit", "journal-layout");
const RUN_ID = `${Date.now()}`;
const TRIP_TITLE = `E2E Gallery Drag Trip ${RUN_ID}`;
const ENTRY_TITLE = `E2E Gallery Drag Entry ${RUN_ID}`;

let ownerApi: APIRequestContext;
let workspaceId = "";
let tripId = "";
let entryId = "";
let shareUrl = "";

test.use({ trace: "off", video: "off" });
test.describe.configure({ mode: "serial" });

function galleryFile(name: string, hue: number) {
  const png = gpsPng({
    name,
    width: 1200,
    height: 900,
    lat: 35.0116,
    lng: 135.7681,
    altitude: 52.4,
    direction: 135,
    hue,
    shotAt: "2026:11:22 09:30:00",
  });
  return { name: png.name, mimeType: png.mimeType, buffer: png.buffer };
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(OWNER_ACCOUNT.email);
  await page.getByLabel("密码").fill(OWNER_ACCOUNT.password);
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

async function uploadGallery(
  page: Page,
  sheet: ReturnType<Page["locator"]>,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
): Promise<ReturnType<Page["locator"]>> {
  const input = page.getByLabel("选择图库图片");
  await expect(input).toHaveCount(1);
  await input.setInputFiles(files);

  const gallery = sheet.locator('div[data-type="gallery"]').first();
  await expect(gallery).toBeVisible({ timeout: 90_000 });
  await expect(gallery.locator('figure[data-type="gallery-item"]')).toHaveCount(3, {
    timeout: 90_000,
  });
  await expect
    .poll(
      () =>
        gallery.locator("img").evaluateAll(
          (images) =>
            images.length === 3 &&
            images.every((image) => {
              const element = image as HTMLImageElement;
              return element.complete && element.naturalWidth > 0;
            }),
        ),
      { timeout: 90_000, message: "gallery images must finish loading" },
    )
    .toBe(true);
  await expect(sheet.getByRole("button", { name: "插入图库" })).toBeEnabled({ timeout: 90_000 });
  return gallery;
}

async function selectGallery(
  page: Page,
  sheet: ReturnType<Page["locator"]>,
): Promise<ReturnType<Page["locator"]>> {
  const gallery = sheet.locator('div[data-type="gallery"]').first();
  await expect(gallery).toBeVisible();
  await gallery.locator('figure[data-type="gallery-item"] img').first().click();
  await expect(page.getByRole("toolbar", { name: "图库工具" })).toBeVisible();
  await expect(gallery).toHaveAttribute("data-selected", "true");
  return gallery;
}

async function openSettings(
  page: Page,
  sheet: ReturnType<Page["locator"]>,
): Promise<ReturnType<Page["locator"]>> {
  const gallery = sheet.locator('div[data-type="gallery"]').first();
  await expect(gallery).toHaveAttribute("data-selected", "true");
  await sheet.getByRole("button", { name: "图库设置" }).click();
  const settings = page.getByRole("dialog", { name: "图库设置" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "第 1 张图片的替代文本" })).toBeVisible();
  return settings;
}

async function panelAltOrder(settings: ReturnType<Page["locator"]>): Promise<string[]> {
  return settings
    .locator('input[aria-label$="的替代文本"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
}

async function galleryAltOrder(gallery: ReturnType<Page["locator"]>): Promise<string[]> {
  return gallery
    .locator('figure[data-type="gallery-item"] img')
    .evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).getAttribute("alt") ?? ""),
    );
}

async function dragThirdToFirst(page: Page, settings: ReturnType<Page["locator"]>): Promise<void> {
  const rows = settings.locator('ol[aria-label="图库图片列表"] > li');
  await expect(rows).toHaveCount(3);

  const source = rows.nth(2).locator("[data-dnd-handle]");
  const target = rows.first();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("gallery drag boxes were not measurable");

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 12, sourceY + 12, { steps: 4 });
  await page.mouse.move(targetX, targetY, { steps: 16 });
  await page.mouse.up();
}

async function save(sheet: ReturnType<Page["locator"]>): Promise<void> {
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet.getByRole("status")).toContainText("已保存", { timeout: 30_000 });
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
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "准备上传图库并拖拽排序。" }],
          },
        ],
      },
      contentHtml: "<p>准备上传图库并拖拽排序。</p>",
      excerpt: "拖拽排序真实验收",
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
});

test("drags uploaded gallery thumbnails with a real pointer and persists the order", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const files = [
    galleryFile(`drag-a-${RUN_ID}.png`, 24),
    galleryFile(`drag-b-${RUN_ID}.png`, 198),
    galleryFile(`drag-c-${RUN_ID}.png`, 122),
  ];
  const names = files.map((file) => file.name);
  const draggedOrder = [names[2]!, names[0]!, names[1]!];
  const keyboardOrder = [names[0]!, names[2]!, names[1]!];

  await login(page);
  let sheet = await openEntry(page);
  let gallery = await uploadGallery(page, sheet, files);
  await save(sheet);
  await sheet.getByRole("button", { name: "关闭" }).click();
  await expect(sheet).not.toBeVisible();

  sheet = await openEntry(page);
  gallery = await selectGallery(page, sheet);
  await expect(gallery.locator('figure[data-type="gallery-item"]')).toHaveCount(3);

  const settings = await openSettings(page, sheet);
  expect(await panelAltOrder(settings)).toEqual(names);
  await dragThirdToFirst(page, settings);
  await expect.poll(async () => panelAltOrder(settings)).toEqual(draggedOrder);
  expect(await galleryAltOrder(gallery)).toEqual(draggedOrder);

  await page.screenshot({
    path: path.join(OUT_DIR, "gallery-drag-1440.png"),
    fullPage: false,
    animations: "disabled",
  });
  await settings.getByRole("button", { name: "关闭图库设置" }).click();
  await save(sheet);

  await sheet.getByRole("button", { name: "关闭" }).click();
  await expect(sheet).not.toBeVisible();

  const afterDragResponse = await ownerApi.get(`/v1/entries/${entryId}`);
  expect(afterDragResponse.status(), await afterDragResponse.text()).toBe(200);
  const afterDrag = (await afterDragResponse.json()) as {
    contentJson: unknown;
    contentHtml: string;
  };
  const galleryJson = (
    afterDrag.contentJson as {
      content: Array<{ type: string; content?: Array<{ attrs?: { alt?: string } }> }>;
    }
  ).content.find((node) => node.type === "gallery");
  expect(galleryJson?.content?.map((node) => node.attrs?.alt)).toEqual(draggedOrder);

  await page.reload();
  sheet = await openEntry(page);
  gallery = await selectGallery(page, sheet);
  expect(await galleryAltOrder(gallery)).toEqual(draggedOrder);

  const settingsAfterReload = await openSettings(page, sheet);
  await settingsAfterReload.getByRole("button", { name: "下移第 1 张图片" }).click();
  await expect.poll(async () => panelAltOrder(settingsAfterReload)).toEqual(keyboardOrder);
  await settingsAfterReload.getByRole("button", { name: "关闭图库设置" }).click();
  await save(sheet);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, "gallery drag editor 390");
  await page.screenshot({
    path: path.join(OUT_DIR, "gallery-drag-390.png"),
    fullPage: false,
    animations: "disabled",
  });

  await sheet.getByRole("button", { name: "关闭" }).click();
  await expect(sheet).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(shareUrl);
  await expect(page.getByRole("heading", { name: ENTRY_TITLE })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() => galleryAltOrder(page.locator('.journal-layout div[data-type="gallery"]').first()))
    .toEqual(keyboardOrder);

  const afterKeyboardResponse = await ownerApi.get(`/v1/entries/${entryId}`);
  expect(afterKeyboardResponse.status(), await afterKeyboardResponse.text()).toBe(200);
  const afterKeyboard = (await afterKeyboardResponse.json()) as {
    contentJson: unknown;
    contentHtml: string;
  };
  expect(afterKeyboard.contentHtml).toContain('data-type="gallery"');

  await writeFile(
    path.join(OUT_DIR, "gallery-drag-run.json"),
    JSON.stringify(
      {
        tripId,
        entryId,
        shareUrl,
        initialOrder: names,
        afterPointerDrag: draggedOrder,
        afterKeyboardMove: keyboardOrder,
        pointerDragMethod: "mouse.move/down/move/up against [data-dnd-handle]",
        keyboardFallback: "下移第 1 张图片",
        uploadedThrough: "real presign -> PUT -> complete -> media ready",
        persistedAfterReload: true,
        shareVisible: true,
        screenshots: ["gallery-drag-1440.png", "gallery-drag-390.png"],
      },
      null,
      2,
    ),
  );
});
