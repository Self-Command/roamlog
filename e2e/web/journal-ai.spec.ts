/**
 * EDITOR_AI_PORT — real-browser acceptance for Novel's editor AI.
 *
 * Runs against the real local stack (web :3000, API :4000, PostgreSQL, real
 * Better Auth login, real model gateway). Nothing about the AI path is stubbed:
 * the only tolerated instability is the gateway's intermittent `AI_UPSTREAM`,
 * which is retried up to 3 attempts (`retries: 2`) and again inside the page by
 * pressing the panel's 重试 button.
 *
 * Run from the repo root:
 *   node node_modules/@playwright/test/cli.js test e2e/web/journal-ai.spec.ts --project=web --reporter=list
 *
 * Screenshots: `.audit/editor-ai/` (desktop 1440 + mobile 390).
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { OWNER_ACCOUNT, WEB_URL, type SmokeAccount } from "../support/accounts";

test.use({ trace: "off", video: "off" });

/** The gateway intermittently answers `AI_UPSTREAM`; three attempts per journey. */
test.describe.configure({ retries: 2, mode: "serial" });
// Entry creation + a real model round trip exceed the suite default.
test.setTimeout(180_000);

const OUT_DIR = path.resolve(process.cwd(), ".audit", "editor-ai");
const WORKSPACE_SLUG = process.env.E2E_AI_WORKSPACE_SLUG ?? "roamlog-crew";
const RUN_ID = new Date().toISOString().replace(/[:.]/gu, "-");

const BODY = [
  "早上从京都站坐车去岚山，车厢里很安静，只有轨道接缝的声音。",
  "竹林小径的光从高处落下来，风把叶子吹得沙沙响，我们慢慢走到天龙寺后门。",
  "中午在河边吃了一碗汤豆腐，老板娘说今年枫叶红得晚。",
].join("\n");

interface Evidence {
  readonly capturedAt: string;
  readonly entryTitle: string;
  readonly streamingResponseStatus?: number;
  readonly streamingContentType?: string;
  readonly attempts: number;
  readonly panelResult: string;
  readonly editorBefore: string;
  readonly editorAfter: string;
}

function screenshotName(kind: "desktop-1440" | "mobile-390", step: string): string {
  return `${kind}-${step}.png`;
}

async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
  return file;
}

function writeEvidence(name: string, evidence: Evidence): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function login(page: Page, account: SmokeAccount): Promise<void> {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

async function openJournal(page: Page): Promise<void> {
  await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}/journal`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "全部日志" })).toBeVisible({ timeout: 30_000 });
}

/**
 * Creates a journal entry through the real sheet, then reopens it from the list.
 * The paragraph text is long enough that `improve` has something to work on and
 * that the bubble has a stable anchor.
 */
async function createEntry(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "写日志" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 30_000 });

  // 所属旅行 is only rendered for a brand-new entry.
  const tripSelect = sheet.getByRole("combobox", { name: "所属旅行", exact: true });
  await expect(tripSelect).toBeVisible({ timeout: 20_000 });
  const options = await tripSelect.locator("option").evaluateAll((nodes) =>
    nodes
      .map((node) => (node as HTMLOptionElement).value)
      .filter((value) => value.length > 0),
  );
  expect(options.length).toBeGreaterThan(0);
  const tripId = options[0] as string;
  await tripSelect.selectOption(tripId);

  // The toolbar also has a "标题 2" button, so the field is matched by role.
  await sheet.getByRole("textbox", { name: "标题", exact: true }).fill(title);
  await sheet.getByRole("textbox", { name: "地点", exact: true }).fill("京都");

  // A journal entry must fall inside its trip's date range (`400
  // OUTSIDE_TRIP_DATES`), and the trips on this database are seeded around other
  // dates than "now". Read the range with the logged-in session and use its start.
  const tripResponse = await page.request.get(`${WEB_URL}/v1/trips/${tripId}`);
  expect(tripResponse.ok()).toBe(true);
  const trip = (await tripResponse.json()) as { startDate?: string };
  expect(trip.startDate, "the chosen trip must expose a start date").toBeTruthy();
  await sheet.getByLabel("日期").fill(trip.startDate as string);

  const editor = sheet.locator('[aria-label="日志正文"]');
  await editor.click();
  for (const paragraph of BODY.split("\n")) {
    await page.keyboard.type(paragraph);
    await page.keyboard.press("Enter");
  }

  // `保存` creates the entry and closes the sheet; the 5 s autosave does the same,
  // so accept either and then reopen from the list.
  const saveButton = sheet.getByRole("button", { name: "保存", exact: true });
  if (await saveButton.isVisible().catch(() => false)) {
    await saveButton.click().catch(() => undefined);
  }
  await expect(sheet).toBeHidden({ timeout: 40_000 });

  await page.getByLabel("搜索日志").fill(title);
  const entryButton = page.getByRole("button", { name: new RegExp(title, "u") });
  await expect(entryButton).toBeVisible({ timeout: 30_000 });
  await entryButton.click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
}

