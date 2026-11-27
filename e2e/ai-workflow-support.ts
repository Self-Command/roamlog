import { expect, type Page } from "@playwright/test";

import { OWNER_ACCOUNT, WEB_URL, loginOnWeb } from "./support/accounts";

/**
 * `roamlog-crew` is part of the committed seed. `verify-crew` was a manual
 * leftover in an earlier developer database and made these journeys fail on a
 * clean checkout. Keep the override for staging/production, but never depend
 * on unseeded local state.
 */
export const AI_WORKSPACE_SLUG = process.env.E2E_AI_WORKSPACE_SLUG ?? "roamlog-crew";

export interface AnswerProfile {
  destination: string;
  origin: string;
  days: string;
  budget: string;
  companions: string;
  interests: string;
  extra: string;
}

export const DEFAULT_ANSWER_PROFILE: AnswerProfile = {
  destination: "京都",
  origin: "上海",
  days: "5",
  budget: "8000",
  companions: "两个人",
  interests: "古寺、咖啡、慢节奏",
  extra: "没有其他特别要求。",
};

export async function openAi(page: Page): Promise<void> {
  await loginOnWeb(page, OWNER_ACCOUNT);
  await page.goto(`${WEB_URL}/w/${AI_WORKSPACE_SLUG}/ai`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });
}

export function conversationId(page: Page): string | null {
  return new URL(page.url()).searchParams.get("conversation");
}

export async function currentWorkspaceId(page: Page): Promise<string> {
  // Resolve through the page's same-origin proxy. `page.request` is bound to
  // E2E_API_URL; when a test runs an auxiliary API port, the browser session
  // cookie belongs to WEB_URL and is not sent to that different origin.
  const workspaces = await page.evaluate(async () => {
    const response = await fetch("/v1/me/workspaces", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`workspace lookup failed with HTTP ${String(response.status)}`);
    }
    return (await response.json()) as Array<{ id: string; slug: string }>;
  });
  const workspace = workspaces.find((candidate) => candidate.slug === AI_WORKSPACE_SLUG);
  if (!workspace) {
    throw new Error(`workspace ${AI_WORKSPACE_SLUG} must be visible to the signed-in account`);
  }
  return workspace.id;
}

export async function sendPrompt(page: Page, text: string): Promise<void> {
  const composer = page.getByTestId("multimodal-input");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

export async function chooseReasoningEffort(
  page: Page,
  effort: "none" | "minimal" | "low" | "medium" | "high",
): Promise<void> {
  await page.getByTestId("reasoning-selector").click();
  await page.getByTestId(`reasoning-option-${effort}`).click();
  const labels = {
    none: "关闭",
    minimal: "极低",
    low: "低",
    medium: "中",
    high: "高",
  } as const;
  await expect(page.getByTestId("reasoning-selector-current")).toHaveText(labels[effort]);
}

export async function waitForRunEnd(page: Page, timeout = 360_000): Promise<void> {
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0, {
    timeout,
  });
}

export async function cleanupConversation(page: Page): Promise<void> {
  const id = conversationId(page);
  if (!id) return;
  const workspaceId = await currentWorkspaceId(page);
  await page.request
    .delete(`${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${id}`)
    .catch(() => undefined);
}

function preferredChoice(prompt: string, labels: readonly string[]): number {
  const match = (pattern: RegExp): number =>
    labels.findIndex((label) => pattern.test(label));

  if (/预算|费用|budget|花费/iu.test(prompt)) {
    const index = match(/3000\s*[-–—~至]\s*8000|5000|8000/iu);
    if (index >= 0) return index;
  }
  if (/国内|出境|范围|scope/iu.test(prompt)) {
    const index = match(/国内|domestic|境内/iu);
    if (index >= 0) return index;
  }
  if (/同行|人数|和谁|谁一起/u.test(prompt)) {
    const index = match(/情侣|两[个位]人|朋友|家庭|亲子/u);
    if (index >= 0) return index;
  }
  if (/偏好|喜欢|兴趣|体验/u.test(prompt)) {
    const index = match(/人文|文化|古寺|历史|咖啡|美食/u);
    if (index >= 0) return index;
  }
  if (/节奏|强度/u.test(prompt)) {
    const index = match(/慢|轻松|休闲/u);
    if (index >= 0) return index;
  }
  return 0;
}

function textAnswer(prompt: string, profile: AnswerProfile): string {
  if (/日期|时间|什么时候|何时|几月|哪天|出发.*(日期|时间)/iu.test(prompt)) {
    return "2027-04-02";
  }
  if (/从哪|出发城市|起点|origin/iu.test(prompt)) return profile.origin;
  if (/目的地|去哪|哪里|destination/iu.test(prompt)) return profile.destination;
  if (/预算|费用|budget|花费/iu.test(prompt)) return profile.budget;
  if (/天|晚|时长|duration/iu.test(prompt)) return profile.days;
  if (/同行|人数|和谁|谁一起/iu.test(prompt)) return profile.companions;
  if (/偏好|喜欢|兴趣|体验|节奏/iu.test(prompt)) return profile.interests;
  return profile.extra;
}

function dateAnswer(prompt: string): string {
  return /结束|返程|离开|end/iu.test(prompt) ? "2027-09-14" : "2027-09-10";
}

