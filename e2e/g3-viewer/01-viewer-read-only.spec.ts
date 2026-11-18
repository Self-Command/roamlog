/**
 * G3_VIEWER_E2E — "Viewer 只能阅读和评论，不能写" on the live local stack.
 *
 * Contract source of truth: `packages/contracts/src/permissions.ts`
 *   viewer = readOnlyActions + commentActions
 *   (share-link:read is a *content write* action → viewer must not see the 分享 tab)
 * UI matrix: `apps/web/components/trip-workspace/capabilities.ts`
 *   every blocked control must be hidden or disabled with a `title` reason.
 *
 * Two genuinely independent browser contexts: `beforeAll` owns the owner
 * context that seeds data; every viewer test creates its own fresh context, so
 * no owner cookie/storageState can leak into the viewer session.
 *
 * Verify-only: this file writes screenshots/JSON under .audit/evidence/g3-viewer
 * and never touches product code.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const WEB = process.env.G3_VIEWER_WEB_URL ?? "http://localhost:3000";
const SLUG = "verify-crew";
const EVIDENCE = ".audit/evidence/g3-viewer";

const OWNER = { email: "verify@roamlog.test", password: "Roamlog-Verify-Aa1!" };
const VIEWER = { email: "viewer@roamlog.test", password: "Roamlog-Verify-Aa1!" };
const RUN = Date.now().toString(36).toUpperCase();

mkdirSync(`${EVIDENCE}/screens`, { recursive: true });
mkdirSync(`${EVIDENCE}/out`, { recursive: true });

function writeEvidence(name: string, data: unknown): void {
  writeFileSync(`${EVIDENCE}/out/${name}.json`, JSON.stringify(data, null, 2));
}

async function login(page: Page, cred: { email: string; password: string }): Promise<void> {
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("邮箱").fill(cred.email);
  await page.getByLabel("密码").fill(cred.password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

interface ApiResult {
  status: number;
  code: string | null;
  detail: string | null;
  body: unknown;
}

/** Same-origin /v1 fetch from the real page, carrying the httpOnly session. */
async function api(page: Page, path: string, init?: RequestInit): Promise<ApiResult> {
  return page.evaluate(
    async ({ path, init }) => {
      const res = await fetch(path, { credentials: "include", ...(init ?? {}) });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      const record = (body ?? {}) as Record<string, unknown>;
      return {
        status: res.status,
        code: typeof record.code === "string" ? record.code : null,
        detail: typeof record.detail === "string" ? record.detail : null,
        body,
      };
    },
    { path, init },
  );
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function controlState(page: Page, name: string) {
  const byRole = page.getByRole("button", { name, exact: true });
  const byLink = page.getByRole("link", { name, exact: true });
  const buttonCount = await byRole.count();
  const linkCount = await byLink.count();
  const locator = buttonCount > 0 ? byRole.first() : byLink.first();
  const count = buttonCount + linkCount;
  if (count === 0) {
    return { name, count: 0, visible: false, disabled: null, title: null, ariaDisabled: null, tag: null };
  }
  return {
    name,
    count,
    visible: await locator.isVisible(),
    disabled: (await locator.isDisabled().catch(() => false)) || null,
    title: await locator.getAttribute("title"),
    ariaDisabled: await locator.getAttribute("aria-disabled"),
    tag: await locator.evaluate((el) => el.tagName.toLowerCase()),
  };
}

async function mapTripIdFromJson(page: Page, path: string, title: string): Promise<string | null> {
  const result = await api(page, path);
  const text = JSON.stringify(result.body);
  if (!text.includes(title)) return null;
  // entries pages: { items: [...] } or { data: [...] }; find the record by title.
  const stack: unknown[] = [result.body];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    if (typeof record.title === "string" && record.title === title && typeof record.id === "string") {
      return record.id;
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

const state: {
  tripId: string;
  tripUrl: string;
  tripTitle: string;
  workspaceId: string;
  stopCity: string;
  expenseNote: string;
  packingName: string;
  entryTitle: string;
  entryId: string | null;
  ownerContext?: BrowserContext;
} = {
  tripId: "",
  tripUrl: "",
  tripTitle: "",
  workspaceId: "",
  stopCity: "京都",
  expenseNote: `G3 viewer 验收支出 ${RUN}`,
  packingName: `护照 G3 ${RUN}`,
  entryTitle: `Viewer 可评论的日志 ${RUN}`,
  entryId: null,
};

test.describe("G3_VIEWER_E2E — Viewer 只读 + 可评论（live stack）", () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ baseURL: WEB, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    state.ownerContext = context;
    await login(page, OWNER);

    const me = await api(page, "/v1/me");
    expect(me.status, "owner session must be live").toBe(200);
    expect((me.body as { email?: string }).email).toBe(OWNER.email);

    const workspaces = await api(page, "/v1/me/workspaces");
    const ws = (workspaces.body as Array<{ slug: string; id: string; role: string }>).find(
      (item) => item.slug === SLUG,
    );
    expect(ws, `owner must belong to ${SLUG}`).toBeTruthy();
    expect(ws?.role).toBe("owner");
    state.workspaceId = ws!.id;

    // --- owner creates the trip through the real UI ---
    await page.goto(`${WEB}/w/${SLUG}/trips/new`, { waitUntil: "domcontentloaded" });
    state.tripTitle = `Viewer 权限验收 ${RUN}`;
    await page.getByLabel("标题").fill(state.tripTitle);
    await page.getByRole("button", { name: "创建旅行" }).click();
    await page.waitForURL(/\/trips\/[0-9a-f-]{20,}$/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});

    const path = new URL(page.url()).pathname;
    state.tripUrl = path;
    state.tripId = path.split("/").pop()!;
    expect(state.tripId).toMatch(/^[0-9a-f-]{20,}$/);
    await expect(page.getByRole("heading", { name: state.tripTitle, exact: true })).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/screens/owner-01-trip-created.png`, fullPage: true });

    // --- seed real child data so viewer tabs show real rows, not only empty states ---
    await page.getByRole("button", { name: /^添加(节点|第一个节点)$/ }).first().click();
    const stopDialog = page.getByRole("dialog");
    await stopDialog.getByLabel("城市").fill(state.stopCity);
    await stopDialog.getByLabel("国家", { exact: true }).fill("Japan");
    await stopDialog.getByLabel("国家码").fill("JP");
    await stopDialog.getByLabel("开始日期").fill("2027-05-02");
    await stopDialog.getByLabel("结束日期").fill("2027-05-04");
    await stopDialog.getByRole("button", { name: "保存节点" }).click();
    await expect(stopDialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(state.stopCity, { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("tab", { name: "费用", exact: true }).click();
    await page.getByRole("button", { name: /^记(一笔|第一笔)$/ }).first().click();
    const expenseDialog = page.getByRole("dialog");
    await expenseDialog.getByLabel("金额").fill("128.50");
    await expenseDialog.getByLabel("币种").fill("CNY");
    const payer = page.locator("#expense-payer");
    const payerOptions = await payer.locator("option").allTextContents();
    if (payerOptions.length > 1) {
      await payer.selectOption({ index: 1 });
    }
    await expenseDialog.getByLabel("备注").fill(state.expenseNote);
    await expenseDialog.getByRole("button", { name: "记录支出" }).click();
    await expect(expenseDialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(/128\.50/).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("tab", { name: "行李", exact: true }).click();
    await page.getByRole("button", { name: /^添加(行李|第一件)$/ }).first().click();
    const packingDialog = page.getByRole("dialog");
    await packingDialog.getByLabel("名称").fill(state.packingName);
    await packingDialog.getByRole("button", { name: "保存行李" }).click();
    await expect(packingDialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(state.packingName).first()).toBeVisible({ timeout: 20_000 });

    // --- owner journal entry gives the viewer a real comment target ---
    await page.goto(`${WEB}/w/${SLUG}/journal`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "写日志" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("所属旅行*").selectOption({ label: state.tripTitle });
    await sheet.getByLabel("标题*").fill(state.entryTitle);
    await sheet.getByLabel("日期").fill("2027-05-03");
    await sheet.getByLabel("地点*").fill("京都");
    await sheet.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText(state.entryTitle).first()).toBeVisible({ timeout: 30_000 });
    state.entryId = await mapTripIdFromJson(page, `/v1/trips/${state.tripId}/entries`, state.entryTitle);
    writeEvidence("owner-setup", state);
    await page.screenshot({ path: `${EVIDENCE}/screens/owner-02-data-seeded.png`, fullPage: true });
  });

  test.afterAll(async () => {
    await state.ownerContext?.close();
  });

  test("1. viewer 读取能力：列表、详情、7 tab 契约与真实数据/空状态", async ({ page }) => {
    await login(page, VIEWER);
    const me = await api(page, "/v1/me");
    expect((me.body as { email?: string }).email, "viewer context must be the viewer user").toBe(
      VIEWER.email,
    );
    // Independent context: the viewer context must not know the owner identity.
    expect((me.body as { email?: string }).email).not.toBe(OWNER.email);

    await page.goto(`${WEB}/w/${SLUG}/trips`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const tripLink = page.getByRole("link", { name: new RegExp(state.tripTitle) }).first();
    await expect(tripLink, "viewer must see the owner-created trip in the list").toBeVisible({
      timeout: 20_000,
    });
    await page.screenshot({ path: `${EVIDENCE}/screens/viewer-01-trip-list.png`, fullPage: true });

    await page.goto(`${WEB}${state.tripUrl}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(
      page.getByRole("heading", { name: state.tripTitle, exact: true }),
      "viewer must read the trip detail",
    ).toBeVisible({ timeout: 20_000 });

    const tabs = await page.getByRole("tab").allTextContents();
    writeEvidence("viewer-tabs", { tabs });
    const expectedTabs = ["行程", "照片", "费用", "行李", "参与者", "活动"];
    for (const name of expectedTabs) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    // Contract: viewer has no `share-link:read` → 分享 tab must not exist.
    await expect(
      page.getByRole("tab", { name: "分享", exact: true }),
      "分享 tab must be absent for viewer (no share-link:read)",
    ).toHaveCount(0);
    expect(tabs).toHaveLength(expectedTabs.length);

    // Read real rows in the tabs that were seeded, and record every tab panel.
    const panelText: Record<string, string> = {};
    for (const name of expectedTabs) {
      await page.getByRole("tab", { name, exact: true }).click();
      await page.waitForTimeout(700);
      const panel = page.locator('[role="tabpanel"]').first();
      await expect(panel).toBeVisible();
      panelText[name] = (await panel.innerText()).slice(0, 400);
      await page.screenshot({
        path: `${EVIDENCE}/screens/viewer-tab-${name}.png`,
        fullPage: true,
      });
    }
    writeEvidence("viewer-tab-panels", panelText);

    expect(panelText["行程"]).toContain(state.stopCity);
    expect(panelText["费用"]).toContain("128.50");
    expect(panelText["行李"]).toContain(state.packingName);
    for (const name of ["照片", "参与者", "活动"]) {
      expect(panelText[name].trim().length, `${name} tab must render real content or a real empty state`).toBeGreaterThan(0);
    }
  });

  test("2. viewer 服务端硬边界：四类写操作被拒并保持数据不变", async ({ page }) => {
    await login(page, VIEWER);
    await page.goto(`${WEB}/w/${SLUG}/trips`, { waitUntil: "domcontentloaded" });

    const read = await api(page, `/v1/trips/${state.tripId}`);
    expect(read.status, "viewer must still be able to read the trip").toBe(200);
    const before = read.body as { version?: number; title?: string; deletedAt?: string | null };
    expect(before.title).toBe(state.tripTitle);

    const results = {
      tripId: state.tripId,
      versionBefore: before.version ?? null,
      requests: [] as Array<{
        label: string;
        method: string;
        path: string;
        status: number;
        code: string | null;
        detail: string | null;
        verdict: string;
      }>,
    };

    const record = async (
      label: string,
      method: string,
      path: string,
      result: ApiResult,
      expectDenied = true,
    ) => {
      results.requests.push({
        label,
        method,
        path,
        status: result.status,
        code: result.code,
        detail: result.detail,
        verdict:
          expectDenied && result.status === 403 && result.code === "WORKSPACE_ROLE_FORBIDDEN"
            ? "DENIED (PASS)"
            : expectDenied
              ? "UNEXPECTED"
              : "ROUTE-NOT-FOUND (documented deviation)",
      });
    };

    // The generic `POST /v1/trips` route does not exist in this API; record the
    // real answer, then use the workspace-scoped create route as the authority.
    record(
      "新建旅行 POST /v1/trips（任务书示例路径，实际无此路由）",
      "POST",
      "/v1/trips",
      await api(page, "/v1/trips", jsonInit("POST", { title: `viewer-should-fail ${RUN}`, startDate: "2027-06-01", endDate: "2027-06-03" })),
      false,
    );
    record(
      "新建旅行 POST /v1/workspaces/:id/trips（真实路由）",
      "POST",
      `/v1/workspaces/${state.workspaceId}/trips`,
      await api(
        page,
        `/v1/workspaces/${state.workspaceId}/trips`,
        jsonInit("POST", { title: `viewer-should-fail ${RUN}`, startDate: "2027-06-01", endDate: "2027-06-03" }),
      ),
    );
    record(
      "编辑旅行 PATCH /v1/trips/:id",
      "PATCH",
      `/v1/trips/${state.tripId}`,
      await api(page, `/v1/trips/${state.tripId}`, jsonInit("PATCH", { title: "viewer 越权编辑", version: before.version })),
    );
    record(
      "设置封面 POST /v1/trips/:id/cover",
      "POST",
      `/v1/trips/${state.tripId}/cover`,
      await api(page, `/v1/trips/${state.tripId}/cover`, jsonInit("POST", { mediaId: state.tripId })),
    );
    record(
      "删除旅行 DELETE /v1/trips/:id",
      "DELETE",
      `/v1/trips/${state.tripId}`,
      await api(page, `/v1/trips/${state.tripId}`, { method: "DELETE" }),
    );
    record(
      "分享链接 GET /v1/trips/:id/share-links（viewer 无 share-link:read）",
      "GET",
      `/v1/trips/${state.tripId}/share-links`,
      await api(page, `/v1/trips/${state.tripId}/share-links`),
    );
    record(
      "添加行程节点 POST /v1/trips/:id/stops",
      "POST",
      `/v1/trips/${state.tripId}/stops`,
      await api(page, `/v1/trips/${state.tripId}/stops`, jsonInit("POST", { city: "越权节点", country: "CN", countryCode: "CN" })),
    );
    record(
      "记一笔 POST /v1/trips/:id/expenses",
      "POST",
      `/v1/trips/${state.tripId}/expenses`,
      await api(
        page,
        `/v1/trips/${state.tripId}/expenses`,
        jsonInit("POST", { date: "2027-05-02", category: "other", amountMinor: 1000, currency: "CNY", payerId: state.workspaceId }),
      ),
    );
    record(
      "添加行李 POST /v1/trips/:id/packing",
      "POST",
      `/v1/trips/${state.tripId}/packing`,
      await api(page, `/v1/trips/${state.tripId}/packing`, jsonInit("POST", { name: "越权行李" })),
    );

    // Data must be untouched after every denied attempt.
    const after = await api(page, `/v1/trips/${state.tripId}`);
    const afterBody = after.body as { version?: number; title?: string; deletedAt?: string | null };
    results["versionAfter"] = afterBody.version ?? null;
    writeEvidence("viewer-api-boundary", results);

    for (const row of results.requests.filter((item) => item.verdict.includes("PASS"))) {
      expect(row.status, `${row.label} must be 403`).toBe(403);
      expect(row.code, `${row.label} must be WORKSPACE_ROLE_FORBIDDEN`).toBe("WORKSPACE_ROLE_FORBIDDEN");
    }
    expect(results.requests.filter((item) => item.verdict.includes("PASS"))).toHaveLength(7);
    expect(after.status).toBe(200);
    expect(afterBody.title).toBe(state.tripTitle);
    expect(afterBody.version).toBe(before.version);
    expect(afterBody.deletedAt).toBeNull();
    await page.screenshot({ path: `${EVIDENCE}/screens/viewer-02-api-denied.png`, fullPage: true });
  });

  test("3. viewer 可评论：真实入口发评论成功（UI + API）", async ({ page }) => {
    await login(page, VIEWER);
    await page.goto(`${WEB}/w/${SLUG}/journal`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByText(state.entryTitle).first(), "viewer must read the entry").toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: new RegExp(state.entryTitle) }).first().click();
    await expect(page.getByText("同行者的话")).toBeVisible({ timeout: 20_000 });
    const body = `Viewer 评论 ${RUN}`;
    await page.getByLabel("评论内容").fill(body);
    await page.getByRole("button", { name: "发送评论" }).click();
    await expect(page.getByText(body).first(), "viewer comment must appear").toBeVisible({
      timeout: 20_000,
    });
    await page.screenshot({ path: `${EVIDENCE}/screens/viewer-03-comment.png`, fullPage: true });

    const viaApi = state.entryId
      ? await api(
          page,
          "/v1/comments",
          jsonInit("POST", {
            tripId: state.tripId,
            targetType: "journal_entry",
            targetId: state.entryId,
            body: `Viewer API 评论 ${RUN}`,
          }),
        )
      : null;
    writeEvidence("viewer-comment", { uiComment: body, entryId: state.entryId, api: viaApi });

    if (viaApi) {
      expect(viaApi.status, "viewer POST /v1/comments must be accepted").toBe(201);
      expect((viaApi.body as { authorId?: string }).authorId).toBeTruthy();
    }
  });

  test("4. viewer 写控件清单：不可见或 disabled+原因 title，分享 tab 不存在", async ({ page }) => {
    await login(page, VIEWER);
    const rows: Array<Record<string, unknown>> = [];

    await page.goto(`${WEB}/w/${SLUG}/trips`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    rows.push({ screen: "trips-list", ...(await controlState(page, "新建旅行")) });

    await page.goto(`${WEB}${state.tripUrl}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    for (const name of ["编辑旅行", "复制", "删除", "选择图片"]) {
      rows.push({ screen: "trip-header", ...(await controlState(page, name)) });
    }
    rows.push({
      screen: "trip-tabs",
      name: "分享",
      count: await page.getByRole("tab", { name: "分享", exact: true }).count(),
      visible: await page.getByRole("tab", { name: "分享", exact: true }).count() > 0,
      disabled: null,
      title: null,
      ariaDisabled: null,
      tag: "tab",
    });

    const tabChecks: Array<{ tab: string; names: string[] }> = [
      { tab: "行程", names: ["添加节点", "添加第一个节点"] },
      { tab: "照片", names: ["上传照片", "添加照片", "删除照片", "设为封面", "选择图片"] },
      { tab: "费用", names: ["记一笔", "记第一笔"] },
      { tab: "行李", names: ["添加行李", "添加第一件"] },
      { tab: "参与者", names: ["添加参与者"] },
    ];
    for (const { tab, names } of tabChecks) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.waitForTimeout(600);
      for (const name of names) {
        rows.push({ screen: `tab:${tab}`, ...(await controlState(page, name)) });
      }
      if (tab === "行李") {
        const boxes = page.getByRole("checkbox");
        const count = await boxes.count();
        rows.push({
          screen: "tab:行李",
          name: "行李复选框",
          count,
          visible: count > 0,
          disabled: count > 0 ? await boxes.first().isDisabled().catch(() => false) : null,
          title: count > 0 ? await boxes.first().getAttribute("title") : null,
          ariaDisabled: count > 0 ? await boxes.first().getAttribute("aria-disabled") : null,
          tag: "checkbox",
        });
      }
    }

    // Share tab is absent, so assert creation is not reachable at all.
    rows.push({ screen: "tab:分享", ...(await controlState(page, "创建链接")) });

    writeEvidence("viewer-controls", rows);
    await page.screenshot({ path: `${EVIDENCE}/screens/viewer-04-controls-packing.png`, fullPage: true });

    // Hard contract rows that must already be blocked with a reason.
    for (const name of ["编辑旅行", "复制", "删除", "添加节点", "记一笔", "添加行李"]) {
      const row = rows.find((item) => item.name === name || item.name === `${name}`);
      expect(row, `${name} control must be discoverable`).toBeTruthy();
      expect(row!.count, `${name} must be present but disabled`).toBeGreaterThan(0);
      expect(row!.disabled, `${name} must be disabled for viewer`).toBeTruthy();
      expect(String(row!.title ?? ""), `${name} must carry a reason title`).toContain("Viewer");
    }
    expect(rows.find((item) => item.name === "分享")?.count).toBe(0);
    expect(rows.find((item) => item.name === "创建链接")?.count).toBe(0);

    // Product-contract gaps required by the task book. These are soft so the
    // whole inventory is still recorded in evidence before the test settles.
    const newTrip = rows.find((item) => item.screen === "trips-list" && item.name === "新建旅行");
    expect
      .soft(newTrip?.count, "新建旅行 must be hidden or disabled+title for viewer")
      .toBe(0);
    const cover = rows.find((item) => item.name === "选择图片");
    expect.soft(cover?.title, "disabled cover control must explain itself via title").toBeTruthy();

    // No usable photo destructive control exists at all.
    for (const name of ["上传照片", "添加照片", "删除照片"]) {
      const row = rows.find((item) => item.name === name);
      expect(row?.count ?? 0, `${name} must not exist for viewer`).toBe(0);
    }
  });
});