/**
 * DASHBOARD_GRID_STRETCH — real-browser acceptance for the dashboard page's
 * two-column grids.
 *
 * The regression: `dashboard-page.tsx:152` renders the next-trip card and the
 * "接下来" itinerary aside in a CSS grid without `items-start`. Grid's default
 * `align-items: stretch` stretched the short aside down to the row height of
 * the tall next-trip card (both measured 519px tall), leaving ~282px of empty
 * card under the last itinerary row.
 *
 * The same bug class was already fixed for the atlas page at
 * `atlas-workspace.tsx:281` (`grid items-start gap-4 ...`); this spec proves the
 * dashboard rows now hug their own content too, and that the *other* column did
 * not collapse or clip when stretch stopped supplying its height.
 *
 * Run:
 *   node node_modules/@playwright/test/cli.js test e2e/web/dashboard-layout.spec.ts --project=web --reporter=list
 *
 * Evidence:
 *   .audit/dashboard-layout/dashboard-layout-1440.png
 *   .audit/dashboard-layout/dashboard-layout-390.png
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const DASHBOARD_PATH = "/w/roamlog-crew";
const SHOT_DIR = resolve(process.cwd(), ".audit/dashboard-layout");
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
/** Task threshold: anything above this is a visible stretched blank. */
const BLANK_LIMIT = 120;

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

async function openDashboard(page: Page): Promise<void> {
  await page.goto(DASHBOARD_PATH);
  await expect(page.getByRole("heading", { name: "旅行总览" })).toBeVisible({ timeout: 30_000 });
}

/** The next-trip hero card on the left of the first row. */
function nextTripCard(page: Page): Locator {
  return page.locator("section").filter({ hasText: "NEXT JOURNEY" }).first();
}

/** The "接下来" itinerary aside on the right of the first row. */
function upNextCard(page: Page): Locator {
  return page.locator("section").filter({ hasText: "UP NEXT" }).first();
}

interface ColumnMetrics {
  /** Rendered card height (border box). */
  height: number;
  width: number;
  /** Vertical offset, so the spec can prove both cards share one row. */
  top: number;
  /** Inner content height = height - paddingTop - paddingBottom. */
  contentHeight: number;
  /** Empty space between the last child and the card's bottom padding edge. */
  trailingBlank: number;
  /** Card's CSS align-self / parent's align-items for the row. */
  alignSelf: string;
  /** True when the card's children overflow the card (clipped content). */
  clipped: boolean;
  /** Card height when its own content is laid out at natural height. */
  naturalHeight: number;
}

/**
 * Measures a grid card. `naturalHeight` is read by temporarily neutralising the
 * stretched height, so the assertion can compare "what stretch gave it" against
 * "what its content needs" without depending on the neighbouring column.
 */
async function measureColumn(locator: Locator): Promise<ColumnMetrics> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const paddingTop = Number.parseFloat(style.paddingTop || "0");
    const paddingBottom = Number.parseFloat(style.paddingBottom || "0");
    const last = element.lastElementChild;
    const lastBottom = last ? last.getBoundingClientRect().bottom : box.top + paddingTop;

    // Natural height: hide the stretched auto height and let the content
    // decide, then restore. Only reads change; the DOM is put back immediately.
    const previousAlignSelf = element.style.alignSelf;
    element.style.alignSelf = "start";
    const naturalHeight = Math.round(element.getBoundingClientRect().height);
    element.style.alignSelf = previousAlignSelf;

    return {
      height: Math.round(box.height),
      width: Math.round(box.width),
      top: Math.round(box.top),
      contentHeight: Math.round(box.height - paddingTop - paddingBottom),
      trailingBlank: Math.round((box.bottom - lastBottom - paddingBottom) * 10) / 10,
      alignSelf: getComputedStyle(element).alignSelf,
      clipped: element.scrollHeight - element.clientHeight > 1,
      naturalHeight,
    };
  });
}

function logColumn(label: string, metrics: ColumnMetrics): void {
  console.log(`[dashboard-layout] ${label}=${JSON.stringify(metrics)}`);
}

/**
 * Reproduces the pre-fix geometry on the *current* build: temporarily restores
 * `align-items: normal` (grid's stretch default) on the row, measures the blank
 * band the old CSS produced, then puts the inline style back. This is how the
 * "before" number is re-measured instead of quoted from a previous bug report.
 */
async function blankWithStretch(
  locator: Locator,
): Promise<{ height: number; trailingBlank: number }> {
  return locator.evaluate((element) => {
    const row = element.parentElement as HTMLElement;
    const previous = row.style.alignItems;
    row.style.alignItems = "normal";
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const paddingBottom = Number.parseFloat(style.paddingBottom || "0");
    const last = element.lastElementChild;
    const lastBottom = last ? last.getBoundingClientRect().bottom : box.top;
    const measured = {
      height: Math.round(box.height),
      trailingBlank: Math.round((box.bottom - lastBottom - paddingBottom) * 10) / 10,
    };
    row.style.alignItems = previous;
    return measured;
  });
}

