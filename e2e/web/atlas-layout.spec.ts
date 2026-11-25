/**
 * MAP_ATLAS_LAYOUT — real-browser acceptance for the atlas page's two-column
 * layout.
 *
 * The regression: `atlas-workspace.tsx` renders its map card and trip aside in
 * a CSS grid without `items-start`. Grid's default `align-items: stretch`
 * stretched the short map card down to the row height of the long trip aside,
 * leaving a large empty area under the map/legend footer (see
 * `.audit/map-flat/flat-1440.png`).
 *
 * This spec measures the real, rendered geometry: the map `section` must not
 * be much taller than its MapLibre canvas, the aside must keep a usable height
 * and an internally scrollable trip list, and the same measurements are logged
 * for the other two-column dashboard grids so the "same pattern elsewhere"
 * check has numbers instead of guesses.
 *
 * Run:
 *   node node_modules/@playwright/test/cli.js test e2e/web/atlas-layout.spec.ts
 *
 * Evidence:
 *   .audit/atlas-layout/atlas-layout-1440.png
 *   .audit/atlas-layout/atlas-layout-390.png
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const MAP_PATH = "/w/roamlog-crew/map";
const DASHBOARD_PATH = "/w/roamlog-crew";
const SHOT_DIR = resolve(process.cwd(), ".audit/atlas-layout");
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

// The local Windows runner can lose trace files while closing Chromium; this
// journey's evidence is the screenshots plus the measured boxes.
test.use({ trace: "off" });

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("verify@roamlog.test");
  await page.getByLabel("密码").fill("Roamlog-Verify-Aa1!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

function mapCard(page: Page): Locator {
  return page
    .locator("section.surface-card")
    .filter({ hasText: "WORLD / FOOTPRINT" })
    .first();
}

function mapCanvas(page: Page): Locator {
  return page.locator('[data-testid="maplibre-canvas"] canvas.maplibregl-canvas').first();
}

function atlasAside(page: Page): Locator {
  return page.locator("aside.surface-card").first();
}

/** The trip list inside the aside is the flex child that must still scroll. */
function tripList(page: Page): Locator {
  return atlasAside(page).locator("div.overflow-y-auto").first();
}

/**
 * Waits until MapLibre painted real tiles so the evidence screenshots show the
 * rendered map instead of a black canvas caught mid-load. Best-effort only:
 * tile latency is network-bound, so it logs the luminance and never fails the
 * layout assertions.
 */
async function waitForMapPaint(page: Page, canvas: Locator, label: string): Promise<number> {
  const deadline = Date.now() + 20_000;
  let luminance = 0;
  while (Date.now() < deadline) {
    try {
      const png = await canvas.screenshot({ animations: "disabled" });
      luminance = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const surface = document.createElement("canvas");
        surface.width = image.width;
        surface.height = image.height;
        const context = surface.getContext("2d");
        if (!context) return 0;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        const stride = Math.max(4, Math.floor(pixels.length / 4096 / 4) * 4);
        let total = 0;
        let samples = 0;
        for (let index = 0; index < pixels.length; index += stride) {
          total +=
            0.2126 * (pixels[index] ?? 0) +
            0.7152 * (pixels[index + 1] ?? 0) +
            0.0722 * (pixels[index + 2] ?? 0);
          samples += 1;
        }
        return samples ? total / samples : 0;
      }, png.toString("base64"));
    } catch {
      luminance = 0;
    }
    if (luminance > 40) break;
    await page.waitForTimeout(750);
  }
  console.log(`[atlas-layout] ${label} canvas mean luminance=${Math.round(luminance)}`);
  return luminance;
}

async function openMap(page: Page): Promise<void> {
  await page.goto(MAP_PATH);
  await expect(page.getByRole("heading", { name: "世界足迹" })).toBeVisible({ timeout: 30_000 });
  const flat = page.getByRole("button", { name: "平面", exact: true });
  await flat.click();
  await expect(flat).toHaveAttribute("aria-pressed", "true");
  await expect(mapCanvas(page)).toHaveCount(1, { timeout: 30_000 });
}

/** Empty space between the card's last child and the card's bottom edge. */
async function trailingBlank(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const card = element.getBoundingClientRect();
    const last = element.lastElementChild;
    if (!last) return 0;
    const style = getComputedStyle(element);
    const paddingBottom = Number.parseFloat(style.paddingBottom || "0");
    return Math.round((card.bottom - last.getBoundingClientRect().bottom - paddingBottom) * 10) / 10;
  });
}

