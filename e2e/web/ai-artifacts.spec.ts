/**
 * AI_ARTIFACT_COMPLETE — real-browser artifact lifecycle.
 *
 * The model gateway is the only stubbed upstream: the planning frame below
 * names one `artifacts.create` call, and the execute response is fulfilled
 * after creating the artifact through Roamlog's real REST API. All artifact
 * reads, edits, versions, suggestions and conflicts then go through the real
 * web + Nest API + PostgreSQL stack.
 *
 * Run:
 *   node node_modules/@playwright/test/cli.js test e2e/web/ai-artifacts.spec.ts --project=web
 *
 * Evidence: `.audit/ai-port/artifacts/`.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  OWNER_ACCOUNT,
  SMOKE_DATABASE_URL,
  WEB_URL,
  findWorkspace,
  loginOnWeb,
} from "../support/accounts";

test.use({ trace: "off", video: "off" });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-port", "artifacts");
const RUN_ID = "0123456789abcdef0123456789abcdef";
const SUGGESTION_ID = "01942f30-1200-7000-8000-0000000009a1";
const INITIAL_HEADING = "京都慢游路书";
const ORIGINAL_SENTENCE = "这是一段需要润色的文字。";
const SUGGESTED_SENTENCE = "这是一段已经润色的文字。";
const INITIAL_CONTENT = `# ${INITIAL_HEADING}\n\n${ORIGINAL_SENTENCE}\n\n先从鸭川边的一杯咖啡开始。`;

interface Artifact {
  id: string;
  title: string;
  kind: "text" | "code" | "sheet" | "image";
  content: string;
  version: number;
}

interface VersionRow {
  version: number;
  content: string;
}

function sse(frames: Array<[string, unknown]>): string {
  return frames
    .map(
      ([event, data], index) =>
        `id: ${String(index + 1)}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

function seedSuggestion(artifactId: string): void {
  const escape = (value: string): string => value.replaceAll("'", "''");
  const sql = `
INSERT INTO "AiArtifactSuggestion"
  ("id", "artifactId", "description", "originalText", "suggestedText", "isResolved", "createdAt")
VALUES
  ('${SUGGESTION_ID}', '${artifactId}', '让开头的句子更利落', '${escape(ORIGINAL_SENTENCE)}',
   '${escape(SUGGESTED_SENTENCE)}', false, NOW())
ON CONFLICT ("id") DO UPDATE SET
  "artifactId" = EXCLUDED."artifactId",
  "description" = EXCLUDED."description",
  "originalText" = EXCLUDED."originalText",
  "suggestedText" = EXCLUDED."suggestedText",
  "isResolved" = false,
  "createdAt" = EXCLUDED."createdAt";
`;
  execFileSync("node", [path.resolve(".audit/ai-e2e/db.mjs"), sql], {
    cwd: process.cwd(),
    env: { ...process.env, ROAMLOG_DB_URL: SMOKE_DATABASE_URL },
    stdio: "pipe",
  });
}

async function createConversation(page: Page, workspaceId: string): Promise<string> {
  const response = await page.request.post(
    `${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations`,
    { data: { title: "Artifact acceptance" } },
  );
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function artifactJson(page: Page, workspaceId: string, artifactId: string): Promise<Artifact> {
  const response = await page.request.get(
    `${WEB_URL}/v1/workspaces/${workspaceId}/ai/artifacts/${artifactId}`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Artifact;
}

async function versions(
  page: Page,
  workspaceId: string,
  artifactId: string,
): Promise<VersionRow[]> {
  const response = await page.request.get(
    `${WEB_URL}/v1/workspaces/${workspaceId}/ai/artifacts/${artifactId}/versions`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { versions: VersionRow[] }).versions;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

test.describe("artifact complete port", () => {
  test("auto-opens, edits, saves, restores, applies a suggestion and reports a conflict", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    mkdirSync(OUT_DIR, { recursive: true });

    await loginOnWeb(page, OWNER_ACCOUNT);
    const workspace = await findWorkspace(page.request);
    const conversationId = await createConversation(page, workspace.id);

    let artifactId: string | null = null;
    let executeCalls = 0;

    await page.route("**/ai/chat/stream", async (route: Route) => {
      const body = route.request().postDataJSON() as { conversationId?: string };
      const activeConversationId = body.conversationId ?? conversationId;
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
              conversationId: activeConversationId,
              userMessageId: "artifact-user-message",
              assistantMessageId: "artifact-assistant-message",
              provider: { protocol: "openai-chat", model: "stub/artifact" },
            },
          ],
          [
            "plan",
            {
              type: "plan",
              runId: RUN_ID,
              message: "我会先创建这份旅行文档，等你确认后再写入。",
              plannedCalls: [
                {
                  tool: "artifacts.create",
                  args: {
                    title: INITIAL_HEADING,
                    kind: "text",
                    brief: "写一份京都慢游路书。",
                  },
                },
              ],
              readOnlyTrace: [],
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
            },
          ],
          [
            "done",
            {
              type: "done",
              messageId: "artifact-assistant-message",
              finishReason: "tool-calls",
            },
          ],
        ]),
      });
    });

    await page.route("**/ai/runs/*/execute", async (route: Route) => {
      executeCalls += 1;
      // The model is stubbed, but the artifact write is a real API + DB write.
      const created = await page.request.post(
        `${WEB_URL}/v1/workspaces/${workspace.id}/ai/artifacts`,
        {
          data: {
            conversationId,
            title: INITIAL_HEADING,
            kind: "text",
            content: INITIAL_CONTENT,
          },
        },
      );
      expect(created.status(), await created.text()).toBe(201);
      const artifact = (await created.json()) as Artifact;
      artifactId = artifact.id;
      seedSuggestion(artifact.id);

      await route.fulfill({
        status: 201,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          results: [
            {
              tool: "artifacts.create",
              ok: true,
              entityId: artifact.id,
              artifact: {
                id: artifact.id,
                title: artifact.title,
                kind: artifact.kind,
              },
            },
          ],
          partialFailure: false,
          summary: "已执行 1 项",
        }),
      });
    });

    try {
      const messagesLoaded = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          response.url().includes(`/ai/conversations/${conversationId}/messages`) &&
          response.status() === 200,
        { timeout: 30_000 },
      );
      await page.goto(
        `${WEB_URL}/w/${workspace.slug}/ai?conversation=${conversationId}`,
        { waitUntil: "domcontentloaded" },
      );
      await messagesLoaded;
      await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Artifact acceptance", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      await page.getByTestId("multimodal-input").fill("写一份京都慢游路书");
      await expect(page.getByTestId("send-button")).toBeEnabled({ timeout: 10_000 });
      await page.getByTestId("multimodal-input").press("Enter");

      const confirm = page.getByTestId("plan-confirm");
      await expect(confirm).toBeVisible({ timeout: 30_000 });
      await expect(confirm).toBeEnabled();
      await clickAndWaitForExecute(page, confirm);
      expect(executeCalls).toBe(1);
      expect(artifactId).toBeTruthy();

      const panel = page.getByTestId("artifact");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByText(INITIAL_HEADING, { exact: true }).first()).toBeVisible();
      await expect(panel.getByLabel("文档建议")).toBeVisible();
      await expect(panel.getByRole("button", { name: "应用" })).toBeVisible();
      await shot(page, "01-auto-open-1440");

      const editor = panel.getByLabel("文档正文");
      await expect(editor).toBeVisible();
      const userDraft = `${INITIAL_CONTENT}\n\n自动化保存的文字。`;
      const saveResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes(`/ai/artifacts/${artifactId}`) &&
          response.status() === 200,
      );
      await editor.fill(userDraft);
      await saveResponse;
      await expect
        .poll(async () => (await artifactJson(page, workspace.id, artifactId!)).version, {
          timeout: 30_000,
        })
        .toBe(2);
      expect((await artifactJson(page, workspace.id, artifactId!)).content).toContain(
        "自动化保存的文字。",
      );

      // Restore version 1 from the panel footer, then assert a new version (3)
      // was created rather than mutating history in place.
      await panel.getByRole("button", { name: "上一版" }).click();
      const restoreResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes(`/ai/artifacts/${artifactId}/versions/1/restore`) &&
          response.status() === 200,
      );
      await panel.getByRole("button", { name: "恢复" }).click();
      await restoreResponse;
      await expect
        .poll(async () => (await versions(page, workspace.id, artifactId!)).length, {
          timeout: 30_000,
        })
        .toBe(3);
      expect((await artifactJson(page, workspace.id, artifactId!)).content).toBe(INITIAL_CONTENT);

      // Apply the suggestion loaded by the panel. The PATCH must resolve only
      // after the content write has succeeded.
      const suggestionResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes(`/suggestions/${SUGGESTION_ID}`) &&
          response.status() === 200,
      );
      await panel.getByRole("button", { name: "应用" }).click();
      const resolved = (await (await suggestionResponse).json()) as { isResolved?: boolean };
      expect(resolved.isResolved).toBe(true);
      await expect
        .poll(async () => (await artifactJson(page, workspace.id, artifactId!)).content, {
          timeout: 30_000,
        })
        .toContain(SUGGESTED_SENTENCE);

      // Force a stale write: bump the artifact through the API, then edit the
      // stale panel. It must surface the conflict and keep the user's draft.
      const current = await artifactJson(page, workspace.id, artifactId!);
      const external = await page.request.patch(
        `${WEB_URL}/v1/workspaces/${workspace.id}/ai/artifacts/${artifactId}`,
        {
          data: {
            version: current.version,
            content: `${current.content}\n\n外部窗口的修改。`,
          },
        },
      );
      expect(external.status(), await external.text()).toBe(200);

      await editor.fill(`${current.content}\n\n本地未保存的修改。`);
      await expect(page.getByTestId("artifact-error")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("artifact-error")).toContainText("另一个窗口更新");
      await expect(editor).toContainText("本地未保存的修改。");
      await shot(page, "02-conflict-1440");

      // Mobile is the same panel, full-screen, not a squeezed desktop column.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(389);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      const panelDiagnostics = await panel.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          parent: node.parentElement?.tagName ?? null,
          position: style.position,
          zIndex: style.zIndex,
          width: style.width,
          backgroundColor: style.backgroundColor,
        };
      });
      writeFileSync(
        path.join(OUT_DIR, "mobile-diagnostics.json"),
        `${JSON.stringify(panelDiagnostics, null, 2)}\n`,
        "utf8",
      );
      await shot(page, "03-mobile-390");
    } finally {
      if (artifactId) {
        await page.request
          .delete(`${WEB_URL}/v1/workspaces/${workspace.id}/ai/artifacts/${artifactId}`)
          .catch(() => undefined);
      }
      await page.request
        .delete(`${WEB_URL}/v1/workspaces/${workspace.id}/ai/conversations/${conversationId}`)
        .catch(() => undefined);
    }
  });
});

async function clickAndWaitForExecute(
  page: Page,
  confirm: ReturnType<Page["getByTestId"]>,
): Promise<void> {
  const executeResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/ai/runs/") &&
      response.url().endsWith("/execute"),
  );
  await confirm.click();
  const response = await executeResponse;
  expect(response.status(), await response.text()).toBe(201);
}
