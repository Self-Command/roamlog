/**
 * AI_CHAT_PARITY — real-browser acceptance for the full chat surface.
 *
 * Ports the visible behavior of vercel/chatbot @ a8989b52:
 * `components/chat/multimodal-input.tsx:73-960`,
 * `components/chat/message-actions.tsx:14-199`,
 * `components/chat/message-editor.tsx:1-30`,
 * `components/chat/messages.tsx:27-155`,
 * `hooks/use-auto-resume.ts:15-43`,
 * `components/ai-elements/model-selector.tsx:21-213`.
 *
 * Runs against the real web app, API, PostgreSQL and login state. The model
 * gateway is a third-party upstream; no product API response is mocked except
 * in the dedicated error-state test, which deliberately forces a 500.
 *
 * Run:
 *   node node_modules/@playwright/test/cli.js test \
 *     e2e/web/ai-chat-complete-parity.spec.ts --project=web
 *
 * Screenshots: `.audit/ai-port/chat-parity/`.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { OWNER_ACCOUNT, WEB_URL, loginOnWeb } from "../support/accounts";

test.use({
  permissions: ["clipboard-read", "clipboard-write"],
  trace: "off",
  video: "off",
});
test.describe.configure({ retries: 1 });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-port", "chat-parity");
const WORKSPACE_SLUG = process.env.E2E_AI_WORKSPACE_SLUG ?? "verify-crew";
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

async function openAiPage(page: Page): Promise<void> {
  await loginOnWeb(page, OWNER_ACCOUNT);
  await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}/ai`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "AI 旅行助手" })).toBeVisible({
    timeout: 30_000,
  });
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const composer = page.getByLabel("给 AI 助手发消息");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(prompt);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

async function waitForRunEnd(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0, {
    timeout: 240_000,
  });
}

async function conversationIdFromUrl(page: Page): Promise<string> {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("conversation"), {
      timeout: 60_000,
    })
    .not.toBeNull();
  return new URL(page.url()).searchParams.get("conversation") as string;
}

async function openConversation(page: Page, conversationId: string): Promise<void> {
  await page.goto(
    `${WEB_URL}/w/${WORKSPACE_SLUG}/ai?conversation=${encodeURIComponent(conversationId)}`,
    { waitUntil: "domcontentloaded" },
  );
}

async function workspaceIdFor(page: Page): Promise<string> {
  const response = await page.request.get(`${WEB_URL}/v1/me/workspaces`);
  expect(response.status(), await response.text()).toBe(200);
  const workspaces = (await response.json()) as Array<{ id: string; slug: string }>;
  const workspace = workspaces.find((entry) => entry.slug === WORKSPACE_SLUG);
  expect(workspace, `workspace ${WORKSPACE_SLUG} must exist`).toBeTruthy();
  return workspace!.id;
}

function expectNoOverflow(page: Page): Promise<void> {
  return expect
    .poll(async () =>
      page.evaluate(() => {
        const root = document.documentElement;
        return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(1);
}

test.describe("AI chat parity (real stack)", () => {
  test("composer, model selector, slash command, attachment and mobile", async ({ page }) => {
    test.setTimeout(180_000);
    await openAiPage(page);

    const composer = page.getByLabel("给 AI 助手发消息");
    await expect(composer).toBeFocused();
    await expect(page.getByTestId("suggested-actions")).toBeVisible();
    await shot(page, "01-empty-1440");

    const selector = page.getByTestId("model-selector");
    await expect(selector).toBeVisible();
    await selector.click();
    await expect(page.getByTestId("model-selector-search")).toBeVisible();
    const options = page.locator('[data-testid^="model-option-"]');
    expect(await options.count()).toBeGreaterThan(0);
    const optionTestId = await options.first().getAttribute("data-testid");
    const selectedId = optionTestId?.replace(/^model-option-/u, "");
    await shot(page, "02-model-selector-1440");
    await options.first().click();
    if (selectedId) {
      await expect(page.getByTestId("model-selector-current")).toContainText(selectedId);
    }

    await composer.fill("/model");
    await composer.press("Enter");
    await expect(page.getByTestId("model-selector-search")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("attachments-input").setInputFiles({
      buffer: PNG_1PX,
      mimeType: "image/png",
      name: "parity.png",
    });
    await expect(page.getByTestId("input-attachment-preview").first()).toBeVisible();
    await page.getByTestId("input-attachment-remove").first().click();
    await expect(page.getByTestId("input-attachment-preview")).toHaveCount(0);
    await shot(page, "03-composer-1440");

    const draft = `刷新后仍保留的草稿 ${Date.now()}`;
    await composer.fill(draft);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("给 AI 助手发消息")).toHaveValue(draft, {
      timeout: 30_000,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
    await expect(page.getByTestId("model-selector")).toBeVisible();
    await expectNoOverflow(page);
    await shot(page, "04-composer-390");
  });

  test("copy, vote, edit and truncate the tail with persisted history", async ({ page }) => {
    test.setTimeout(420_000);
    await openAiPage(page);

    const prompt = `搜索京都金阁寺并给我一句话建议 ${Date.now()}`;
    await sendPrompt(page, prompt);
    await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible({
      timeout: 60_000,
    });
    await waitForRunEnd(page);

    const conversationId = await conversationIdFromUrl(page);
    const assistant = page.getByTestId("message-assistant").first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    const assistantText = await assistant.innerText();
    expect(assistantText.trim().length).toBeGreaterThan(10);

    await assistant.hover();
    await shot(page, "05-message-actions-1440");
    await assistant.getByTestId("message-copy").click();
    await expect(assistant.getByTestId("message-copy")).toHaveAttribute("data-copied", "true");
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.trim().length).toBeGreaterThan(0);

    await assistant.getByTestId("message-upvote").click();
    await expect(assistant.getByTestId("message-upvote")).toHaveAttribute("aria-pressed", "true");

    await openConversation(page, conversationId);
    const reloadedAssistant = page.getByTestId("message-assistant").first();
    await expect(reloadedAssistant).toBeVisible({ timeout: 30_000 });
    await reloadedAssistant.hover();
    await expect(reloadedAssistant.getByTestId("message-upvote")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 30_000 },
    );

    const user = page.getByTestId("message-user").first();
    await expect(user).toContainText(prompt);
    await user.hover();
    await user.getByRole("button", { name: "编辑消息" }).click();
    const editor = page.getByLabel("编辑消息内容");
    await expect(editor).toBeVisible();
    const editedPrompt = `搜索京都清水寺并给我一句话建议 ${Date.now()}`;
    await editor.fill(editedPrompt);
    await page.getByTestId("message-edit-send").click();

    await expect(page.getByTestId("message-user").first()).toContainText(editedPrompt, {
      timeout: 60_000,
    });
    await waitForRunEnd(page);
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(0);

    const workspaceId = await workspaceIdFor(page);
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${conversationId}/messages`,
          );
          if (response.status() !== 200) return true;
          const body = (await response.json()) as {
            messages: Array<{ message: { content: unknown; role: string } }>;
          };
          return body.messages.some((message) =>
            JSON.stringify(message.message.content).includes(prompt),
          );
        },
        { timeout: 60_000 },
      )
      .toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("message-user").first()).toContainText(editedPrompt, {
      timeout: 30_000,
    });
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(0);
    await shot(page, "06-edited-history-1440");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
    await expectNoOverflow(page);
    await shot(page, "07-edited-history-390");
  });

  test("refresh resumes the active run without duplicating the conversation", async ({ page }) => {
    test.setTimeout(420_000);
    await openAiPage(page);
    const prompt = `帮我创建一份京都五天旅行计划，包含每天三个节点、交通和预算明细 ${Date.now()}`;
    await sendPrompt(page, prompt);
    const conversationId = await conversationIdFromUrl(page);
    const workspaceId = await workspaceIdFor(page);
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${conversationId}/stream/status`,
          );
          if (response.status() !== 200) return false;
          const body = (await response.json()) as { active?: boolean };
          return body.active === true;
        },
        { timeout: 30_000, intervals: [100, 200, 500] },
      )
      .toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await openConversation(page, conversationId);
    const stop = page.getByRole("button", { name: "停止生成" });
    await expect(stop).toBeVisible({ timeout: 30_000 });
    await waitForRunEnd(page);
    await expect(page.getByTestId("message-assistant").first()).toContainText(
      /京都|赏樱|路线|预算|交通/u,
      { timeout: 30_000 },
    );
    await shot(page, "08-resumed-1440");

    const response = await page.request.get(
      `${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${conversationId}/messages`,
    );
    expect(response.status()).toBeLessThan(300);
    const body = (await response.json()) as {
      messages: Array<{ message: { role: string } }>;
    };
    expect(body.messages.filter((message) => message.message.role === "assistant")).toHaveLength(1);
  });

  test("switching conversations keeps the active run in the background", async ({ page }) => {
    test.setTimeout(420_000);
    await openAiPage(page);
    const prompt = `帮我做一份五天四晚的关西行程，包含每天三个节点、交通、预算和注意事项 ${Date.now()}`;
    await sendPrompt(page, prompt);
    const conversationId = await conversationIdFromUrl(page);
    const workspaceId = await workspaceIdFor(page);
    await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible({
      timeout: 60_000,
    });

    const cancelRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/stream/cancel")) {
        cancelRequests.push(request.url());
      }
    });

    await page.getByRole("button", { name: "新建会话" }).click();
    await expect(page.getByLabel("给 AI 助手发消息")).toHaveValue("");
    await expect(page).toHaveURL(new RegExp(`/w/${WORKSPACE_SLUG}/ai$`, "u"));
    expect(cancelRequests).toHaveLength(0);

    await page.goto(
      `${WEB_URL}/w/${WORKSPACE_SLUG}/ai?conversation=${encodeURIComponent(conversationId)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByLabel("给 AI 助手发消息")).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${conversationId}/messages`,
          );
          if (response.status() !== 200) return 0;
          const body = (await response.json()) as {
            messages: Array<{ message: { role: string } }>;
          };
          return body.messages.filter((message) => message.message.role === "assistant").length;
        },
        { timeout: 240_000, intervals: [500, 1_000, 2_000] },
      )
      .toBeGreaterThanOrEqual(1);

    await waitForRunEnd(page);
    await expect(page.getByTestId("message-assistant").first()).toBeVisible({
      timeout: 30_000,
    });
    expect(cancelRequests).toHaveLength(0);
    await shot(page, "08b-background-switch-1440");
  });

  test("error state is readable and does not leave a spinner behind", async ({ page }) => {
    test.setTimeout(120_000);
    await loginOnWeb(page, OWNER_ACCOUNT);
    const workspaceId = await workspaceIdFor(page);
    await page.route(`**/v1/workspaces/${workspaceId}/ai/chat/stream`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Server Error",
          status: 500,
          code: "AI_UPSTREAM",
          detail: "forced parity error",
        }),
      });
    });
    await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}/ai`, {
      waitUntil: "domcontentloaded",
    });
    await sendPrompt(page, "这条消息用于验证错误态");
    await expect(
      page.getByText(/计划没有生成|模型服务暂时不可用|AI 请求失败/u).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ai-thinking-skeleton")).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0);
    await shot(page, "09-error-1440");
  });
});
