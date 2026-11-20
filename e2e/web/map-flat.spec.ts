/**
 * MAP_FLAT_FIX — real-browser acceptance for the atlas "平面" projection.
 *
 * The regression: MapCanvas's `h-full` root sits under an auto-height atlas
 * parent. MapLibre's own `.maplibregl-map` container computes to height 0 while
 * its canvas overflows at the browser's intrinsic 300 px, so the card looks
 * blank even though a canvas-only bounding-box check can look plausible.
 *
 * Run:
 *   pnpm exec playwright test --project=web e2e/web/map-flat.spec.ts
 *
 * Evidence:
 *   .audit/map-flat/flat-1440.png
 *   .audit/map-flat/globe-1440.png
 *   .audit/map-flat/flat-390.png
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { OWNER_ACCOUNT } from "../support/accounts";

const MAP_PATH = "/w/roamlog-crew/map";
const SHOT_DIR = resolve(process.cwd(), ".audit/map-flat");

// The local Windows runner can lose trace files while closing Chromium; this
// journey's evidence is the screenshots plus the measured canvas boxes/pixels.
test.use({ trace: "off" });

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(OWNER_ACCOUNT.email);
  await page.getByLabel("密码").fill(OWNER_ACCOUNT.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

async function openMap(page: Page): Promise<void> {
  await page.goto(MAP_PATH);
  await expect(page.getByRole("heading", { name: "世界足迹" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "平面", exact: true })).toBeVisible();
}

function mapCanvas(page: Page): Locator {
  return page.locator('[data-testid="maplibre-canvas"] canvas.maplibregl-canvas');
}

function mapViewport(page: Page): Locator {
  return page.locator('[data-testid="maplibre-canvas"] .maplibregl-map');
}

function globeCanvas(page: Page): Locator {
  return page.locator('[data-testid="globe-view"] canvas.maplibregl-canvas');
}

function globeViewport(page: Page): Locator {
  return page.locator('[data-testid="globe-view"] .maplibregl-map');
}

interface CanvasStats {
  width: number;
  height: number;
  meanLuminance: number;
  darkRatio: number;
  sampledColors: number;
}

/**
 * Decode a canvas screenshot in the browser and sample its pixels. Playwright
 * has no PNG decoder of its own and the repository must not gain a dependency
 * for one assertion, so the already-running Chromium does the decoding.
 */
async function canvasStats(page: Page, canvas: Locator): Promise<CanvasStats> {
  const png = await canvas.screenshot({ animations: "disabled" });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();

    const surface = document.createElement("canvas");
    surface.width = image.width;
    surface.height = image.height;
    const context = surface.getContext("2d");
    if (!context) throw new Error("2D canvas is unavailable while sampling the map screenshot");
    context.drawImage(image, 0, 0);

    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const colors = new Set<string>();
    let luminance = 0;
    let dark = 0;
    let samples = 0;
    const stride = Math.max(4, Math.floor(pixels.length / 4096 / 4) * 4);

    for (let index = 0; index < pixels.length; index += stride) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      luminance += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (red < 8 && green < 8 && blue < 8) dark += 1;
      samples += 1;
      if (colors.size < 64) colors.add(`${red},${green},${blue}`);
    }

    return {
      width: image.width,
      height: image.height,
      meanLuminance: samples ? luminance / samples : 0,
      darkRatio: samples ? dark / samples : 1,
      sampledColors: colors.size,
    };
  }, png.toString("base64"));
}

async function expectRenderedMap(
  page: Page,
  canvas: Locator,
  viewport: Locator,
  label: string,
): Promise<CanvasStats> {
  await expect(canvas).toHaveCount(1);
  const box = await canvas.boundingBox();
  const viewportBox = await viewport.boundingBox();
  console.log(
    `[map-flat] ${label} canvas=${JSON.stringify(box)} viewport=${JSON.stringify(viewportBox)}`,
  );

  // The regression hid here: MapLibre's own container had height 0 while its
  // canvas overflowed at the browser's intrinsic 300 px, so a canvas-only size
  // assertion passed even though the map surface was never laid out.
  expect(viewportBox, `${label}: MapLibre viewport must have a box`).not.toBeNull();
  expect(viewportBox?.width ?? 0, `${label}: MapLibre viewport width`).toBeGreaterThan(200);
  expect(viewportBox?.height ?? 0, `${label}: MapLibre viewport height`).toBeGreaterThan(200);

  // The user-facing contract is the canvas itself: a real, visible drawing surface.
  expect(box, `${label}: canvas must have a box`).not.toBeNull();
  expect(box?.width ?? 0, `${label}: canvas width`).toBeGreaterThan(200);
  expect(box?.height ?? 0, `${label}: canvas height`).toBeGreaterThan(200);

  // Tile paints arrive asynchronously after MapLibre creates the canvas. Poll
  // the actual pixels so the assertion proves a rendered map, not a black rect.
  let stats: CanvasStats | null = null;
  await expect
    .poll(
      async () => {
        stats = await canvasStats(page, canvas);
        return stats.meanLuminance > 40 && stats.darkRatio < 0.6;
      },
      { timeout: 45_000, intervals: [1_000, 1_500, 2_000] },
    )
    .toBe(true);

  expect(stats, `${label}: pixel stats`).not.toBeNull();
  console.log(`[map-flat] ${label} pixels=${JSON.stringify(stats)}`);
  expect(stats?.sampledColors ?? 0, `${label}: more than a flat fill`).toBeGreaterThan(8);
  return stats as CanvasStats;
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: resolve(SHOT_DIR, name),
    fullPage: true,
    animations: "disabled",
  });
}

test("MAP_FLAT_FIX — flat atlas canvas has a real height and keeps globe working", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mkdir(SHOT_DIR, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await openMap(page);

  // 1. Click 平面 exactly as the user does, then prove the MapLibre canvas has
  //    real geometry and non-black pixels.
  const flatButton = page.getByRole("button", { name: "平面", exact: true });
  await flatButton.click();
  await expect(flatButton).toHaveAttribute("aria-pressed", "true");
  await expectRenderedMap(page, mapCanvas(page), mapViewport(page), "flat-1440");
  await saveScreenshot(page, "flat-1440.png");

  // 2. The globe uses an explicit 320/440 px frame; it must stay unaffected.
  await page.getByRole("button", { name: "地球", exact: true }).click();
  await expect(page.getByTestId("globe-view")).toBeVisible({ timeout: 30_000 });
  await expectRenderedMap(page, globeCanvas(page), globeViewport(page), "globe-1440");
  await saveScreenshot(page, "globe-1440.png");

  // 3. Mobile 390x844: switch back to flat and verify the same 320 px frame.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "平面", exact: true }).click();
  await expect(page.getByTestId("maplibre-canvas")).toBeVisible({ timeout: 30_000 });
  await expectRenderedMap(page, mapCanvas(page), mapViewport(page), "flat-390");
  await saveScreenshot(page, "flat-390.png");
});