/** Runs one instruction and tolerates the gateway's intermittent upstream error. */
async function runInstruction(page: Page, label: string, evidence: { attempts: number }) {
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("ai-ask-ai")).toBeVisible({ timeout: 20_000 });
  await sheet.getByTestId("ai-ask-ai").click();

  const item = sheet.getByRole("option", { name: label });
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.click();

  const result = sheet.getByTestId("ai-rewrite-result");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    evidence.attempts = attempt;
    const settled = await Promise.race([
      result
        .waitFor({ state: "visible", timeout: 25_000 })
        .then(() => "result" as const)
        .catch(() => "timeout" as const),
      sheet
        .getByRole("alert")
        .waitFor({ state: "visible", timeout: 25_000 })
        .then(() => "error" as const)
        .catch(() => "timeout" as const),
    ]);

    if (settled === "result") return result;
    if (settled === "error") {
      const retry = sheet.getByRole("button", { name: "重试" });
      if (await retry.isVisible().catch(() => false)) {
        await retry.click();
        continue;
      }
    }
    // No result and no visible error: let the next attempt re-select and retry.
  }

  throw new Error(`AI 改写连续 ${evidence.attempts} 次未返回结果（网关不可用或超时）`);
}

test.describe("desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("bubble entry, streaming result, replace, and the empty-selection rule", async ({ page }) => {
    const evidence: Evidence = {
      capturedAt: new Date().toISOString(),
      entryTitle: `E2E AI 改写 ${RUN_ID}`,
      attempts: 0,
      panelResult: "",
      editorBefore: "",
      editorAfter: "",
    };

    // Capture the SSE response headers: proof the result really streamed.
    page.on("response", (response) => {
      if (!response.url().includes("/ai/rewrite/stream")) return;
      evidence.streamingResponseStatus = response.status();
      evidence.streamingContentType = response.headers()["content-type"];
    });

    await login(page, OWNER_ACCOUNT);
    await openJournal(page);
    await createEntry(page, evidence.entryTitle);

    const sheet = page.getByRole("dialog");
    const editor = sheet.locator('[aria-label="日志正文"]');
    await expect(editor).toBeVisible({ timeout: 30_000 });
    evidence.editorBefore = (await editor.innerText()).trim();

    // --- 1. empty selection: the bubble must not exist ----------------------
    // The caret sits inside the paragraph but nothing is selected after clicking.
    await expect(sheet.getByTestId("ai-ask-ai")).toHaveCount(0);

    // --- 2. select text → the bubble with "Ask AI" appears ------------------
    await editor.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+Shift+End");
    await expect(sheet.getByTestId("ai-ask-ai")).toBeVisible({ timeout: 20_000 });
    await shot(page, screenshotName("desktop-1440", "01-bubble-ask-ai"));

    // --- 3. run 改善表达 and watch the result stream in ----------------------
    const result = await runInstruction(page, "改善表达", evidence);
    await expect(sheet.getByRole("option", { name: "替换选中内容" })).toBeVisible();
    await shot(page, screenshotName("desktop-1440", "02-streaming-result"));

    // --- 4. the three Novel actions exist ----------------------------------
    await expect(sheet.getByRole("option", { name: "替换选中内容" })).toBeVisible();
    await expect(sheet.getByRole("option", { name: "插入到下方" })).toBeVisible();
    await expect(sheet.getByRole("option", { name: "放弃" })).toBeVisible();

    const panelResult = ((await result.innerText()) ?? "").trim();
    expect(panelResult.length).toBeGreaterThan(0);
    evidence.panelResult = panelResult;

    // --- 5. replace the selection with the result --------------------------
    await sheet.getByRole("option", { name: "替换选中内容" }).click();
    await expect(sheet.getByTestId("ai-ask-ai")).toHaveCount(0, { timeout: 20_000 });

    await expect
      .poll(async () => (await editor.innerText()).trim(), { timeout: 20_000 })
      .not.toBe(evidence.editorBefore);
    evidence.editorAfter = (await editor.innerText()).trim();
    expect(evidence.editorAfter.replace(/\s+/gu, "")).toContain(panelResult.replace(/\s+/gu, ""));
    await shot(page, screenshotName("desktop-1440", "03-replaced"));

    // --- 6. empty selection: the bubble is gone again ----------------------
    await editor.click();
    await page.keyboard.press("Control+End");
    await expect(sheet.getByTestId("ai-ask-ai")).toHaveCount(0, { timeout: 20_000 });

    // The toolbar entry is an adaptation layer: present but disabled with a reason.
    const toolbarEntry = sheet
      .getByRole("toolbar", { name: "日志格式工具栏" })
      .getByRole("button", { name: "让 AI 改写" });
    await expect(toolbarEntry).toBeDisabled();
    await expect(toolbarEntry).toHaveAttribute("title", /先选中一段文字/u);

    expect(evidence.streamingResponseStatus).toBe(200);
    expect(evidence.streamingContentType ?? "").toContain("text/event-stream");
    writeEvidence("desktop-1440", evidence);
  });
});

