import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { demoUser, demoWorkspaces, demoTrips } from "../../packages/api-mocks/src/fixtures";
import { demoMembers, demoNotifications } from "../../packages/api-mocks/src/demo-content";

const WORKSPACE = demoWorkspaces[0]!;
const WORKSPACE_PATH = `/w/${WORKSPACE.slug}`;
const OUT_DIR = path.resolve(process.cwd(), ".audit", "mobile-bottom-fix");

function cursorPage<T>(items: readonly T[]) {
  return { items, nextCursor: null, hasMore: false };
}

const appearance = {
  mode: "system",
  skin: "mercury",
  fontPairing: "fluent-native",
  source: "default",
  canOverride: true,
  updatedAt: null,
  defaults: {
    mode: "system",
    skin: "mercury",
    fontPairing: "fluent-native",
  },
} as const;

const aiModels = {
  models: [
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o mini",
      provider: "openai",
      reasoning: false,
      reasoningEfforts: [],
      vision: false,
    },
  ],
  defaultModel: "openai/gpt-4o-mini",
  reasoningSupported: false,
};

async function stubLayoutApi(page: Page): Promise<void> {
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (pathname === "/v1/auth/get-session") {
      await json({
        user: {
          id: demoUser.id,
          email: demoUser.email,
          name: demoUser.name,
          emailVerified: true,
        },
        session: {
          id: "0198f000-0000-7000-8000-0000000000ff",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
      });
      return;
    }
    if (pathname === "/v1/me" && method === "GET") {
      await json(demoUser);
      return;
    }
    if (pathname === "/v1/me/workspaces") {
      await json(demoWorkspaces);
      return;
    }
    if (pathname === "/v1/me/appearance") {
      await json(appearance);
      return;
    }
    if (pathname === "/v1/me/device" && method === "POST") {
      await json({});
      return;
    }
    if (pathname === "/v1/me/notifications") {
      await json(cursorPage(demoNotifications.slice(0, 3)));
      return;
    }
    if (pathname.endsWith("/members")) {
      await json(cursorPage(demoMembers));
      return;
    }
    if (pathname.endsWith("/trips")) {
      await json(cursorPage(demoTrips));
      return;
    }
    if (pathname.endsWith("/ai/models")) {
      await json(aiModels);
      return;
    }
    if (pathname.endsWith("/ai/conversations")) {
      await json({ items: [], nextCursor: null });
      return;
    }
    if (pathname === "/v1/public/settings") {
      await json({ settings: {}, generatedAt: new Date().toISOString() });
      return;
    }

    await json(
      {
        type: "about:blank",
        title: "Unexpected API request in layout test",
        status: 404,
        detail: `${method} ${pathname}`,
      },
      404,
    );
  });
}

async function boundingBox(page: Page, locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "element must have a measurable box").not.toBeNull();
  return box!;
}

async function scrollToDocumentBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.abs(
            window.scrollY +
              window.innerHeight -
              Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
          ) <= 2,
      ),
    )
    .toBe(true);
}

async function expectClickable(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = await boundingBox(page, locator);
  const hitTarget = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("[data-testid='trip-form-actions']") !== null;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hitTarget, "the action must be the topmost element at its center").toBe(true);
}

test.describe("mobile bottom navigation inset contract", () => {
  test("390px trip form actions clear the mobile nav and floating add button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubLayoutApi(page);
    await page.goto(`${WORKSPACE_PATH}/trips/new`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible();
    await scrollToDocumentBottom(page);

    const actions = page.getByTestId("trip-form-actions");
    const create = page.getByRole("button", { name: "创建旅行", exact: true });
    const cancel = page.getByRole("link", { name: "放弃修改", exact: true });
    const nav = page.getByRole("navigation", { name: "移动端主导航" });
    const quickAdd = nav.getByRole("link", { name: "新建旅行" });

    const [actionsBox, createBox, cancelBox, navBox, quickAddBox] = await Promise.all([
      boundingBox(page, actions),
      boundingBox(page, create),
      boundingBox(page, cancel),
      boundingBox(page, nav),
      boundingBox(page, quickAdd),
    ]);

    expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(
      Math.min(navBox.y, quickAddBox.y) - 4,
    );
    expect(createBox.y).toBeGreaterThanOrEqual(actionsBox.y);
    expect(cancelBox.y).toBeGreaterThanOrEqual(actionsBox.y);
    expect(createBox.y + createBox.height).toBeLessThanOrEqual(quickAddBox.y);
    expect(cancelBox.y + cancelBox.height).toBeLessThanOrEqual(quickAddBox.y);
    await expectClickable(page, create);
    await expectClickable(page, cancel);

    await create.click();
    await expect(page.getByText("请填写旅行标题").first()).toBeVisible();

    mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(OUT_DIR, "390-trip-form-actions.png"),
      animations: "disabled",
    });
  });

  test("1440px keeps the sticky form footer and hides the mobile nav", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stubLayoutApi(page);
    await page.goto(`${WORKSPACE_PATH}/trips/new`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible();
    await scrollToDocumentBottom(page);

    await expect(page.getByTestId("trip-form-actions")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "移动端主导航" })).toBeHidden();
    await expect(page.getByRole("button", { name: "创建旅行", exact: true })).toBeVisible();

    mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(OUT_DIR, "1440-trip-form-actions.png"),
      animations: "disabled",
    });
  });

  test("mobile AI surface clears the same nav and floating add button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubLayoutApi(page);
    await page.goto(`${WORKSPACE_PATH}/ai`, { waitUntil: "domcontentloaded" });

    const surface = page.getByTestId("ai-chat-shell");
    const composer = page.getByTestId("composer-root");
    const nav = page.getByRole("navigation", { name: "移动端主导航" });
    const quickAdd = nav.getByRole("link", { name: "新建旅行" });
    const [surfaceBox, composerBox, navBox, quickAddBox] = await Promise.all([
      boundingBox(page, surface),
      boundingBox(page, composer),
      boundingBox(page, nav),
      boundingBox(page, quickAdd),
    ]);

    expect(surfaceBox.y + surfaceBox.height).toBeLessThanOrEqual(
      Math.min(navBox.y, quickAddBox.y) - 4,
    );
    expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(quickAddBox.y - 4);

    mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(OUT_DIR, "390-ai-surface.png"),
      animations: "disabled",
    });
  });
});
