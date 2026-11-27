/**
 * AI_CHAT_UI_PORT — real browser acceptance for the ported chat surface.
 *
 * Runs against the real local stack (web :3000, API :4000, PostgreSQL, real
 * Better Auth login) with the configured model gateway. Only the error-state
 * test stubs the AI endpoint at the browser network layer, to force a 500
 * without waiting for a broken upstream.
 *
 * Run from the repo root:
 *   npx playwright test e2e/web/ai-chat-ux.spec.ts --project=web
 *
 * Screenshots are written to `.audit/ai-chat-ux/`.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  OWNER_ACCOUNT,
  WEB_URL,
  type SmokeAccount,
} from "../support/accounts";

// Trace/video retention races with parallel agents cleaning `test-results`;
// screenshots below are the evidence for this journey.
test.use({ trace: "off", video: "off" });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-chat-ux");
const PROMPT = "搜索京都的金阁寺";
/** Seeded workspace named 「Roamlog Crew」; override for another local stack. */
const WORKSPACE_SLUG = process.env.E2E_AI_WORKSPACE_SLUG ?? "roamlog-crew";

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function login(page: Page, account: SmokeAccount): Promise<void> {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), {
    timeout: 30_000,
  });
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

async function workspaceSlug(page: Page): Promise<string> {
  const landed = new URL(page.url()).pathname.split("/")[2];
  expect(landed, "login must land on /w/{slug}").toBeTruthy();
  return WORKSPACE_SLUG;
}

async function openFreshAiPage(page: Page) {
  const slug = await workspaceSlug(page);
  await page.goto(`${WEB_URL}/w/${slug}/ai`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });
}

