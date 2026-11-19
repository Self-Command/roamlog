/**
 * Journey 3 — the AI plan page must plan without writing.
 *
 * Cases:
 * - AI configured: send 「我想去京都待一周，预算 8000」, wait for the plan panel,
 *   assert the 「将写入数据」 badge + execution button exist, no 「已创建」/
 *   「已保存」/result banner is rendered, and the workspace trip count is
 *   byte-for-byte the same before vs. after. The execute button is never
 *   clicked, so the journey creates no data.
 * - AI not configured (real 503 `AI_NOT_CONFIGURED`): assert the honest
 *   “AI 尚未配置” state with its admin link, then finish without failing.
 *
 * To exercise the configured branch without restarting the shared web dev
 * server, start an API on another port with the AI env vars and export
 * `E2E_AI_API_URL=http://localhost:4001`. Only `/ai/**` calls are routed there;
 * every other request keeps using the default API.
 */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";

import {
  API_URL,
  findWorkspace,
  loginOnWeb,
  OWNER_ACCOUNT,
  signInViaApi,
  WEB_URL,
  WORKSPACE_SLUG,
} from "../../support/accounts";
import { registerFailureEvidence } from "../../support/smoke";

registerFailureEvidence(test);

const MESSAGE = "我想去京都待一周，预算 8000";

test.describe("AI plan page is read-only until confirmed", () => {
  test("plan renders the write badge and the execute action without touching the database", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await loginOnWeb(page, OWNER_ACCOUNT);
    const workspace = await findWorkspace(page.request);

    const aiApiUrl = process.env.E2E_AI_API_URL?.trim();
    let aiContext: APIRequestContext | null = null;

    if (aiApiUrl) {
      // The auxiliary API is a separate process: its session cookie is created
      // against that base URL and injected only for the routed AI requests, so
      // the page stays logged in on the default API for every other call.
      aiContext = await playwrightRequest.newContext({ baseURL: aiApiUrl });
      await signInViaApi(aiContext, OWNER_ACCOUNT, WEB_URL, aiApiUrl);
      const aiCookie = (await aiContext.cookies())
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");

      // Route every same-origin API call (except the already-completed login) to
      // the auxiliary API, so the workspace shell and the AI page share one
      // coherent backend even when the shared :4000 process is mid-restart.
      await page.route("**/v1/**", async (route) => {
        const original = new URL(route.request().url());
        if (original.pathname.startsWith("/v1/auth/")) {
          await route.continue();
          return;
        }
        const target = new URL(`${original.pathname}${original.search}`, aiApiUrl);
        const response = await route.fetch({
          url: target.toString(),
          headers: { ...route.request().headers(), cookie: aiCookie },
          timeout: 90_000,
        });
        await route.fulfill({ response });
      });
    }

    try {
      // Counts are read from the same database as the planning API; when a
      // dedicated AI API is used, read them from there so the check does not
      // depend on the shared :4000 process being healthy.
      const countBase = aiApiUrl ?? API_URL;
      const countClient = aiContext ?? page.request;
      const tripCount = async (): Promise<number> => {
        const response = await countClient.get(
          `${countBase}/v1/workspaces/${workspace.id}/trips`,
        );
        expect(response.status(), await response.text()).toBe(200);
        const body = (await response.json()) as { items: unknown[] };
        return body.items.length;
      };

      const before = await tripCount();

      await page.goto(`/w/${WORKSPACE_SLUG}/ai`);
      await expect(page.getByRole("heading", { name: "AI 旅行助手" })).toBeVisible();

      const composer = page.locator("#ai-message");
      const sendButton = page.getByRole("button", { name: "发送", exact: true });
      // Wait for hydration: filling a controlled textarea before React is
      // ready loses the value and leaves the send button disabled.
      await sendButton.waitFor({ state: "visible" });
      await composer.fill(MESSAGE);
      await expect(composer).toHaveValue(MESSAGE);
      await expect(sendButton).toBeEnabled();
      await sendButton.click();
      await expect(composer, "send() must clear the draft").toHaveValue("");

      const planPanel = page.locator('aside[aria-label="计划面板"]');
      const writeBadge = planPanel.getByText("将写入数据").first();
      const readOnlyBadge = planPanel.getByText("只读").first();
      const emptyPlanFooter = page.getByText("这次没有需要写入的操作", { exact: false });
      const notConfigured = page
        .locator('[role="alert"]')
        .filter({ hasText: "AI 尚未配置" });

      await expect
        .poll(
          async () => {
            if (await notConfigured.isVisible().catch(() => false)) return "not-configured";
            if (await writeBadge.isVisible().catch(() => false)) return "plan-with-writes";
            if (await readOnlyBadge.isVisible().catch(() => false)) return "plan-read-only";
            if (await emptyPlanFooter.isVisible().catch(() => false)) return "plan-empty";
            return "pending";
          },
          {
            message: "the AI endpoint must either plan or report AI_NOT_CONFIGURED",
            timeout: 110_000,
            intervals: [500, 1_000, 2_000, 3_000],
          },
        )
        .not.toBe("pending");

      if (await notConfigured.isVisible().catch(() => false)) {
        await expect(notConfigured).toContainText("AI 尚未配置");
        const adminLink = page.getByRole("link", { name: /打开后台系统设置/u });
        await expect(adminLink).toBeVisible();
        expect(await adminLink.getAttribute("href")).toContain("/admin/settings");

        expect(await tripCount(), "a failed plan must not write trips").toBe(before);
        test.info().annotations.push({
          type: "ai-config",
          description: "AI_NOT_CONFIGURED (503): verified the degraded UI only",
        });
        return;
      }

      await expect(planPanel).toBeVisible();
      expect(await planPanel.getByText("将写入数据").count()).toBeGreaterThan(0);

      const executeButton = page.getByRole("button", { name: /执行选中的 \d+ 项操作/u });
      await expect(executeButton).toBeVisible();
      await expect(executeButton).toBeEnabled();

      const bodyText = await page.locator("body").innerText();
      expect(bodyText, "plan-only copy must not claim anything was created").not.toContain(
        "已创建",
      );
      expect(bodyText, "plan-only copy must not claim anything was saved").not.toContain(
        "已保存",
      );
      await expect(page.getByText("执行结果", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("list", { name: "执行结果" })).toHaveCount(0);

      const after = await tripCount();
      expect(after, "GET /v1/workspaces/:id/trips must not change before execute").toBe(before);

      // Still un-executed: the plan footer is visible and no confirmation
      // dialog was opened. This runs after the count check so the test proves
      // the button was never clicked.
      await expect(executeButton).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      test.info().annotations.push({
        type: "ai-plan",
        description: `plan rendered; trips ${before} -> ${after}; execute not clicked`,
      });
    } finally {
      await aiContext?.dispose();
    }
  });
});