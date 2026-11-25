/**
 * Human-tool dismissal acceptance.
 *
 * Uses the same real login/API/model fixtures as the AI workflow suite. The
 * assertions deliberately stay on the visible form/receipt and plan card: a
 * cancellation must settle the pending tool without opening a plan.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  answerAskUserForm,
  cleanupConversation,
  openAi,
  sendPrompt,
  waitForRunEnd,
} from "../ai-workflow-support";

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-workflow-port", "cancel");

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.describe.configure({ mode: "serial" });

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

test("dismissing ask_user settles the form and never opens a plan", async ({ page }) => {
  test.setTimeout(600_000);
  await openAi(page);
  try {
    await sendPrompt(page, "帮我安排一次旅行");
    const form = page.getByTestId("ask-user-tool").last();
    await expect(form).toBeVisible({ timeout: 300_000 });

    await form.getByRole("button", { name: "暂不回答" }).click();
    await expect(page.getByTestId("ask-user-result").last()).toContainText(
      "本次提问已取消",
    );
    await waitForRunEnd(page);
    await expect(page.getByTestId("plan-confirm")).toHaveCount(0);
    await shot(page, "ask-user-cancel-1440");
  } finally {
    await cleanupConversation(page);
  }
});

test("dismissing ask_user remains usable at 390px", async ({ page }) => {
  test.setTimeout(600_000);
  await openAi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await sendPrompt(page, "帮我安排一次旅行");
    const form = page.getByTestId("ask-user-tool").last();
    await expect(form).toBeVisible({ timeout: 300_000 });
    await form.getByRole("button", { name: "暂不回答" }).click();
    await expect(page.getByTestId("ask-user-result").last()).toContainText(
      "本次提问已取消",
    );
    await waitForRunEnd(page);
    await expect(page.getByTestId("plan-confirm")).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByTestId("ask-user-result").last().scrollIntoViewIfNeeded();
    await shot(page, "ask-user-cancel-390");
  } finally {
    await cleanupConversation(page);
  }
});

test("dismissing confirm_brief settles the gate and never opens a plan", async ({
  page,
}) => {
  test.setTimeout(720_000);
  await openAi(page);
  try {
    await sendPrompt(
      page,
      "2027 年 4 月 2 日到 6 日从上海去京都，两个人，总预算 8000 元含往返机票，住商务酒店，节奏慢，喜欢古寺和咖啡。请先确认需求摘要。",
    );

    for (let round = 0; round < 4; round += 1) {
      if (await answerAskUserForm(page)) continue;
      if ((await page.getByTestId("confirm-brief-tool").count()) > 0) break;
      await waitForRunEnd(page);
    }

    const brief = page.getByTestId("confirm-brief-tool").last();
    await expect(brief).toBeVisible({ timeout: 300_000 });
    await brief.getByRole("button", { name: "取消本次" }).click();
    await expect(page.getByTestId("confirm-brief-tool").last()).toContainText(
      "已取消需求确认",
    );
    await waitForRunEnd(page);
    await expect(page.getByTestId("plan-confirm")).toHaveCount(0);
    await shot(page, "confirm-brief-cancel-1440");
  } finally {
    await cleanupConversation(page);
  }
});
