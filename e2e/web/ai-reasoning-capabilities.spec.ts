import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { OWNER_ACCOUNT, WEB_URL, WORKSPACE_SLUG, loginOnWeb } from "../support/accounts";

test.use({ trace: "off", video: "off" });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-reasoning-capabilities");
const CONVERSATION_ID = "01942f30-1200-7000-8000-000000000201";
const USER_MESSAGE_ID = "01942f30-1200-7000-8000-000000000202";
const ASSISTANT_MESSAGE_ID = "01942f30-1200-7000-8000-000000000203";
const MAX_MODEL = "openai/gpt-5.6-sol";

function sse(frames: [string, unknown][]): string {
  return frames
    .map(
      ([event, data], index) =>
        `id: ${String(index + 1)}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

async function openAi(page: Page): Promise<void> {
  await loginOnWeb(page, OWNER_ACCOUNT);
  await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}/ai`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });
}

test("uses the selected model's real reasoning tiers and sends max on the wire", async ({
  page,
}) => {
  test.setTimeout(120_000);
  mkdirSync(OUT_DIR, { recursive: true });

  await page.route("**/v1/workspaces/*/ai/models", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        defaultModel: MAX_MODEL,
        reasoningSupported: true,
        models: [
          {
            id: MAX_MODEL,
            name: "GPT-5.6 Sol",
            provider: "openai",
            reasoning: true,
            reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
            vision: false,
          },
        ],
      }),
    });
  });

  const bodies: Record<string, unknown>[] = [];
  await page.route("**/ai/chat/stream", async (route: Route) => {
    try {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    } catch {
      bodies.push({});
    }
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
      body: sse([
        [
          "meta",
          {
            type: "meta",
            v: 1,
            conversationId: CONVERSATION_ID,
            userMessageId: USER_MESSAGE_ID,
            assistantMessageId: ASSISTANT_MESSAGE_ID,
            provider: { protocol: "openai-chat", model: MAX_MODEL },
          },
        ],
        ["text.delta", { type: "text.delta", delta: "收到。" }],
        [
          "done",
          { type: "done", messageId: ASSISTANT_MESSAGE_ID, finishReason: "stop" },
        ],
      ]),
    });
  });

  await openAi(page);

  const reasoning = page.getByTestId("reasoning-selector");
  await expect(reasoning).toBeEnabled({ timeout: 30_000 });
  await reasoning.click();
  await expect(page.getByTestId("reasoning-option-xhigh")).toHaveText("极高");
  await expect(page.getByTestId("reasoning-option-max")).toHaveText("最高");
  await page.getByTestId("reasoning-option-max").click();
  await expect(page.getByTestId("reasoning-selector-current")).toHaveText("最高");

  await page.getByTestId("multimodal-input").fill("测试最高思考档位");
  await page.getByTestId("multimodal-input").press("Enter");

  await expect.poll(() => bodies.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(bodies[0]?.model).toBe(MAX_MODEL);
  expect(bodies[0]?.reasoningEffort).toBe("max");

  await page.screenshot({ path: path.join(OUT_DIR, "max-reasoning-1440.png") });
  writeFileSync(
    path.join(OUT_DIR, "max-reasoning.json"),
    `${JSON.stringify({ interceptedRequestBody: bodies[0], model: MAX_MODEL }, null, 2)}\n`,
    "utf8",
  );
});