async function sendPrompt(page: Page) {
  const composer = page.getByLabel("给 AI 助手发消息");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(PROMPT);
  await expect(composer).toHaveValue(PROMPT);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

/**
 * The active thread title is generated asynchronously by the API and the
 * thread list does not re-select the last thread after a full reload. Read the
 * newest persisted conversation (API order is lastMessageAt desc) and use its
 * generated title to re-open the exact history.
 */
async function latestConversationTitle(page: Page): Promise<string> {
  const workspaceResponse = await page.request.get(`${WEB_URL}/v1/me/workspaces`);
  expect(workspaceResponse.status()).toBe(200);
  const workspaces = (await workspaceResponse.json()) as Array<{
    id: string;
    slug: string;
  }>;
  const workspace = workspaces.find((entry) => entry.slug === WORKSPACE_SLUG);
  expect(workspace, `workspace ${WORKSPACE_SLUG} must exist`).toBeTruthy();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await page.request.get(
      `${WEB_URL}/v1/workspaces/${workspace?.id}/ai/conversations?limit=1`,
    );
    if (response.status() === 200) {
      const body = (await response.json()) as {
        items: Array<{ title?: string | null }>;
      };
      const title = body.items[0]?.title?.trim();
      if (title) return title;
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error("the latest AI conversation never received a title");
}

test.describe("AI chat tool card (real stack)", () => {
  test("desktop: tool card fields, expand/collapse, final reply, refresh persistence, mobile 390", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    await login(page, OWNER_ACCOUNT);
    await openFreshAiPage(page);
    await shot(page, "empty-1440");

    await sendPrompt(page);

    // 1) A tool card appears while the planner executes read-only searches.
    //    Search calls can finish in under a second, so wait for the card itself
    //    (running or complete) instead of racing the transient 运行中 badge.
    const toolCard = page
      .getByRole("button", { name: /搜索地点/ })
      .first();
    await expect(toolCard).toBeVisible({ timeout: 120_000 });
    await shot(page, "tool-card-1440");

    // 2) Expand: parameters must be visible and contain the actual args.
    const runningRoot = toolCard.locator("..");
    if ((await toolCard.getAttribute("aria-expanded")) !== "true") {
      await toolCard.click();
    }
    await expect(runningRoot.getByRole("heading", { name: "参数" })).toBeVisible({
      timeout: 10_000,
    });
    const assistantText = await page
      .getByTestId("message-assistant")
      .first()
      .innerText();
    expect(assistantText).toContain("搜索地点");
    expect(assistantText).toContain("参数");
    await shot(page, "tool-expanded-1440");

    // 3) The tool finishes: status becomes 完成 and the result body appears.
    const completedCard = page
      .getByRole("button", { name: /搜索地点 完成/ })
      .first();
    await expect(completedCard).toBeVisible({ timeout: 120_000 });
    await shot(page, "tool-complete-1440");

    // Collapse again and prove the body is gone.
    const completedRoot = completedCard.locator("..");
    if ((await completedCard.getAttribute("aria-expanded")) === "true") {
      await completedCard.click();
    }
    await expect(completedRoot.getByRole("heading", { name: "参数" })).toBeHidden({
      timeout: 10_000,
    });

    // 4) Wait for the run to finish and capture the final reply. A search-only
    //    prompt answers with text; a planning prompt may also append the
    //    existing plan card. Either terminal shape is a valid final reply.
    const stopButton = page.getByRole("button", { name: "停止生成" });
    await expect(stopButton).toHaveCount(0, { timeout: 180_000 });
    const finalText = await page.getByTestId("message-assistant").first().innerText();
    expect(finalText.trim().length).toBeGreaterThan(20);
    await shot(page, "final-1440");

    // 5) Refresh: conversation history (user prompt + tool card) must survive.
    //    The remote thread list does not re-select the last thread after a
    //    full reload, so find the newest generated title and open it again.
    const latestTitle = await latestConversationTitle(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: latestTitle, exact: true })
      .first()
      .click();
    await expect(page.getByText(PROMPT, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("搜索地点").first()).toBeVisible({ timeout: 30_000 });
    await shot(page, "refresh-1440");

    // 6) Mobile 390: same conversation must not overflow horizontally and the
    //    tool card must still expand/collapse.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
    });
    expect(overflow, "390px layout must not overflow horizontally").toBeLessThanOrEqual(1);

    const mobileCard = page.getByRole("button", { name: /搜索地点/ }).first();
    await expect(mobileCard).toBeVisible();
    await mobileCard.scrollIntoViewIfNeeded();
    await shot(page, "tool-card-390");
    const mobileRoot = mobileCard.locator("..");
    if ((await mobileCard.getAttribute("aria-expanded")) !== "true") {
      await mobileCard.click();
    }
    await expect(mobileRoot.getByRole("heading", { name: "参数" })).toBeVisible({
      timeout: 10_000,
    });
    await shot(page, "tool-expanded-390");
    if ((await mobileCard.getAttribute("aria-expanded")) === "true") {
      await mobileCard.click();
    }
    await expect(mobileRoot.getByRole("heading", { name: "参数" })).toBeHidden({
      timeout: 10_000,
    });
    await shot(page, "tool-collapsed-390");
  });

  test("error state: a 500 produces readable copy instead of a blank bubble", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await login(page, OWNER_ACCOUNT);

    await page.route("**/v1/workspaces/*/ai/chat/stream", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Server Error",
          status: 500,
          code: "AI_UPSTREAM",
          detail: "stub upstream failure for error-state acceptance",
        }),
      });
    });

    await openFreshAiPage(page);
    await sendPrompt(page);

    const errorCopy = page
      .getByText(/计划没有生成|模型服务暂时不可用|AI 请求失败/)
      .first();
    await expect(errorCopy).toBeVisible({ timeout: 30_000 });
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(40);
    await shot(page, "error-1440");
  });

  // Viewer permission is covered by `components/ai/ai-chat.test.tsx`
  // ("disables the confirmation for viewers"). The seeded `viewer@roamlog.test`
  // account is not present in the current local database (login returns
  // "邮箱或密码不正确"), so it cannot be exercised against this stack without
  // provisioning a viewer; reported as a known gap instead of faking the role.
});
