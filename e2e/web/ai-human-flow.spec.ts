import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { OWNER_ACCOUNT, WEB_URL, findWorkspace, loginOnWeb } from "../support/accounts";

test.use({ trace: "off", video: "off" });
test.describe.configure({ mode: "serial", retries: 0 });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-workflow-port", "human-tool");
const WORKSPACE_SLUG = process.env.E2E_AI_WORKSPACE_SLUG ?? "verify-crew";

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

async function openAi(page: Page): Promise<void> {
  await loginOnWeb(page, OWNER_ACCOUNT);
  await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}/ai`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });
}

function conversationId(page: Page): string | null {
  return new URL(page.url()).searchParams.get("conversation");
}

async function waitForRunEnd(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0, {
    timeout: 360_000,
  });
}

async function answerQuestionForm(page: Page): Promise<boolean> {
  const form = page.getByTestId("ask-user-tool");
  if ((await form.count()) === 0) return false;

  const questions = form.locator('[data-testid^="ask-user-question-"]');
  const count = await questions.count();
  if (count === 0) return false;

  for (let index = 0; index < count; index += 1) {
    const question = questions.nth(index);
    const prompt = (await question.innerText()).trim();

    const choices = question.getByRole("radio").or(question.getByRole("checkbox"));
    if ((await choices.count()) > 0) {
      const selected = question.locator('[aria-checked="true"]');
      if ((await selected.count()) === 0) {
        const labels = await choices.allInnerTexts();
        const preferred = labels.findIndex((label) =>
          /同行|人数|和谁/iu.test(prompt)
            ? /两个人|两人的|情侣|朋友|家庭/iu.test(label)
            : /偏好|喜欢|兴趣/iu.test(prompt)
              ? /人文|文化|美食|咖啡|古寺/iu.test(label)
              : false,
        );
        await choices.nth(preferred >= 0 ? preferred : 0).click();
      }
    }

    const fields = question.locator("textarea, input");
    const fieldCount = await fields.count();
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      const field = fields.nth(fieldIndex);
      const type = (await field.getAttribute("type")) ?? "textarea";
      if (await field.isDisabled()) continue;
      if (type === "date") {
        await field.fill(/结束|返程|离开/iu.test(prompt) ? "2027-09-14" : "2027-09-10");
      } else if (type === "number") {
        await field.fill(
          /预算|费用|budget/iu.test(prompt)
            ? "8000"
            : /天|晚|时长|duration/iu.test(prompt)
              ? "5"
              : "2",
        );
      } else {
        await field.fill(
          /出发|origin|从哪/iu.test(prompt)
            ? "上海"
            : /预算|费用|budget/iu.test(prompt)
              ? "总预算 8000 元"
              : /目的地|去哪|哪里|destination/iu.test(prompt)
                ? "京都"
                : "两个人，慢节奏，喜欢古寺和咖啡，没有其他特别要求。",
        );
      }
    }
  }

  await form.getByRole("button", { name: "提交回答" }).click();
  await waitForRunEnd(page);
  return true;
}

async function confirmBriefIfPresent(page: Page): Promise<boolean> {
  const confirmation = page.getByTestId("confirm-brief-tool");
  if ((await confirmation.count()) === 0) return false;

  const confirm = confirmation.getByRole("button", { name: "确认并生成计划" });
  const confirmCount = await confirm.count();
  if (confirmCount === 0) return false;
  if (await confirm.isEnabled()) {
    await shot(page, "02-confirm-brief-1440");
    await confirm.click();
    await waitForRunEnd(page);
    return true;
  }

  const revise = confirmation.getByRole("button", { name: "继续修改" });
  await revise.click();
  await confirmation
    .getByRole("textbox", { name: "怎么修改这份摘要？" })
    .fill("没有其他要求，请移除未解决问题并按当前摘要生成详细计划。");
  await confirmation.getByRole("button", { name: "提交修改" }).click();
  await waitForRunEnd(page);
  return true;
}

test("clarification form drives an explicit brief confirmation before the plan", async ({
  page,
}) => {
  test.setTimeout(720_000);
  await openAi(page);
  const workspace = await findWorkspace(page.request);
  try {
    const composer = page.getByTestId("multimodal-input");
    await composer.fill("帮我安排一次旅行");
    await composer.press("Enter");
    await expect(page.getByTestId("ask-user-tool")).toBeVisible({ timeout: 240_000 });
    await shot(page, "01-ask-user-form-1440");

    for (let round = 0; round < 4; round += 1) {
      if (await answerQuestionForm(page)) {
        if (await confirmBriefIfPresent(page)) continue;
        continue;
      }
      if (await confirmBriefIfPresent(page)) continue;
      await waitForRunEnd(page);
      if ((await page.getByTestId("ask-user-tool").count()) > 0) continue;
      if (
        (await page
          .getByTestId("confirm-brief-tool")
          .getByRole("button", { name: "确认并生成计划" })
          .count()) > 0
      ) {
        continue;
      }
      break;
    }

    await waitForRunEnd(page);
    const plan = page
      .getByTestId("message-assistant")
      .last()
      .locator('[data-testid="plan-confirm"]')
      .first();
    await expect(plan).toBeVisible({ timeout: 300_000 });
    const text = await page.getByTestId("message-assistant").last().innerText();
    expect(text).toMatch(/2027|9 月|五天|5 天|第\s*[一1]\s*天/u);
    expect(text).toMatch(/预算|8000|费用/u);
    expect(text).toMatch(/交通|步行|地铁|公交/u);
    await shot(page, "03-approved-plan-1440");

    await expect(page.getByTestId("ask-user-result").first()).toBeVisible();
    await expect(page.getByTestId("confirm-brief-tool").first()).toBeVisible();
  } finally {
    const id = conversationId(page);
    if (id) {
      await page.request
        .delete(`${WEB_URL}/v1/workspaces/${workspace.id}/ai/conversations/${id}`)
        .catch(() => undefined);
    }
  }
});