test("DASHBOARD_GRID_STRETCH — 1440px next-trip row hugs its content on both sides", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mkdir(SHOT_DIR, { recursive: true });

  await page.setViewportSize(DESKTOP);
  await login(page);
  await openDashboard(page);

  const nextTrip = nextTripCard(page);
  const upNext = upNextCard(page);
  await expect(nextTrip).toBeVisible();
  await expect(upNext).toBeVisible();

  // The row must have exactly the two children the fix was reasoned about: a
  // third child would be the one that could legitimately need `stretch`.
  const childCount = await upNext.evaluate(
    (element) => element.parentElement?.children.length ?? 0,
  );
  expect(childCount, "next-trip row has exactly two cards").toBe(2);

  const rowAlignItems = await upNext.evaluate(
    (element) => getComputedStyle(element.parentElement as HTMLElement).alignItems,
  );
  console.log(`[dashboard-layout] row align-items=${rowAlignItems}`);
  // Chromium reports the CSS Box Alignment alias for `align-items: start` as
  // "flow-start" (and older builds say "start"); both mean no stretching.
  expect(
    ["start", "flow-start", "flex-start"],
    `the row must not stretch its cards (align-items=${rowAlignItems})`,
  ).toContain(rowAlignItems);

  const left = await measureColumn(nextTrip);
  const right = await measureColumn(upNext);
  logColumn("desktop-1440 left(next-trip)", left);
  logColumn("desktop-1440 right(up-next)", right);

  // Re-measure the regression on this same build by restoring the old
  // `align-items: normal` for one frame: this is the "before" number.
  const beforeFix = await blankWithStretch(upNext);
  console.log(`[dashboard-layout] desktop-1440 before-fix 接下来=${JSON.stringify(beforeFix)}`);
  expect(
    beforeFix.trailingBlank,
    "the old stretch behaviour really produced a visible blank band",
  ).toBeGreaterThan(BLANK_LIMIT);
  expect(
    left.trailingBlank,
    `desktop-1440: 接下来 blank dropped from ${beforeFix.trailingBlank}px to ${right.trailingBlank}px`,
  ).toBeLessThan(BLANK_LIMIT);
  // The stretch also inflated the short card to the row height; the fix must
  // give the aside back its own content height.
  expect(right.height, "the aside is shorter than the stretch-inflated height").toBeLessThan(
    beforeFix.height - BLANK_LIMIT,
  );

  // 1. The user-visible symptom: empty space at the bottom of each card.
  expect(
    left.trailingBlank,
    `desktop-1440: next-trip trailing blank ${left.trailingBlank}px must be < ${BLANK_LIMIT}px`,
  ).toBeLessThan(BLANK_LIMIT);
  expect(
    right.trailingBlank,
    `desktop-1440: 接下来 trailing blank ${right.trailingBlank}px must be < ${BLANK_LIMIT}px`,
  ).toBeLessThan(BLANK_LIMIT);

  // 2. Each card is at its own natural height, not the row's max height.
  expect(
    Math.abs(left.height - left.naturalHeight),
    "desktop-1440: next-trip is not stretched beyond its content",
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(right.height - right.naturalHeight),
    "desktop-1440: 接下来 is not stretched beyond its content",
  ).toBeLessThanOrEqual(2);

  // 3. Both cards keep a real, usable size — no collapse from dropping stretch.
  expect(left.height, "desktop-1440: next-trip card keeps a real height").toBeGreaterThan(300);
  expect(right.height, "desktop-1440: 接下来 card keeps a real height").toBeGreaterThan(150);
  expect(left.width, "desktop-1440: next-trip keeps the wide column").toBeGreaterThan(600);
  expect(right.width, "desktop-1440: 接下来 keeps its 300px+ column").toBeGreaterThan(280);

  // 4. Both cards start on the same row line.
  expect(
    Math.abs(left.top - right.top),
    "desktop-1440: the two cards still share one row",
  ).toBeLessThanOrEqual(2);

  // 5. The other column must not be clipped now that it no longer receives the
  //    taller sibling's height. Every itinerary row (or the empty state) is
  //    inside the card.
  for (const column of [left, right]) {
    expect(column.clipped, "desktop-1440: no card clips its own content").toBe(false);
  }

  await expect(nextTrip.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(upNext.getByRole("heading", { name: "接下来" })).toBeVisible();

  const itineraryRows = upNext.locator(".space-y-3 > div");
  const rowCount = await itineraryRows.count();
  console.log(`[dashboard-layout] desktop-1440 itinerary rows=${rowCount}`);
  if (rowCount > 0) {
    // Stretch used to hide the fact that these rows are the aside's real content.
    const cardBox = (await upNext.boundingBox()) as NonNullable<
      Awaited<ReturnType<Locator["boundingBox"]>>
    >;
    for (let index = 0; index < rowCount; index += 1) {
      const row = itineraryRows.nth(index);
      await expect(row).toBeVisible();
      const rowBox = (await row.boundingBox()) as NonNullable<
        Awaited<ReturnType<Locator["boundingBox"]>>
      >;
      expect(
        rowBox.y + rowBox.height,
        `desktop-1440: itinerary row ${index} stays inside the 接下来 card`,
      ).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
    }
  } else {
    await expect(upNext.getByText("行程尚未排定")).toBeVisible();
  }

  // 6. Same-pattern grids on this page are logged so the repo-wide check in the
  //    report has numbers: the recent/budget row was already under threshold.
  const recentRow = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("section"));
    const read = (text: string) => {
      const element = sections.find((entry) => entry.textContent?.includes(text));
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const last = element.lastElementChild;
      const style = getComputedStyle(element);
      const paddingBottom = Number.parseFloat(style.paddingBottom || "0");
      return {
        height: Math.round(box.height),
        trailingBlank: last
          ? Math.round((box.bottom - last.getBoundingClientRect().bottom - paddingBottom) * 10) / 10
          : 0,
        parentAlignItems: element.parentElement
          ? getComputedStyle(element.parentElement).alignItems
          : "",
      };
    };
    return { recent: read("RECENTLY UPDATED"), budget: read("预算分布") };
  });
  console.log(`[dashboard-layout] recent-vs-budget=${JSON.stringify(recentRow)}`);
  for (const [name, value] of Object.entries(recentRow)) {
    if (!value) continue;
    expect(value.height, `desktop-1440: ${name} section renders real content`).toBeGreaterThan(50);
    expect(
      value.trailingBlank,
      `desktop-1440: ${name} trailing blank ${value.trailingBlank}px stays under threshold`,
    ).toBeLessThan(BLANK_LIMIT);
  }

  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`[dashboard-layout] desktop-1440 page height=${pageHeight}`);

  await page.screenshot({
    path: resolve(SHOT_DIR, "dashboard-layout-1440.png"),
    fullPage: true,
    animations: "disabled",
  });
});

