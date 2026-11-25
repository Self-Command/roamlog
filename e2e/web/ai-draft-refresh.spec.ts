/**
 * Human-tool draft persistence — real login, API, database and model.
 *
 * The user starts a vague planning request, fills an unanswered form field,
 * refreshes the page, and must see the same value again. This specifically
 * guards the gap in the previous acceptance, which only asserted that an empty
 * pending form survived a reload.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_ANSWER_PROFILE,
  answerAskUserForm,
  cleanupConversation,
  openAi,
  sendPrompt,
  waitForRunEnd,
} from "../ai-workflow-support";

test.use({ trace: "off", video: "off" });
test.describe.configure({ mode: "serial", retries: 0 });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-workflow-port", "draft");

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

async function driveToConfirmBrief(page: Page): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    const brief = page.getByTestId("confirm-brief-tool").last();
    if ((await brief.count()) > 0 && (await brief.isVisible().catch(() => false))) {
      return;
    }
    if (await answerAskUserForm(page, DEFAULT_ANSWER_PROFILE)) continue;
    await waitForRunEnd(page);
    await page.waitForTimeout(500);
  }
  throw new Error("AI did not reach confirm_brief within the allowed rounds.");
}

test("pending ask_user values survive a real page refresh", async ({ page }) => {
  test.setTimeout(720_000);
  await openAi(page);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await sendPrompt(page, "帮我安排一次旅行");

    const form = page.getByTestId("ask-user-tool").last();
    await expect(form).toBeVisible({ timeout: 300_000 });
    const question = form.locator('[data-testid^="ask-user-question-"]').first();
    await expect(question).toBeVisible();
    const questionTestId = await question.getAttribute("data-testid");
    expect(questionTestId).toBeTruthy();

    const field = question
      .locator('textarea, input[type="text"], input[type="number"], input[type="date"]')
      .first();
    await expect(field).toBeVisible();
    const marker = `草稿恢复-${Date.now()}`;
    await field.fill(marker);
    await expect(field).toHaveValue(marker);

    await expect
      .poll(
        () =>
          page.evaluate(
            (value) =>
              Object.keys(window.localStorage).some((key) => {
                if (!key.startsWith("roamlog.ai.human-drafts.")) return false;
                return (window.localStorage.getItem(key) ?? "").includes(value);
              }),
            marker,
          ),
        { timeout: 20_000 },
      )
      .toBe(true);

    await shot(page, "01-before-refresh-1440");
    await page.reload({ waitUntil: "domcontentloaded" });

    const restoredForm = page.getByTestId("ask-user-tool").last();
    await expect(restoredForm).toBeVisible({ timeout: 60_000 });
    const restoredQuestion = restoredForm.locator(`[data-testid="${questionTestId}"]`);
    const restoredField = restoredQuestion
      .locator('textarea, input[type="text"], input[type="number"], input[type="date"]')
      .first();
    await expect(restoredField).toHaveValue(marker, { timeout: 30_000 });
    await shot(page, "02-after-refresh-1440");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(restoredField).toHaveValue(marker);
    await shot(page, "03-after-refresh-390");
  } finally {
    await cleanupConversation(page);
  }
});

test("confirm_brief revision draft survives a real page refresh", async ({ page }) => {
  test.setTimeout(900_000);
  await openAi(page);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await sendPrompt(
      page,
      "2027 年 4 月 2 日到 6 日从上海去京都，两个人，总预算 8000 元含往返机票，住宿住商务酒店即可，节奏慢，喜欢古寺和咖啡。请先确认需求摘要，再给出详细计划。",
    );
    await driveToConfirmBrief(page);

    const brief = page.getByTestId("confirm-brief-tool").last();
    await expect(brief).toBeVisible({ timeout: 300_000 });
    await brief.getByRole("button", { name: "继续修改" }).click();
    const revision = brief.getByRole("textbox", { name: "怎么修改这份摘要？" });
    const marker = `修改草稿恢复-${Date.now()}`;
    await revision.fill(marker);
    await expect(revision).toHaveValue(marker);

    await expect
      .poll(
        () =>
          page.evaluate(
            (value) =>
              Object.keys(window.localStorage).some((key) => {
                if (!key.startsWith("roamlog.ai.human-drafts.")) return false;
                return (window.localStorage.getItem(key) ?? "").includes(value);
              }),
            marker,
          ),
        { timeout: 20_000 },
      )
      .toBe(true);

    await shot(page, "04-brief-before-refresh-1440");
    await page.reload({ waitUntil: "domcontentloaded" });

    const restoredBrief = page.getByTestId("confirm-brief-tool").last();
    await expect(restoredBrief).toBeVisible({ timeout: 60_000 });
    const restoredRevision = restoredBrief.getByRole("textbox", {
      name: "怎么修改这份摘要？",
    });
    await expect(restoredRevision).toHaveValue(marker, { timeout: 30_000 });
    await restoredRevision.scrollIntoViewIfNeeded();
    await shot(page, "05-brief-after-refresh-1440");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(restoredRevision).toHaveValue(marker);
    await restoredRevision.scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, "06-brief-after-refresh-390");
  } finally {
    await cleanupConversation(page);
  }
});
