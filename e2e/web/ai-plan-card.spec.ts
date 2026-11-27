/**
 * AI_PLAN_CARD_REBUILD — real-browser acceptance for the enterprise plan
 * preview (`.audit/ai-plan-review-spec.md` §B/§C).
 *
 * Runs against the real local stack (web :3000, API :4000, PostgreSQL, real
 * Better Auth login, real model gateway). Nothing here stubs the model: the
 * prompt is sent to the configured upstream, and an `AI_UPSTREAM` turn is
 * retried (max 3 attempts, 5s apart) exactly as an operator would.
 *
 * Fixture: a real trip is created through the real API so the prompt can ask
 * for an edit (`trips.update`) alongside additions. It is deleted afterwards.
 *
 * Run from the repo root:
 *   node node_modules/@playwright/test/cli.js test e2e/web/ai-plan-card.spec.ts --project=web
 *
 * Screenshots: `.audit/ai-plan-card/`.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { OWNER_ACCOUNT, WEB_URL } from "../support/accounts";

test.use({ trace: "off", video: "off" });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-plan-card");
/** Seeded workspace named 「Roamlog Crew」 (override for another local stack). */
const WORKSPACE_SLUG = process.env.E2E_AI_WORKSPACE_SLUG ?? "roamlog-crew";
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;
const PLAN_TIMEOUT_MS = 240_000;

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  // Old attempt logs are not evidence for this run.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    rmSync(path.join(OUT_DIR, `attempt-${attempt}-failure.txt`), { force: true });
  }
});