/**
 * Repo-wide diagnostic: walks every workspace route and measures *every* grid
 * container that currently renders exactly two children, so "same pattern
 * elsewhere" is answered with rendered numbers instead of a grep guess.
 *
 * Formula per child: trailingBlank = card.bottom - lastChild.bottom -
 * paddingBottom, i.e. the empty band the user actually sees at the bottom.
 * Only rows that really produce a visible band (> 120px) need a fix; rows that
 * already carry `items-start` are reported as already-correct.
 */
test("DASHBOARD_GRID_STRETCH — every two-child grid in the app, measured in the browser", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize(DESKTOP);
  await login(page);

  // Discover a real trip id from the dashboard instead of hard-coding fixture data.
  await openDashboard(page);
  const tripHref = await page
    .locator('a[href*="/trips/"]')
    .evaluateAll((links) =>
      links
        .map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? "")
        .find((href) => /\/trips\/[^/]+$/.test(href) && !href.endsWith("/new")),
    );
  expect(tripHref, "a real trip link exists on the dashboard").toBeTruthy();
  const tripPath = tripHref as string;
  console.log(`[dashboard-layout] diagnostic trip path=${tripPath}`);

  const routes = [
    { name: "dashboard", path: DASHBOARD_PATH },
    { name: "trips", path: "/w/roamlog-crew/trips" },
    { name: "trip-detail", path: tripPath },
    { name: "trip-edit", path: `${tripPath}/edit` },
    { name: "trip-map", path: `${tripPath}/map` },
    { name: "map", path: "/w/roamlog-crew/map" },
    { name: "journal", path: "/w/roamlog-crew/journal" },
    { name: "insights", path: "/w/roamlog-crew/insights" },
    { name: "activity", path: "/w/roamlog-crew/activity" },
    { name: "members", path: "/w/roamlog-crew/members" },
    { name: "notifications", path: "/w/roamlog-crew/notifications" },
    { name: "settings", path: "/w/roamlog-crew/settings" },
    { name: "ai", path: "/w/roamlog-crew/ai" },
  ] as const;

  interface ChildMeasure {
    height: number;
    trailingBlank: number;
    text: string;
  }
  interface GridMeasure {
    className: string;
    alignItems: string;
    columns: string;
    children: ChildMeasure[];
  }

  const offenders: (GridMeasure & { route: string })[] = [];
  let measuredRows = 0;

  for (const route of routes) {
    await page.goto(route.path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    // Give grids a beat to receive their data-driven children.
    await page.waitForTimeout(600);

    const grids: GridMeasure[] = await page.evaluate(() => {
      const output: {
        className: string;
        alignItems: string;
        columns: string;
        children: { height: number; trailingBlank: number; text: string }[];
      }[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        const style = getComputedStyle(element);
        if (style.display !== "grid") continue;
        const columns = style.gridTemplateColumns;
        if (columns.trim().split(/\s+/).length < 2) continue;
        const kids = Array.from(element.children) as HTMLElement[];
        if (kids.length !== 2) continue;
        const children = kids.map((kid) => {
          const box = kid.getBoundingClientRect();
          const kidStyle = getComputedStyle(kid);
          const paddingBottom = Number.parseFloat(kidStyle.paddingBottom || "0");
          const last = kid.lastElementChild;
          const lastBottom = last ? last.getBoundingClientRect().bottom : box.top;
          return {
            height: Math.round(box.height),
            trailingBlank: Math.round((box.bottom - lastBottom - paddingBottom) * 10) / 10,
            text: (kid.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24),
          };
        });
        output.push({
          className: String(element.className ?? "").slice(0, 120),
          alignItems: style.alignItems,
          columns,
          children,
        });
      }
      return output;
    });

    const visited = await page.evaluate(() => ({
      path: location.pathname,
      heading:
        document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 30) ?? "",
    }));
    console.log(
      `[dashboard-layout] visited route=${route.name} path=${visited.path} h1="${visited.heading}" twoChildGrids=${grids.length}`,
    );

    for (const grid of grids) {
      measuredRows += 1;
      const worstBlank = Math.max(...grid.children.map((child) => child.trailingBlank));
      const stretched = !["start", "flow-start", "flex-start"].includes(grid.alignItems);
      console.log(
        `[dashboard-layout] grid route=${route.name} alignItems=${grid.alignItems}` +
          ` worstBlank=${worstBlank} class="${grid.className}"` +
          ` children=${JSON.stringify(grid.children.map((child) => child.height))}`,
      );
      if (stretched && worstBlank > BLANK_LIMIT) {
        offenders.push({ ...grid, route: route.name });
      }
    }
  }

  console.log(
    `[dashboard-layout] diagnostic summary: rows=${measuredRows} offenders=${offenders.length}`,
  );
  console.log(`[dashboard-layout] offenders=${JSON.stringify(offenders)}`);

  // Deliberately not asserted to zero: this task only owns the dashboard files,
  // so a non-dashboard offender is reported for a follow-up task instead of
  // silently failing this run. The report carries the per-row numbers.
  expect(measuredRows, "the diagnostic actually measured grids in the app").toBeGreaterThan(5);
});