interface MapLayout {
  card: { width: number; height: number };
  canvas: { width: number; height: number };
  blank: number;
  gridAlignItems: string;
}

async function measureMap(page: Page): Promise<MapLayout> {
  const card = mapCard(page);
  const canvas = mapCanvas(page);
  await expect(card).toBeVisible();
  await expect(canvas).toBeVisible();

  // MapLibre resizes its canvas after the container is laid out; wait for a
  // real canvas height instead of sampling during that handshake.
  await expect
    .poll(async () => (await canvas.boundingBox())?.height ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(200);

  const cardBox = (await card.boundingBox()) as NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
  const canvasBox = (await canvas.boundingBox()) as NonNullable<
    Awaited<ReturnType<Locator["boundingBox"]>>
  >;
  const blank = await trailingBlank(card);
  const gridAlignItems = await card.evaluate((element) =>
    getComputedStyle(element.parentElement as HTMLElement).alignItems,
  );

  const layout: MapLayout = {
    card: { width: Math.round(cardBox.width), height: Math.round(cardBox.height) },
    canvas: { width: Math.round(canvasBox.width), height: Math.round(canvasBox.height) },
    blank,
    gridAlignItems,
  };
  console.log(`[atlas-layout] map card=${JSON.stringify(layout)}`);
  return layout;
}

async function expectMapCardTight(page: Page, label: string): Promise<MapLayout> {
  const layout = await measureMap(page);
  // The map card is header (56px) + canvas + status footer (40px); anything
  // near the old stretch leaves hundreds of pixels of empty card below.
  expect(
    layout.card.height - layout.canvas.height,
    `${label}: map card must hug its canvas (card ${layout.card.height}px, canvas ${layout.canvas.height}px)`,
  ).toBeLessThan(120);
  expect(layout.blank, `${label}: no trailing blank inside the map card`).toBeLessThan(120);
  expect(layout.card.height, `${label}: card must keep a real map`).toBeGreaterThan(400);
  return layout;
}

test("MAP_ATLAS_LAYOUT — 1440px map card hugs the canvas and the aside keeps working", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mkdir(SHOT_DIR, { recursive: true });

  await page.setViewportSize(DESKTOP);
  await login(page);
  await openMap(page);

  const layout = await expectMapCardTight(page, "desktop-1440");

  // The aside is the taller column. It must stay visible with a usable height
  // even after the left card stopped stretching to match it.
  const aside = atlasAside(page);
  await expect(aside).toBeVisible();
  const asideBox = await aside.boundingBox();
  expect(asideBox, "desktop-1440: aside must have a box").not.toBeNull();
  console.log(
    `[atlas-layout] aside=${JSON.stringify({
      width: Math.round(asideBox?.width ?? 0),
      height: Math.round(asideBox?.height ?? 0),
      top: Math.round(asideBox?.y ?? 0),
    })}`,
  );
  expect(asideBox?.height ?? 0, "desktop-1440: aside height > 400px").toBeGreaterThan(400);
  expect(asideBox?.width ?? 0, "desktop-1440: aside keeps its 360px column").toBeGreaterThan(300);

  const asideState = await aside.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      position: style.position,
      maxHeight: style.maxHeight,
      height: Math.round(element.getBoundingClientRect().height),
      clientHeight: element.clientHeight,
    };
  });
  console.log(`[atlas-layout] aside style=${JSON.stringify(asideState)}`);
  // Sticky is an xl-only behaviour on this aside; losing it means the aside
  // changed shape during the fix.
  expect(asideState.position, "desktop-1440: aside is still sticky at xl").toBe("sticky");

  // The long trip list must still be the element that scrolls — if the aside
  // collapsed, the list would either clip or grow the whole page instead.
  const list = tripList(page);
  await expect(list).toBeVisible();
  const listState = await list.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const asideBox = (element.closest("aside") as HTMLElement).getBoundingClientRect();
    return {
      height: Math.round(box.height),
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      bottomGap: Math.round(asideBox.bottom - box.bottom),
    };
  });
  console.log(`[atlas-layout] trip list=${JSON.stringify(listState)}`);
  expect(listState.height, "desktop-1440: trip list has a real height").toBeGreaterThan(150);
  expect(listState.scrollHeight, "desktop-1440: trip list is scrollable, not clipped").toBeGreaterThan(
    listState.clientHeight,
  );
  expect(
    listState.bottomGap,
    "desktop-1440: trip list stays inside the aside card",
  ).toBeGreaterThanOrEqual(-1);

  // The list must really scroll, not merely report a scrollHeight: a collapsed
  // flex parent would clip the content instead of letting the user reach it.
  const scrolled = await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  console.log(`[atlas-layout] trip list scrolled to=${Math.round(scrolled)}`);
  expect(scrolled, "desktop-1440: the trip list scrolls to its last trip").toBeGreaterThan(0);
  // Reset so the evidence screenshot shows the aside in its default state.
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });

  // The page-level proof the user asked for: no huge black area below the map.
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(
    `[atlas-layout] page height=${pageHeight}, card bottom=${Math.round(layout.card.height + (asideBox?.y ?? 0))}`,
  );
  expect(pageHeight, "desktop-1440: page height still fits the layout").toBeLessThan(1600);

  await waitForMapPaint(page, mapCanvas(page), "desktop-1440");
  await page.screenshot({
    path: resolve(SHOT_DIR, "atlas-layout-1440.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("MAP_ATLAS_LAYOUT — 390px keeps a tight map card and no horizontal overflow", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mkdir(SHOT_DIR, { recursive: true });

  await page.setViewportSize(MOBILE);
  await login(page);
  await openMap(page);

  // At 390px the grid collapses to one column, so the stretch bug cannot
  // apply; this proves the fix did not regress the stacked layout.
  await expectMapCardTight(page, "mobile-390");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  console.log(`[atlas-layout] mobile horizontal overflow=${overflow}`);
  expect(overflow, "mobile-390: no horizontal overflow").toBeLessThanOrEqual(1);

  await waitForMapPaint(page, mapCanvas(page), "mobile-390");
  await page.screenshot({
    path: resolve(SHOT_DIR, "atlas-layout-390.png"),
    fullPage: true,
    animations: "disabled",
  });
});

/**
 * Diagnostic for the other two-column grids in the web app. They are outside
 * this task's writable files, so the numbers are logged for the report rather
 * than asserted against a threshold that only this task could tune.
 */
test("MAP_ATLAS_LAYOUT — dashboard two-column grids measured for the same stretch", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.goto(DASHBOARD_PATH);
  await expect(page.getByRole("heading", { name: "总览" }).first()).toBeVisible({
    timeout: 30_000,
  });

  const pairs = [
    { name: "next-trip", left: "下一段旅行", right: "接下来" },
    { name: "recent-vs-budget", left: "最近更新", right: "预算分布" },
  ] as const;

  for (const pair of pairs) {
    const left = page.locator("section").filter({ hasText: pair.left }).first();
    const right = page.locator("section").filter({ hasText: pair.right }).first();
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    const measured = await page.evaluate(
      ([leftText, rightText]) => {
        const sections = Array.from(document.querySelectorAll("section"));
        const pick = (text: string) => sections.find((entry) => entry.textContent?.includes(text));
        const read = (element: Element | undefined) => {
          if (!element) return null;
          const box = element.getBoundingClientRect();
          const last = element.lastElementChild;
          return {
            height: Math.round(box.height),
            bottom: Math.round(box.bottom),
            trailingBlank: last
              ? Math.round(box.bottom - last.getBoundingClientRect().bottom)
              : 0,
            parentClass: element.parentElement?.className ?? "",
          };
        };
        return { left: read(pick(leftText)), right: read(pick(rightText)) };
      },
      [pair.left, pair.right] as const,
    );
    console.log(`[atlas-layout] dashboard ${pair.name}=${JSON.stringify(measured)}`);
    expect(measured.left, `${pair.name}: left section measured`).not.toBeNull();
    expect(measured.right, `${pair.name}: right section measured`).not.toBeNull();
    // These diagnostics only prove both columns render; the trailing-blank
    // numbers are reported for a separate fix if they ever exceed the map
    // card's tolerance.
    expect(measured.left?.height ?? 0).toBeGreaterThan(50);
    expect(measured.right?.height ?? 0).toBeGreaterThan(50);
  }
});
