/**
 * AI_WORKFLOW_ACCEPTANCE_FINAL — real AI, real API and real database.
 *
 * The final flow is model-driven:
 *   missing information -> ask_user form (no plan)
 *   sufficient information -> confirm_brief summary (no plan until accepted)
 *   accepted summary -> read-only tool work -> detailed plan confirmation.
 *
 * Run:
 *   node node_modules/@playwright/test/cli.js test \
 *     e2e/web/ai-interaction-refactor.spec.ts --project=web --workers=1
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_ANSWER_PROFILE,
  answerAskUserForm,
  chooseReasoningEffort,
  cleanupConversation,
  confirmBriefIfPresent,
  driveToPlan,
  openAi,
  sendPrompt,
  waitForRunEnd,
} from "../ai-workflow-support";

test.use({ trace: "off", video: "off" });
test.describe.configure({ mode: "serial", retries: 0 });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-workflow-port", "final");

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

test.describe("AI workflow acceptance", () => {
  test("vague request opens a human question form and never plans", async ({ page }) => {
    test.setTimeout(420_000);
    await openAi(page);
    try {
      await sendPrompt(page, "帮我安排一次旅行");
      await expect(page.getByTestId("ask-user-tool").last()).toBeVisible({
        timeout: 300_000,
      });
      await expect(
        page
          .getByTestId("ask-user-tool")
          .last()
          .locator('[data-testid^="ask-user-question-"]')
          .first(),
      ).toBeVisible();
      await expect(page.getByTestId("plan-confirm")).toHaveCount(0);
      await shot(page, "01-vague-human-form-1440");
    } finally {
      await cleanupConversation(page);
    }
  });

  test("answers persist across turns and a brief is confirmed before a plan", async ({
    page,
  }) => {
    test.setTimeout(720_000);
    await openAi(page);
    try {
      await chooseReasoningEffort(page, "low");
      await sendPrompt(page, "我想去京都旅行，帮我做计划");
      await expect(page.getByTestId("ask-user-tool").last()).toBeVisible({
        timeout: 300_000,
      });
      await answerAskUserForm(page);

      await expect(page.getByTestId("ask-user-result").first()).toBeVisible();
      await expect(page.getByTestId("plan-confirm")).toHaveCount(0);

      if ((await page.getByTestId("confirm-brief-tool").count()) === 0) {
        await expect(page.getByTestId("ask-user-tool").last()).toBeVisible({
          timeout: 300_000,
        });
        await answerAskUserForm(page);
      }

      await expect(page.getByTestId("confirm-brief-tool").last()).toBeVisible({
        timeout: 300_000,
      });
      await shot(page, "02-confirm-brief-1440");
      await confirmBriefIfPresent(page);
      await driveToPlan(page);
      await expect(page.getByTestId("plan-confirm").last()).toBeVisible({
        timeout: 300_000,
      });
      await shot(page, "03-confirmed-plan-1440");
    } finally {
      await cleanupConversation(page);
    }
  });

  test("changing the destination and budget replaces the previous brief", async ({
    page,
  }) => {
    test.setTimeout(720_000);
    await openAi(page);
    try {
      await sendPrompt(page, "帮我计划一次旅行，目的地之后再说");
      await expect(page.getByTestId("ask-user-tool").last()).toBeVisible({
        timeout: 300_000,
      });
      for (let round = 0; round < 3; round += 1) {
        if (await answerAskUserForm(page, DEFAULT_ANSWER_PROFILE)) {
          if (
            (await page.getByTestId("confirm-brief-tool").count()) > 0
          ) {
            break;
          }
          continue;
        }
        break;
      }

      const briefs = page.getByTestId("confirm-brief-tool");
      const firstBrief = page.getByTestId("confirm-brief-tool").last();
      await expect(firstBrief).toBeVisible({ timeout: 300_000 });
      const briefsBeforeRevision = await briefs.count();
      await firstBrief.getByRole("button", { name: "继续修改" }).click();
      await firstBrief
        .getByRole("textbox", { name: "怎么修改这份摘要？" })
        .fill("目的地改为大阪，行程 3 天，总预算 5000 元；其他按当前摘要。");
      await firstBrief.getByRole("button", { name: "提交修改" }).click();
      await expect(firstBrief).toContainText("已提交修改意见");
      await waitForRunEnd(page);
      await expect
        .poll(async () => briefs.count(), {
          message: "修订提交后必须生成新的需求摘要，而不是复用旧摘要",
          timeout: 300_000,
        })
        .toBeGreaterThan(briefsBeforeRevision);

      const revisedBrief = briefs.last();
      await expect(
        revisedBrief.getByRole("button", { name: "确认并生成计划" }),
      ).toBeVisible({ timeout: 300_000 });
      const revisedText = (await revisedBrief.innerText()).trim();
      expect(revisedText).toMatch(/大阪/u);
      expect(revisedText).toMatch(/5000/u);
      expect(revisedText).toMatch(/3\s*天/u);
      expect(revisedText).not.toMatch(/(目的地|主要目的地|前往)[：:\s]*京都/u);
      await shot(page, "04-revised-brief-1440");
    } finally {
      await cleanupConversation(page);
    }
  });

  test("detailed plan exposes dates, days, transport, budget, packing and assumptions", async ({
    page,
  }) => {
    test.setTimeout(900_000);
    await openAi(page);
    try {
      await chooseReasoningEffort(page, "low");
      await sendPrompt(
        page,
        "2027 年 4 月 2 日到 6 日从上海去京都，两个人，总预算 8000 元含往返机票，住宿住商务酒店即可，节奏慢，喜欢古寺和咖啡。请先确认你的假设，再给出详细计划。",
      );
      await driveToPlan(page);
      const plan = page.getByTestId("plan-confirm").last();
      await expect(plan).toBeVisible({ timeout: 300_000 });
      const surface = page.getByTestId("plan-surface").last();
      await expect(surface).toBeVisible();

      // Only the plan card counts. The assistant bubble and the card header
      // must not be able to make a short "draft created" answer pass.
      const message = surface.getByTestId("plan-message");
      await expect(message).toBeVisible();
      const planText = (await message.innerText()).trim();
      expect(planText.length).toBeGreaterThan(20);
      expect(planText).not.toMatch(/草稿已建立|确认后继续|稍后补充|will add/iu);
      // The confirmed budget is CNY; a bare JPY/USD relabel is a product
      // defect even when the surrounding itinerary is otherwise complete.
      // A local price is valid only when the same line states its conversion.
      const foreignBudgetClaims = planText
        .split(/\r?\n/u)
        .filter(
          (line) =>
            /(?:日元|日币|JPY|美元|美金|USD)/iu.test(line) &&
            /\d/u.test(line) &&
            !/(?:现金|零钱|钱包|约合|折合|汇率|≈|兑换|换算)/iu.test(line) &&
            !/[（(][^)）]*(?:CNY|RMB|人民币|元)[^)）]*[)）]/iu.test(line),
        );
      expect(foreignBudgetClaims).toEqual([]);

      const details = surface.getByTestId("plan-details");
      await expect(details).toBeVisible();
      await expect(surface.getByTestId("plan-days")).toBeVisible();
      await expect(surface.getByTestId("plan-detail-day").first()).toBeVisible();
      await expect(surface.getByTestId("plan-budget")).toBeVisible();
      expect(
        (await surface.getByTestId("plan-assumptions").count()) +
          (await surface.getByTestId("plan-risks").count()),
      ).toBeGreaterThan(0);

      const detailText = await details.innerText();
      expect(detailText.length).toBeGreaterThan(200);
      expect(detailText).toMatch(/2027-04-0[2-6]|4\s*\/\s*[2-6]/u);
      expect(detailText).toMatch(/第\s*[一二三四五1-5]\s*天|2027-04-0[2-6]/u);
      expect(detailText).toMatch(/\d{1,2}:\d{2}|上午|下午|晚上/u);
      expect(detailText).toMatch(/交通|地铁|公交|步行|HARUKA|机场|住宿|酒店/u);
      expect(detailText).toMatch(/预算|CNY|8,000/u);
      expect(detailText).toMatch(/风险|备选|假设|注意/u);
      await shot(page, "05-detailed-plan-1440");
      await details.scrollIntoViewIfNeeded();
      await shot(page, "05b-plan-details-1440");
      await surface.getByTestId("plan-days").scrollIntoViewIfNeeded();
      await shot(page, "05c-plan-days-1440");

      await page.setViewportSize({ width: 390, height: 844 });
      await details.scrollIntoViewIfNeeded();
      await expect(surface.getByTestId("plan-days")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await surface.getByTestId("plan-days").scrollIntoViewIfNeeded();
      await shot(page, "05d-plan-details-390");
    } finally {
      await cleanupConversation(page);
    }
  });

  test("reasoning is collapsed by default and readable on demand", async ({ page }) => {
    test.setTimeout(600_000);
    await openAi(page);
    try {
      await sendPrompt(page, "请用两步分析一下京都四月适合看什么，并解释取舍。");
      await waitForRunEnd(page);
      const reasoning = page.getByTestId("message-reasoning").last();
      await expect(reasoning).toBeVisible({ timeout: 60_000 });
      const trigger = reasoning.getByRole("button").first();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(reasoning).toContainText("模型原始思考");
      await shot(page, "06-reasoning-1440");
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(reasoning).toContainText("以下是模型返回的原始思考");
      await expect(reasoning).not.toContainText("正在思考…");
    } finally {
      await cleanupConversation(page);
    }
  });

  test("tool execution is visible while it is running", async ({ page }) => {
    test.setTimeout(720_000);
    await openAi(page);
    try {
      await sendPrompt(page, "搜索京都清水寺，并告诉我附近适合慢慢走的一条路线。");
      const tool = page
        .locator("main")
        .getByRole("button", { name: /^搜索地点/u })
        .first();
      await expect(tool).toHaveAttribute("aria-label", /搜索地点 运行中/u, {
        timeout: 300_000,
      });
      const runningText = await tool.innerText();
      await shot(page, "07-tool-running-1440");
      expect(runningText).toMatch(/运行|正在|搜索|查询|进度/u);
      await waitForRunEnd(page);
      await expect(tool).toHaveAttribute("aria-label", /搜索地点 (完成|错误)/u);
    } finally {
      await cleanupConversation(page);
    }
  });

  test("refresh preserves the pending human form and does not duplicate messages", async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await openAi(page);
    try {
      await sendPrompt(page, "帮我规划一次旅行");
      await expect(page.getByTestId("ask-user-tool").last()).toBeVisible({
        timeout: 300_000,
      });
      const idBefore = new URL(page.url()).searchParams.get("conversation");
      expect(idBefore).toBeTruthy();

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("ask-user-tool").last()).toBeVisible({
        timeout: 60_000,
      });
      await expect(
        page.getByTestId("ask-user-tool").last().getByRole("button", { name: "提交回答" }),
      ).toBeVisible();
      await expect(page.getByTestId("plan-confirm")).toHaveCount(0);
      expect(await page.getByTestId("message-assistant").count()).toBe(1);
      await shot(page, "08-refresh-human-form-1440");
    } finally {
      await cleanupConversation(page);
    }
  });

  test("human form and plan controls are usable at 390px", async ({ page }) => {
    test.setTimeout(600_000);
    await openAi(page);
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await sendPrompt(page, "帮我安排一次旅行");
      await expect(page.getByTestId("ask-user-tool").last()).toBeVisible({
        timeout: 300_000,
      });
      await expect(page.getByTestId("multimodal-input")).toBeVisible();
      await expect(page.getByTestId("send-button")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await shot(page, "09-human-form-390");
    } finally {
      await cleanupConversation(page);
    }
  });
});
