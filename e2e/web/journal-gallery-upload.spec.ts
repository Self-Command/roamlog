import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const TRIP_TITLE = `E2E Gallery Upload ${RUN_ID}`;
const ENTRY_TITLE = `E2E Gallery Entry ${RUN_ID}`;
const MEDIA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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

async function galleryMediaIds(gallery: ReturnType<Page["locator"]>): Promise<string[]> {
  return gallery
    .locator("img[data-media-id]")
    .evaluateAll((images) =>
      images.map((image) => image.getAttribute("data-media-id")?.trim() ?? "").filter(Boolean),
    );
}

async function expectGalleryImagesLoaded(
  gallery: ReturnType<Page["locator"]>,
  expected: number,
): Promise<void> {
  await expect(gallery.locator('figure[data-type="gallery-item"]')).toHaveCount(expected, {
    timeout: 60_000,
  });
  await expect
    .poll(
      () =>
        gallery.locator("img").evaluateAll(
          (images, expectedCount) =>
            images.length === expectedCount &&
            images.every((image) => {
              const element = image as HTMLImageElement;
              return element.complete && element.naturalWidth > 0;
            }),
          expected,
        ),
      { timeout: 60_000, message: "gallery images must finish loading" },
    )
    .toBe(true);
}

async function selectGallery(
  page: Page,
  sheet: ReturnType<Page["locator"]>,
): Promise<ReturnType<Page["locator"]>> {
  const gallery = sheet.locator('div[data-type="gallery"]').first();
  await expect(gallery).toBeVisible({ timeout: 60_000 });
  await gallery.locator('figure[data-type="gallery-item"] img').first().click();
  await expect(page.getByRole("toolbar", { name: "图库工具" })).toBeVisible();
  return gallery;
}

async function waitForUploadedGallery(
  page: Page,
  sheet: ReturnType<Page["locator"]>,
  network: string[],
): Promise<ReturnType<Page["locator"]>> {
  const gallery = sheet.locator('div[data-type="gallery"]').first();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if ((await gallery.count()) > 0) return gallery;

    const alerts = await page.getByRole("alert").allTextContents();
    if (alerts.length > 0) {
      await writeFile(
        path.join(OUT_DIR, "e2e-gallery-upload-failure.json"),
        JSON.stringify({ alerts, network }, null, 2),
      );
      throw new Error(`gallery upload failed: ${alerts.join(" | ")}\n${network.join("\n")}`);
    }

    await page.waitForTimeout(1_000);
  }

  await writeFile(
    path.join(OUT_DIR, "e2e-gallery-upload-failure.json"),
    JSON.stringify({ alerts: [], network }, null, 2),
  );
  throw new Error(`gallery never appeared after upload\n${network.join("\n")}`);
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
      endDate: "2026-11-25",
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
            content: [{ type: "text", text: "准备插入真实上传图库。" }],
          },
        ],
      },
      contentHtml: "<p>准备插入真实上传图库。</p>",
      excerpt: "真实上传图库验收",
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

