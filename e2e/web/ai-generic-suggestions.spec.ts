/**
 * The empty AI conversation exposes broad, user-goal prompts, not specific
 * destinations or internal workflow instructions. The prompts must live in the
 * thread content on both desktop and mobile, never in the composer's block.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  API_URL,
  OWNER_ACCOUNT,
  WEB_URL,
  findWorkspace,
  signInViaApi,
} from "../support/accounts";

const OUT_DIR = path.resolve(
  process.cwd(),
  ".audit",
  "ai-workflow-port",
  "prompt-cards-final",
);
const EVIDENCE_FILE = path.join(OUT_DIR, "evidence.json");
const GENERIC_PROMPTS = [
  "帮我规划一次旅行",
  "比较几个目的地",
  "整理行程和预算",
  "写一篇旅行日志",
] as const;

mkdirSync(OUT_DIR, { recursive: true });

async function openFreshThread(page: import("@playwright/test").Page): Promise<void> {
  const input = page.getByTestId("multimodal-input");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill("/new");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "从一个目标开始" })).toBeVisible({
    timeout: 30_000,
  });
}

test("ChatGPT-style starter prompts render inside the empty AI page", async ({ page }) => {
  test.setTimeout(120_000);
  await signInViaApi(page.request, OWNER_ACCOUNT, WEB_URL, API_URL);
  const workspace = await findWorkspace(page.request);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${WEB_URL}/w/${workspace.slug}/ai`, { waitUntil: "domcontentloaded" });
  await openFreshThread(page);

  const suggestions = page.getByTestId("suggested-actions");
  await expect(suggestions).toBeVisible();
  await expect(page.getByTestId("ai-empty-suggestions")).toBeVisible();
  await expect(page.getByTestId("composer-root").getByTestId("suggested-actions")).toHaveCount(0);
  const suggestionButtons = suggestions.getByRole("button");
  await expect(suggestionButtons).toHaveCount(GENERIC_PROMPTS.length);
  for (let index = 0; index < GENERIC_PROMPTS.length; index += 1) {
    await expect(suggestionButtons.nth(index)).toBeVisible();
  }

  const copy = await suggestions.innerText();
  for (const prompt of GENERIC_PROMPTS) expect(copy).toContain(prompt);
  expect(copy).not.toMatch(/京都|成都|杭州|古寺|湖边|需求摘要|现有方案|现有资料/u);

  const desktopShot = path.join(OUT_DIR, "ai-1440-empty.png");
  await page.screenshot({ path: desktopShot, animations: "disabled" });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openFreshThread(page);
  await expect(suggestions).toBeVisible();
  await expect(suggestionButtons).toHaveCount(GENERIC_PROMPTS.length);
  const desktopDarkShot = path.join(OUT_DIR, "ai-1440-empty-dark.png");
  await page.screenshot({ path: desktopDarkShot, animations: "disabled" });

  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openFreshThread(page);
  await expect(suggestions).toBeVisible();
  await expect(page.getByTestId("composer-root").getByTestId("suggested-actions")).toHaveCount(0);
  await expect(suggestionButtons).toHaveCount(GENERIC_PROMPTS.length);
  for (let index = 0; index < GENERIC_PROMPTS.length; index += 1) {
    await expect(suggestionButtons.nth(index)).toBeVisible();
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const mobileShot = path.join(OUT_DIR, "ai-390-empty.png");
  await page.screenshot({ path: mobileShot, animations: "disabled" });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openFreshThread(page);
  await expect(suggestions).toBeVisible();
  await expect(suggestionButtons).toHaveCount(GENERIC_PROMPTS.length);
  const mobileDarkShot = path.join(OUT_DIR, "ai-390-empty-dark.png");
  await page.screenshot({ path: mobileDarkShot, animations: "disabled" });

  await page.getByRole("button", { name: GENERIC_PROMPTS[0] }).click();
  await expect(page.getByTestId("message-user").last()).toBeVisible({ timeout: 30_000 });
  const sentShot = path.join(OUT_DIR, "ai-390-sent.png");
  await page.screenshot({ path: sentShot, animations: "disabled" });

  writeFileSync(
    EVIDENCE_FILE,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        workspace: workspace.slug,
        prompts: GENERIC_PROMPTS,
        placement: "thread-empty-state",
        composerContainsSuggestions: false,
        cardsVisible: GENERIC_PROMPTS.length,
        overflow,
        screenshots: [
          path.relative(process.cwd(), desktopShot).split(path.sep).join("/"),
          path.relative(process.cwd(), desktopDarkShot).split(path.sep).join("/"),
          path.relative(process.cwd(), mobileShot).split(path.sep).join("/"),
          path.relative(process.cwd(), mobileDarkShot).split(path.sep).join("/"),
          path.relative(process.cwd(), sentShot).split(path.sep).join("/"),
        ],
      },
      null,
      2,
    )}\n`,
  );
});
