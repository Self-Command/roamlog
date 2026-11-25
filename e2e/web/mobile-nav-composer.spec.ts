/**
 * Real-browser regression checks for the two mobile composer/navigation bugs
 * reported from a production screenshot:
 *
 * - the fixed mobile navigation must use the active theme surface, never a
 *   hard-coded black bar that makes the map tab unreadable;
 * - the AI composer must stay compact while empty and grow only as text grows.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  API_URL,
  OWNER_ACCOUNT,
  WEB_URL,
  findWorkspace,
  signInViaApi,
} from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

const OUT_DIR = path.resolve(
  process.cwd(),
  ".audit",
  "ai-workflow-port",
  "mobile-nav-composer",
);
const EVIDENCE_FILE = path.join(OUT_DIR, "evidence.json");

type Mode = "light" | "dark";

interface Evidence {
  generatedAt: string;
  workspace: string;
  surfaces: Array<{
    name: string;
    mode: Mode;
    viewport: string;
    screenshot: string;
    navBackground: string;
    activeItem: string | null;
    composerHeight: number;
    inputHeight: number;
    overflow: number;
  }>;
}

const evidence: Evidence = {
  generatedAt: new Date().toISOString(),
  workspace: "",
  surfaces: [],
};

mkdirSync(OUT_DIR, { recursive: true });

function appearanceCookie(mode: Mode): string {
  return encodeURIComponent(
    JSON.stringify({
      v: 1,
      mode,
      skin: "fluent",
      fontPairing: "fluent-native",
    }),
  );
}

async function setMode(
  page: Page,
  context: BrowserContext,
  mode: Mode,
): Promise<void> {
  const response = await page.request.put(`${WEB_URL}/v1/me/appearance`, {
    data: { mode, skin: "fluent", fontPairing: "fluent-native" },
  });
  expect(response.status(), await response.text()).toBe(200);
  await context.addCookies([
    {
      name: "roamlog_appearance",
      value: appearanceCookie(mode),
      domain: new URL(WEB_URL).hostname,
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}

async function openFreshAi(page: Page, workspaceSlug: string): Promise<void> {
  await page.goto(`${WEB_URL}/w/${workspaceSlug}/ai`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({
    timeout: 30_000,
  });

  const newConversation = page.getByRole("button", { name: "新建会话" }).first();
  if (await newConversation.isVisible().catch(() => false)) {
    await newConversation.click();
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
  }

  await page.evaluate(() => window.localStorage.removeItem("input"));
  await page.getByTestId("multimodal-input").fill("");
}

async function measureComposer(page: Page): Promise<{
  composerHeight: number;
  inputHeight: number;
}> {
  const composer = page.getByTestId("composer-root");
  const input = page.getByTestId("multimodal-input");
  const [composerBox, inputBox] = await Promise.all([
    composer.boundingBox(),
    input.boundingBox(),
  ]);
  expect(composerBox, "composer must have a measurable box").not.toBeNull();
  expect(inputBox, "composer input must have a measurable box").not.toBeNull();
  return {
    composerHeight: Math.round(composerBox!.height * 10) / 10,
    inputHeight: Math.round(inputBox!.height * 10) / 10,
  };
}

async function capture(
  page: Page,
  name: string,
  mode: Mode,
  viewport: string,
  options: {
    includeComposer?: boolean;
    maxComposerHeight?: number;
  } = {},
): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const screenshot = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({
    path: screenshot,
    animations: "disabled",
  });

  const metrics = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(
      'nav[aria-label="移动端主导航"]',
    );
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    return {
      navBackground: nav ? getComputedStyle(nav).backgroundColor : "",
      activeItem: active?.textContent?.trim() ?? null,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
  const heights =
    options.includeComposer === false
      ? { composerHeight: 0, inputHeight: 0 }
      : await measureComposer(page);

  evidence.surfaces.push({
    name,
    mode,
    viewport,
    screenshot: path.relative(process.cwd(), screenshot).split(path.sep).join("/"),
    navBackground: metrics.navBackground,
    activeItem: metrics.activeItem,
    composerHeight: heights.composerHeight,
    inputHeight: heights.inputHeight,
    overflow: metrics.overflow,
  });

  expect(metrics.navBackground, `${name}: nav must follow the light surface`).not.toMatch(
    /rgba?\(\s*0\s*,\s*0\s*,\s*0/iu,
  );
  expect(metrics.overflow, `${name}: horizontal overflow`).toBeLessThanOrEqual(1);
  if (options.maxComposerHeight !== undefined) {
    expect(heights.composerHeight, `${name}: composer height`).toBeLessThan(
      options.maxComposerHeight,
    );
  }
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("mobile navigation follows the theme and the AI composer stays compact", async ({
  context,
  page,
}) => {
  await signInViaApi(page.request, OWNER_ACCOUNT, WEB_URL, API_URL);
  const workspace = await findWorkspace(page.request);
  evidence.workspace = workspace.slug;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openFreshAi(page, workspace.slug);

  for (const mode of ["light", "dark"] satisfies Mode[]) {
    await setMode(page, context, mode);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    await openFreshAi(page, workspace.slug);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
    await capture(page, `ai-1440-empty-${mode}`, mode, "1440x1000", {
      maxComposerHeight: 180,
    });

    await page.getByTestId("multimodal-input").fill("从上海去京都，五天，两个人。");
    await capture(page, `ai-1440-one-line-${mode}`, mode, "1440x1000");

    await page
      .getByTestId("multimodal-input")
      .fill(
        [
          "从上海去京都，五天，两个人。",
          "预算 8000 元，包含往返机票。",
          "住京都站附近的商务酒店。",
          "节奏慢一点，每天两到三个安排。",
          "想看古寺和咖啡店。",
          "不安排跨城一日游。",
          "尽量少走路，保留休息时间。",
          "请先问我缺少的信息。",
        ].join("\n"),
      );
    await capture(page, `ai-1440-multiline-${mode}`, mode, "1440x1000");
    await page.getByTestId("multimodal-input").fill("");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await openFreshAi(page, workspace.slug);
    await expectNoHorizontalOverflow(page, `AI ${mode} 390`);

    const more = page
      .getByRole("navigation", { name: "移动端主导航" })
      .getByRole("link", { name: "更多" });
    await expect(more).toHaveAttribute("aria-current", "page");
    await capture(page, `ai-390-empty-${mode}`, mode, "390x844", {
      maxComposerHeight: 180,
    });

    await page.goto(`${WEB_URL}/w/${workspace.slug}/map`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("navigation", { name: "移动端主导航" }).getByRole("link", {
        name: "地图",
      }),
    ).toHaveAttribute("aria-current", "page");
    await capture(page, `map-390-${mode}`, mode, "390x844", {
      includeComposer: false,
    });
  }
});

test.afterAll(() => {
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
});