test("uploads two gallery images, appends one, persists media, and opens the public lightbox", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fileA = galleryFile(`gallery-a-${RUN_ID}.png`, 24);
  const fileB = galleryFile(`gallery-b-${RUN_ID}.png`, 198);
  const fileC = galleryFile(`gallery-c-${RUN_ID}.png`, 122);
  const network: string[] = [];

  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/media") || url.includes(":9000") || url.includes("/v1/entries/")) {
      network.push(`${response.status()} ${response.request().method()} ${url.split("?")[0]}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") network.push(`console: ${message.text()}`);
  });

  let presignCount = 0;
  await page.route("**/v1/workspaces/*/media/presign", async (route) => {
    presignCount += 1;
    // A real request is forwarded unchanged; the short delay makes the visible
    // uploading state assertable without replacing the upload pipeline.
    await new Promise((resolve) => setTimeout(resolve, presignCount <= 3 ? 1_200 : 100));
    await route.continue();
  });

  await login(page);
  let sheet = await openEntry(page);
  const initialGalleryInput = page.getByLabel("选择图库图片");
  await expect(initialGalleryInput).toHaveCount(1);

  await initialGalleryInput.setInputFiles([fileA, fileB]);
  await expect(page.getByRole("status").filter({ hasText: /正在上传 \d+ 张图片/u })).toBeVisible({
    timeout: 5_000,
  });

  let gallery = await waitForUploadedGallery(page, sheet, network);
  gallery = await selectGallery(page, sheet);
  await expectGalleryImagesLoaded(gallery, 2);

  const firstIds = await galleryMediaIds(gallery);
  expect(firstIds).toHaveLength(2);
  for (const mediaId of firstIds) expect(mediaId).toMatch(MEDIA_ID_PATTERN);

  await expect(sheet.getByRole("button", { name: "插入图库" })).toBeEnabled({
    timeout: 60_000,
  });

  gallery = await selectGallery(page, sheet);
  await sheet.getByRole("button", { name: "添加图片" }).click();
  const appendInput = page.getByLabel("选择要添加到图库的图片");
  await expect(appendInput).toHaveCount(1);
  await appendInput.setInputFiles(fileC);
  await expectGalleryImagesLoaded(gallery, 3);

  const appendedIds = await galleryMediaIds(gallery);
  expect(appendedIds).toHaveLength(3);
  expect(appendedIds.slice(0, 2)).toEqual(firstIds);
  expect(appendedIds[2]).toMatch(MEDIA_ID_PATTERN);

  gallery = await selectGallery(page, sheet);
  await page.screenshot({
    path: path.join(OUT_DIR, "e2e-gallery-upload-1440.png"),
    fullPage: false,
    animations: "disabled",
  });
  await sheet.getByRole("button", { name: "添加图片" }).click();
  await page.getByLabel("选择要添加到图库的图片").setInputFiles({
    name: "not-an-image.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText(/只支持|格式|图片/u);
  await expect(gallery.locator('figure[data-type="gallery-item"]')).toHaveCount(3);

  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet.getByRole("status")).toContainText("已保存", { timeout: 30_000 });

  const savedResponse = await ownerApi.get(`/v1/entries/${entryId}`);
  expect(savedResponse.status(), await savedResponse.text()).toBe(200);
  const savedEntry = (await savedResponse.json()) as {
    contentJson: unknown;
    contentHtml: string;
  };
  await writeFile(
    path.join(OUT_DIR, "e2e-gallery-upload-saved.json"),
    JSON.stringify(savedEntry, null, 2),
  );

  await sheet.getByRole("button", { name: "关闭" }).click();
  await expect(sheet).not.toBeVisible();
  await page.reload();
  sheet = await openEntry(page);
  gallery = sheet.locator('div[data-type="gallery"]').first();
  await expectGalleryImagesLoaded(gallery, 3);
  const reloadedIds = await galleryMediaIds(gallery);
  expect(reloadedIds).toEqual(appendedIds);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, "gallery upload editor 390");
  const mobileGalleryColumns = await gallery
    .locator("[data-node-view-content]")
    .first()
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(/\s+/u).filter(Boolean).length,
    );
  expect(mobileGalleryColumns).toBe(2);
  await page.screenshot({
    path: path.join(OUT_DIR, "e2e-gallery-upload-390.png"),
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
  const shareGallery = page.locator('.journal-layout div[data-type="gallery"]').first();
  await expectGalleryImagesLoaded(shareGallery, 3);

  await shareGallery.locator('figure[data-type="gallery-item"] img').nth(1).click();
  await expect(page.getByRole("dialog", { name: "照片查看" })).toBeVisible();
  await page.screenshot({
    path: path.join(OUT_DIR, "e2e-gallery-share-1440.png"),
    fullPage: false,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "照片查看" })).not.toBeVisible();

  const entryResponse = await ownerApi.get(`/v1/entries/${entryId}`);
  expect(entryResponse.status(), await entryResponse.text()).toBe(200);
  const entry = (await entryResponse.json()) as { contentHtml: string };
  expect(entry.contentHtml).toContain('data-type="gallery"');
  for (const mediaId of appendedIds) {
    expect(entry.contentHtml).toContain(`data-media-id="${mediaId}"`);
    const mediaResponse = await ownerApi.get(`/v1/media/${mediaId}`);
    expect(mediaResponse.status(), await mediaResponse.text()).toBe(200);
    const media = (await mediaResponse.json()) as {
      id: string;
      status: string;
      url?: string;
    };
    expect(media).toMatchObject({ id: mediaId, status: "ready" });
    expect(media.url).toMatch(/^https?:\/\//u);
  }

  await writeFile(
    path.join(OUT_DIR, "e2e-gallery-upload-run.json"),
    JSON.stringify(
      {
        tripId,
        entryId,
        shareUrl,
        presignCount,
        mediaIds: appendedIds,
        galleryCount: 3,
        captionEditing: "covered by the separate caption persistence test",
        failedUploadDidNotAppend: true,
        screenshots: [
          "e2e-gallery-upload-1440.png",
          "e2e-gallery-upload-390.png",
          "e2e-gallery-share-1440.png",
        ],
      },
      null,
      2,
    ),
  );
});

test("edits a gallery caption through the settings panel", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  let sheet = await openEntry(page);
  let gallery = await selectGallery(page, sheet);

  await sheet.getByRole("button", { name: "图库设置" }).click();
  const caption = page.getByLabel("第 1 张图片的说明");
  await expect(caption).toBeVisible();
  await caption.fill("真实上传图注 · 京都");

  await expect(gallery.locator("figcaption").first()).toContainText("真实上传图注 · 京都");
  await expect(page.getByRole("dialog", { name: "图库设置" })).toBeVisible();
  await expect(caption).toBeFocused();

  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet.getByRole("status")).toContainText("已保存", { timeout: 30_000 });

  await sheet.getByRole("button", { name: "关闭" }).click();
  await expect(sheet).not.toBeVisible();
  sheet = await openEntry(page);
  gallery = await selectGallery(page, sheet);
  await expect(gallery.locator("figcaption").first()).toContainText("真实上传图注 · 京都");

  await sheet.getByRole("button", { name: "关闭" }).click();
  await expect(sheet).not.toBeVisible();
  await page.goto(shareUrl);
  await expect(
    page.locator('.journal-layout figure[data-type="gallery-item"] figcaption').first(),
  ).toContainText("真实上传图注 · 京都");

  const runPath = path.join(OUT_DIR, "e2e-gallery-upload-run.json");
  const current = JSON.parse(await readFile(runPath, "utf8").catch(() => "{}")) as Record<
    string,
    unknown
  >;
  await writeFile(
    runPath,
    JSON.stringify(
      {
        ...current,
        captionEditing: "passed",
        caption: "真实上传图注 · 京都",
        captionPersistedAfterReload: true,
        captionVisibleOnShare: true,
      },
      null,
      2,
    ),
  );
});