test("DASHBOARD_GRID_STRETCH — 390px stacks the same cards without overflow", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(SHOT_DIR, { recursive: true });

  await page.setViewportSize(MOBILE);
  await login(page);
  await openDashboard(page);

  const nextTrip = nextTripCard(page);
  const upNext = upNextCard(page);
  await expect(nextTrip).toBeVisible();
  await expect(upNext).toBeVisible();

  // One column at this width: the stretch bug cannot apply, so this proves the
  // fix did not regress the stacked layout.
  const left = await measureColumn(nextTrip);
  const right = await measureColumn(upNext);
  logColumn("mobile-390 left(next-trip)", left);
  logColumn("mobile-390 right(up-next)", right);

  expect(left.trailingBlank, "mobile-390: next-trip trailing blank").toBeLessThan(BLANK_LIMIT);
  expect(right.trailingBlank, "mobile-390: 接下来 trailing blank").toBeLessThan(BLANK_LIMIT);
  expect(left.clipped, "mobile-390: next-trip is not clipped").toBe(false);
  expect(right.clipped, "mobile-390: 接下来 is not clipped").toBe(false);
  expect(left.height, "mobile-390: next-trip keeps real content").toBeGreaterThan(250);
  expect(right.height, "mobile-390: 接下来 keeps real content").toBeGreaterThan(120);

  // Stacked means the aside sits below the hero card, not beside it.
  expect(right.top, "mobile-390: 接下来 stacks below the next-trip card").toBeGreaterThan(
    left.top + left.height - 2,
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  console.log(`[dashboard-layout] mobile-390 horizontal overflow=${overflow}`);
  expect(overflow, "mobile-390: no horizontal overflow").toBeLessThanOrEqual(1);

  await page.screenshot({
    path: resolve(SHOT_DIR, "dashboard-layout-390.png"),
    fullPage: true,
    animations: "disabled",
  });
});