async function login(page: Page): Promise<void> {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  // The login submit button is disabled until the client hydrates. Waiting for
  // it first prevents Playwright from filling controlled inputs that the
  // hydration pass then resets to empty.
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await page.getByLabel("邮箱").fill(OWNER_ACCOUNT.email);
  await page.getByLabel("密码").fill(OWNER_ACCOUNT.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

async function workspaceId(page: Page): Promise<string> {
  const response = await page.request.get(`${WEB_URL}/v1/me/workspaces`);
  expect(response.status()).toBe(200);
  const workspaces = (await response.json()) as Array<{ id: string; slug: string }>;
  const workspace = workspaces.find((entry) => entry.slug === WORKSPACE_SLUG);
  expect(workspace, `workspace ${WORKSPACE_SLUG} must exist`).toBeTruthy();
  return workspace!.id;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

/** Full-card capture: the expanded review is taller than a 1440×1000 viewport. */
async function cardShot(card: Locator, name: string) {
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

/** Sends the prompt and resolves once either the plan card or an error shows. */
async function sendAndWait(page: Page, prompt: string): Promise<"plan" | "error" | "timeout"> {
  const before = await page.getByTestId("message-assistant").count();
  const composer = page.getByLabel("给 AI 助手发消息");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(prompt);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect
    .poll(() => page.getByTestId("message-assistant").count(), { timeout: 60_000 })
    .toBeGreaterThan(before);

  const assistant = page.getByTestId("message-assistant").last();
  const card = assistant.getByLabel("计划确认卡");
  const confirmBrief = page.getByRole("button", { name: "确认并生成计划" }).last();
  const failure = assistant
    .getByTestId("ai-message-error")
    .or(
      assistant.getByText(
        /模型服务暂时不可用|计划没有生成|这次回复无法使用|这条回复中断了|请求失败|今天的 AI 规划次数已用完|AI 尚未配置|登录状态已失效|这条需求没有被接受/,
      ),
    );

  const settled = await Promise.race([
    card
      .waitFor({ state: "visible", timeout: PLAN_TIMEOUT_MS })
      .then(() => "plan" as const)
      .catch(() => "timeout" as const),
    failure
      .first()
      .waitFor({ state: "visible", timeout: PLAN_TIMEOUT_MS })
      .then(() => "error" as const)
      .catch(() => "timeout" as const),
    confirmBrief
      .waitFor({ state: "visible", timeout: PLAN_TIMEOUT_MS })
      .then(() => "confirm" as const)
      .catch(() => "timeout" as const),
  ]);
  if (settled !== "confirm") return settled;

  // This edit flow is deliberately human-in-the-loop: confirm the brief
  // before the planner may queue any writes.
  await confirmBrief.click();
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0, {
    timeout: PLAN_TIMEOUT_MS,
  });
  const confirmedCard = page.getByLabel("计划确认卡").last();
  const confirmed = await confirmedCard
    .waitFor({ state: "visible", timeout: PLAN_TIMEOUT_MS })
    .then(() => "plan" as const)
    .catch(() => "timeout" as const);
  return confirmed;
}

test.describe("enterprise plan preview (real stack)", () => {
  test("groups, summary, fold, old→new, selection and screenshots", async ({ page }) => {
    test.setTimeout(1_200_000);

    const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
    const fixtureTitle = `PRODCOPY-PLANCARD-${stamp}`;
    const targetTitle = "京都七日·古寺与咖啡";
    const prompt =
      `把旅行「${fixtureTitle}」改成「${targetTitle}」，日期改到 2027-04-05 到 2027-04-11。` +
      "再加 3 个停靠点（清水寺、伏见稻荷大社、岚山竹林），补齐每天日程、打包清单，预算设为 20000 日元。";

    await login(page);
    const workspace = await workspaceId(page);
    const created = await page.request.post(`${WEB_URL}/v1/workspaces/${workspace}/trips`, {
      data: {
        title: fixtureTitle,
        startDate: "2027-04-01",
        endDate: "2027-04-03",
        destinations: ["京都"],
      },
    });
    expect(created.status(), "fixture trip is a real DB row").toBe(201);
    const fixture = (await created.json()) as { id: string; title: string };
    expect(fixture.title).toBe(fixtureTitle);

    const frames: string[] = [];
    page.on("response", (response) => {
      if (!response.url().includes("/ai/chat/stream")) return;
      frames.push(`# ${response.status()} ${response.url()}`);
      response
        .text()
        .then((body) => frames.push(body))
        .catch(() => frames.push("(stream body unavailable)"));
    });

    let attempts = 0;
    let outcome: "plan" | "error" | "timeout" = "timeout";

    try {
      for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts += 1) {
        // A fresh navigation aborts a still-open stream from the previous
        // attempt (the model may exceed the wait window) and starts a new
        // conversation, so a retry never collides with the failed turn.
        await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}/ai`, {
          waitUntil: "domcontentloaded",
        });
        await expect(page.getByTestId("multimodal-input")).toBeVisible({
          timeout: 30_000,
        });

        outcome = await sendAndWait(page, prompt);
        if (outcome === "plan") break;
        // Real upstream failure: keep the evidence and retry like an operator.
        const evidence = await page
          .getByTestId("message-assistant")
          .last()
          .innerText()
          .catch(() => "(no assistant text)");
        writeFileSync(
          path.join(OUT_DIR, `attempt-${attempts}-failure.txt`),
          `${outcome}\n\n${evidence}\n\n${frames.join("\n\n")}`,
          "utf8",
        );
        if (attempts < MAX_ATTEMPTS) await page.waitForTimeout(RETRY_DELAY_MS);
      }
      test.info().annotations.push({
        type: "ai-attempts",
        description: `attempts=${attempts}, retries=${Math.max(0, attempts - 1)}, outcome=${outcome}`,
      });
      expect(outcome, `plan card must appear within ${MAX_ATTEMPTS} attempts`).toBe("plan");

      const card = page.getByLabel("计划确认卡").last();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await shot(page, "plan-1440");

      // 1) Summary: title + date range, not just a flat list.
      const heading = card.getByTestId("plan-summary-title");
      const headingText = (await heading.innerText()).trim();
      expect(headingText.length).toBeGreaterThan(0);
      expect(headingText, "summary must not fall back to the generic card title").not.toBe(
        "待确认的方案",
      );
      expect(
        [fixtureTitle, targetTitle].some((candidate) => headingText.includes(candidate)) ||
          headingText.includes("京都"),
        `summary title should name the trip, got "${headingText}"`,
      ).toBe(true);
      const summaryMeta = card.getByTestId("plan-summary-meta");
      await expect(summaryMeta).toContainText("2027-04-05");
      await expect(card.getByTestId("plan-summary-counts")).toContainText(/共 \d+ 项/);

      // 2) Groups: at least the three requested entity buckets, each with a count.
      const groups = card.getByTestId("plan-group");
      await expect(groups.first()).toBeVisible();
      const groupCount = await groups.count();
      expect(groupCount).toBeGreaterThanOrEqual(3);

      const groupInfo: Array<{ title: string; count: number }> = [];
      for (let index = 0; index < groupCount; index += 1) {
        const group = groups.nth(index);
        const label = (await group.getAttribute("aria-label")) ?? "";
        const match = /^(.*?)\s+(\d+)\s+项$/u.exec(label);
        expect(match, `group label must carry its count, got "${label}"`).toBeTruthy();
        const declared = Number(await group.getAttribute("data-group-count"));
        expect(declared, `data-group-count must match the label, got "${label}"`).toBe(
          Number(match![2]),
        );
        groupInfo.push({ title: match![1] ?? "", count: declared });
      }
      const titles = groupInfo.map((group) => group.title);
      for (const expected of ["停靠点", "每日行程", "打包清单"]) {
        expect(titles, `group "${expected}" must be present`).toContain(expected);
      }
      test.info().annotations.push({
        type: "groups",
        description: groupInfo.map((group) => `${group.title}:${group.count}`).join(", "),
      });

      // 3) Expand every group: per-group row count equals the header count.
      const triggers = card.getByTestId("plan-group-trigger");
      for (let index = 0; index < groupCount; index += 1) {
        const trigger = groups.nth(index).getByTestId("plan-group-trigger");
        if ((await trigger.getAttribute("aria-expanded")) !== "true") {
          await trigger.click();
        }
      }
      for (let index = 0; index < groupCount; index += 1) {
        await expect(groups.nth(index).getByTestId("plan-row")).toHaveCount(
          groupInfo[index]!.count,
        );
      }

      // 4) Fold/unfold is a real Collapsible state change, not CSS only.
      const firstGroup = groups.first();
      const firstTrigger = triggers.first();
      await firstTrigger.click();
      await expect(firstTrigger).toHaveAttribute("aria-expanded", "false");
      await expect(firstGroup.getByTestId("plan-row")).toHaveCount(0);
      await firstTrigger.click();
      await expect(firstTrigger).toHaveAttribute("aria-expanded", "true");
      await expect(firstGroup.getByTestId("plan-row")).toHaveCount(groupInfo[0]!.count);

      // 5) An update row shows the Payload-style From/To columns.
      const updateRows = card.locator(
        '[data-testid="plan-row"][data-mode="change"]',
      );
      const updateCount = await updateRows.count();
      test.info().annotations.push({
        type: "update-rows",
        description:
          updateCount > 0 ? `found ${updateCount} update row(s)` : "skipped: no update row",
      });
      if (updateCount > 0) {
        await expect(updateRows.first()).toBeVisible();
        await expect(card.getByTestId("plan-field-diff").first()).toBeVisible();
        await expect(card.getByText("旧值", { exact: true }).first()).toBeVisible();
        await expect(card.getByText("新值", { exact: true }).first()).toBeVisible();
      }

      // 6) Subjects (optional contract field): a named stop/participant beats an opaque id.
      const namedRows = await card.getByText(/清水寺|伏见稻荷|岚山/).count();
      test.info().annotations.push({
        type: "subjects",
        description:
          namedRows > 0 ? `named rows visible: ${namedRows}` : "no named subject row in this plan",
      });

      await cardShot(card, "plan-expanded-1440");

      // 7) Clearing every group disables the confirmation.
      const groupCheckboxes = card.getByRole("checkbox", { name: /全部 \d+ 项/ });
      const checkboxCount = await groupCheckboxes.count();
      expect(checkboxCount).toBe(groupCount);
      for (let index = 0; index < checkboxCount; index += 1) {
        const checkbox = groupCheckboxes.nth(index);
        if (await checkbox.isChecked()) await checkbox.click();
      }
      const confirm = card.getByTestId("plan-confirm");
      await expect(confirm).toBeDisabled();
      await expect(confirm).toHaveText(/执行选中的 0 项/);
      await expect(card.getByText("至少选择 1 项才能执行。")).toBeVisible();
      await shot(page, "plan-none-selected-1440");

      // 8) Mobile 390: the same card must not overflow horizontally.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await card.scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
      });
      await expect(overflow, "390px layout must not overflow horizontally").toBeLessThanOrEqual(1);
      await shot(page, "plan-390");
      await cardShot(card, "plan-card-390");
    } finally {
      const removed = await page.request
        .delete(`${WEB_URL}/v1/workspaces/${workspace}/trips/${fixture.id}`)
        .catch(() => null);
      test.info().annotations.push({
        type: "fixture",
        description: `real trip ${fixtureTitle} (${fixture.id}) deleted=${
          removed?.status() ?? "request failed"
        }`,
      });
    }
  });
});
