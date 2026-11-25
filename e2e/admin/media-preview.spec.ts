import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "b1b-admin@roamlog.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Roamlog-B1b-Aa1!";
const STATE_FILE = path.join(os.tmpdir(), "roamlog-admin-media-preview-state.json");
const OUT_DIR = path.join(process.cwd(), ".audit", "release-blockers", "media-preview");

test.use({
  baseURL: ADMIN_URL,
  storageState: STATE_FILE,
  viewport: { width: 1440, height: 1000 },
  trace: "off",
});

test.describe.configure({ mode: "serial", timeout: 120_000 });

async function login(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("管理员邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/admin(\/|$)/u, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "平台总览" })).toBeVisible();
  await context.storageState({ path: STATE_FILE });
  await context.close();
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

test.beforeAll(async ({ browser }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  const context = await browser.newContext({
    baseURL: ADMIN_URL,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 1000 },
  });
  try {
    await login(context);
  } finally {
    await context.close();
  }
});

test("real ready media thumbnail loads bytes instead of falling back to a gradient", async ({
  page,
}) => {
  await page.goto("/admin/media");
  await expect(page.getByRole("heading", { name: "媒体库" })).toBeVisible();
  await expect(page.getByText("正在读取后台数据。")).toHaveCount(0, { timeout: 30_000 });

  const thumbnail = page.locator('[data-testid^="media-thumbnail-"]').first();
  await expect(thumbnail).toBeVisible({ timeout: 30_000 });
  await thumbnail.scrollIntoViewIfNeeded();

  await expect
    .poll(
      async () =>
        thumbnail.evaluate((node) => {
          const image = node as HTMLImageElement;
          return {
            complete: image.complete,
            naturalWidth: image.naturalWidth,
          };
        }),
      { timeout: 20_000, message: "thumbnail bytes must finish loading" },
    )
    .toMatchObject({ complete: true, naturalWidth: expect.any(Number) });

  const loaded = await thumbnail.evaluate((node) => {
    const image = node as HTMLImageElement;
    return {
      src: image.currentSrc,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    };
  });
  expect(loaded.naturalWidth, JSON.stringify(loaded)).toBeGreaterThan(0);
  await screenshot(page, "media-1440");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "媒体库" })).toBeVisible();
  const mobileThumbnail = page.locator('[data-testid^="media-thumbnail-"]').first();
  await expect(mobileThumbnail).toBeVisible({ timeout: 30_000 });
  await mobileThumbnail.scrollIntoViewIfNeeded();
  await expect
    .poll(
      async () =>
        mobileThumbnail.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await screenshot(page, "media-390");

  writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        adminUrl: ADMIN_URL,
        loaded,
        screenshots: ["media-1440.png", "media-390.png"],
      },
      null,
      2,
    )}\n`,
  );
});

test("a failed thumbnail exposes a clickable retry and recovers without a reload", async ({
  page,
}) => {
  let delayNextMediaResponse = false;
  await page.route("**/v1/admin/media**", async (route) => {
    if (delayNextMediaResponse) {
      delayNextMediaResponse = false;
      await new Promise((resolve) => setTimeout(resolve, 6_000));
    }
    await route.continue();
  });

  await page.goto("/admin/media");
  await expect(page.getByRole("heading", { name: "媒体库" })).toBeVisible();
  await expect(page.getByText("正在读取后台数据。")).toHaveCount(0, { timeout: 30_000 });

  const thumbnail = page.locator('[data-testid^="media-thumbnail-"]').first();
  await expect(thumbnail).toBeVisible({ timeout: 30_000 });
  await thumbnail.scrollIntoViewIfNeeded();
  await expect
    .poll(() => thumbnail.evaluate((node) => (node as HTMLImageElement).naturalWidth), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  const testId = await thumbnail.getAttribute("data-testid");
  expect(testId).toBeTruthy();
  const mediaId = testId!.replace("media-thumbnail-", "");

  delayNextMediaResponse = true;
  await page.evaluate((id) => {
    const image = document.querySelector(`[data-testid="media-thumbnail-${id}"]`);
    if (!(image instanceof HTMLImageElement)) throw new Error("thumbnail is not an image");
    const expired = new URL(image.currentSrc);
    expired.pathname = expired.pathname.replace(/thumb\.(?:webp|jpg)$/u, "thumb-expired.webp");
    image.src = expired.toString();
    image.dispatchEvent(new Event("error"));
  }, mediaId);

  const errorState = page.getByTestId(`media-preview-error-${mediaId}`);
  await expect(errorState).toBeVisible({ timeout: 20_000 });
  const retry = errorState.getByRole("button", { name: "重新加载" });
  await expect(retry).toBeEnabled();

  // Signed URLs are second-granular; wait long enough that a refetch must
  // produce a different signature rather than reusing the failed one.
  await page.waitForTimeout(1_600);
  await retry.click({ timeout: 5_000 });

  const recovered = page.getByTestId(`media-thumbnail-${mediaId}`);
  await expect(recovered).toBeVisible({ timeout: 20_000 });
  await recovered.scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        recovered.evaluate((node) => {
          const image = node as HTMLImageElement;
          return {
            complete: image.complete,
            naturalWidth: image.naturalWidth,
          };
        }),
      { timeout: 20_000 },
    )
    .toMatchObject({ complete: true, naturalWidth: expect.any(Number) });

  const loaded = await recovered.evaluate((node) => {
    const image = node as HTMLImageElement;
    return {
      src: image.currentSrc,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    };
  });
  expect(loaded.naturalWidth, JSON.stringify(loaded)).toBeGreaterThan(0);
  await screenshot(page, "media-recovered-after-retry-1440");
  writeFileSync(
    path.join(OUT_DIR, "retry-evidence.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mediaId,
        initialFailure: "simulated-expired-thumbnail-404",
        retryAction: "重新加载",
        loaded,
      },
      null,
      2,
    )}\n`,
  );
});