function numberAnswer(prompt: string, profile: AnswerProfile): string {
  if (/预算|费用|budget|花费/iu.test(prompt)) return profile.budget;
  if (/天|晚|时长|duration/iu.test(prompt)) return profile.days;
  return /人数|几个人|同行/iu.test(prompt) ? "2" : profile.days;
}

/**
 * Fills the generic assistant-ui human tool form. The fields are intentionally
 * discovered from the rendered prompt, not from a travel-specific schema:
 * another domain can emit different question ids without changing this helper.
 */
export async function answerAskUserForm(
  page: Page,
  profile: AnswerProfile = DEFAULT_ANSWER_PROFILE,
): Promise<boolean> {
  const form = page.getByTestId("ask-user-tool").last();
  if ((await form.count()) === 0 || !(await form.isVisible().catch(() => false))) {
    return false;
  }

  const questions = form.locator('[data-testid^="ask-user-question-"]');
  const count = await questions.count();
  if (count === 0) return false;

  for (let index = 0; index < count; index += 1) {
    const question = questions.nth(index);
    const prompt = (await question.innerText()).trim();
    const choices = question.getByRole("radio").or(question.getByRole("checkbox"));
    const choiceCount = await choices.count();
    let selectedChoice = false;
    if (choiceCount > 0) {
      const selected = question.locator('[aria-checked="true"]');
      if ((await selected.count()) === 0) {
        const labels = await choices.allInnerTexts();
        await choices.nth(preferredChoice(prompt, labels)).click();
      }
      selectedChoice = true;
    }

    const fields = question.locator("textarea, input");
    const fieldCount = await fields.count();
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      const field = fields.nth(fieldIndex);
      if (await field.isDisabled()) continue;
      const type = (await field.getAttribute("type")) ?? "textarea";
      const placeholder = (await field.getAttribute("placeholder")) ?? "";
      // Choice questions add an optional "other" textarea. It must not be
      // filled from the prompt or it creates contradictory answers.
      if (selectedChoice && /其他|补充|可选|optional/iu.test(placeholder)) continue;
      if (type === "date") {
        await field.fill(dateAnswer(prompt));
      } else if (type === "number") {
        await field.fill(numberAnswer(prompt, profile));
      } else {
        await field.fill(textAnswer(prompt, profile));
      }
    }
  }

  await form.getByRole("button", { name: "提交回答" }).click();
  await waitForRunEnd(page);
  return true;
}

export async function confirmBriefIfPresent(page: Page): Promise<boolean> {
  const confirmation = page.getByTestId("confirm-brief-tool").last();
  if (
    (await confirmation.count()) === 0 ||
    !(await confirmation.isVisible().catch(() => false))
  ) {
    return false;
  }

  const confirm = confirmation.getByRole("button", { name: "确认并生成计划" });
  if ((await confirm.count()) === 0) return false;

  if (await confirm.isEnabled()) {
    await confirm.click();
    await waitForRunEnd(page);
    return true;
  }

  await confirmation.getByRole("button", { name: "继续修改" }).click();
  await confirmation
    .getByRole("textbox", { name: "怎么修改这份摘要？" })
    .fill(
      "请把摘要中所有‘仍需确认’项按你给出的合理默认值改为假设，不再继续追问；出发城市上海；总预算包含往返机票；住宿按商务酒店安排；不安排跨城一日游；机票按估算计入预算；其他按当前摘要。请直接给出新的可确认摘要。",
    );
  await confirmation.getByRole("button", { name: "提交修改" }).click();
  await waitForRunEnd(page);
  return true;
}

export async function driveToPlan(
  page: Page,
  profile: AnswerProfile = DEFAULT_ANSWER_PROFILE,
  maxRounds = 6,
): Promise<void> {
  for (let round = 0; round < maxRounds; round += 1) {
    if (await answerAskUserForm(page, profile)) continue;
    if (await confirmBriefIfPresent(page)) continue;
    if ((await page.getByTestId("plan-confirm").count()) > 0) return;
    await waitForRunEnd(page);
    await page.waitForTimeout(500);
    if ((await page.getByTestId("ask-user-tool").count()) === 0) {
      if ((await page.getByTestId("confirm-brief-tool").count()) === 0) return;
    }
  }
  throw new Error("AI did not reach a plan within the allowed interaction rounds.");
}

export async function latestAssistantText(page: Page): Promise<string> {
  return (await page.getByTestId("message-assistant").last().innerText()).trim();
}

export async function installReasoningProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { longest: "", last: "" };
    (window as unknown as { __reasoningProbe?: typeof state }).__reasoningProbe = state;
    const capture = (): void => {
      const node = document.querySelector<HTMLElement>('[data-testid="message-reasoning"]');
      const text = node?.innerText.trim() ?? "";
      if (!text) return;
      state.last = text;
      if (text.length > state.longest.length) state.longest = text;
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    (window as unknown as { __reasoningObserver?: MutationObserver }).__reasoningObserver =
      observer;
    capture();
  });
}

export async function readReasoningProbe(
  page: Page,
): Promise<{ longest: string; last: string }> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __reasoningProbe?: { longest: string; last: string };
        }
      ).__reasoningProbe ?? { longest: "", last: "" },
  );
}