test.describe("mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("mobile entry point opens the same novel panel", async ({ page }) => {
    await login(page, OWNER_ACCOUNT);
    await openJournal(page);

    // A fresh entry keeps the mobile journey independent of seed data (other
    // suites have been renaming/deleting seeded entries).
    await createEntry(page, `E2E 移动端 AI ${RUN_ID}`);

    const sheet = page.getByRole("dialog");
    const editor = sheet.locator('[aria-label="日志正文"]');
    await expect(editor).toBeVisible({ timeout: 30_000 });

    await editor.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+Shift+End");

    // Novel has no mobile adaptation, so the persistent toolbar entry is the
    // adaptation layer: it is enabled as soon as a selection exists.
    const toolbarEntry = sheet
      .getByRole("toolbar", { name: "日志格式工具栏" })
      .getByRole("button", { name: "让 AI 改写" });
    await expect(toolbarEntry).toBeEnabled({ timeout: 20_000 });
    await expect(toolbarEntry).toBeInViewport();
    await shot(page, screenshotName("mobile-390", "01-selection-toolbar-entry"));

    await toolbarEntry.click();
    const panel = sheet.getByRole("option", { name: "改善表达" });
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await shot(page, screenshotName("mobile-390", "02-panel"));

    // The panel must fit the phone width (spec: `min(344px, 100vw - 24px)`).
    const box = await sheet.getByTestId("ai-selector-panel").boundingBox().catch(() => null);
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(391);
    }
  });
});

/** Convenience for the report: writes the run timestamp used in screenshot names. */
test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, "run-timestamp.txt"),
    `${new Date().toISOString()} (${new Date().toString()})\n`,
    "utf8",
  );
});
