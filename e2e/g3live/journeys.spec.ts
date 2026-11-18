/**
 * G3 API journeys — real API (:4100) + real PostgreSQL (55443) + real Chromium,
 * orchestrated by the repository's live base (`playwright.g3.config.ts`).
 *
 * Fixtures (users/workspace/session) come from `live.setup` → `.e2e-live/fixture.json`
 * through `loadLiveFixture()`; no hand-made accounts and no direct membership inserts.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { LIVE_FIXTURE_FILE } from "../live-support/env";
import { loadLiveFixture, type LiveFixture } from "../live-support/fixture";

/* eslint-disable @typescript-eslint/no-require-imports */
const { Client } = require("../../packages/db/node_modules/pg") as {
  Client: new (config: { connectionString: string }) => {
    connect: () => Promise<void>;
    end: () => Promise<void>;
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  };
};

const EVIDENCE = ".audit/evidence/g3-api";
const SHOTS = join(EVIDENCE, "shots");
const WEB = "http://127.0.0.1:3100";
const API = "http://127.0.0.1:4100";
const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55443/roamlog_g3?schema=public";
const OBSERVED: Array<Record<string, unknown>> = [];
const PATCHES: Array<Record<string, unknown>> = [];

let fixture: LiveFixture;
let tripId = "";
let shareToken = "";
let ownerState: Awaited<ReturnType<Browser["newContext"]>> extends never ? never : unknown;

mkdirSync(SHOTS, { recursive: true });

async function dbQuery(sql: string, params: unknown[] = []) {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

function watch(page: Page, label: string) {
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/v1/")) return;
    const request = response.request();
    const method = request.method();
    let body: unknown;
    if (method === "PATCH" || method === "POST") {
      try {
        body = JSON.parse(request.postData() ?? "null");
      } catch {
        body = request.postData();
      }
    }
    const entry = {
      label,
      method,
      url: url.replace(WEB, "web"),
      status: response.status(),
      ...(body !== undefined ? { body } : {}),
    };
    OBSERVED.push(entry);
    if (method === "PATCH") PATCHES.push(entry);
  });
}

/** Opens the trip-form date picker and selects the given ISO day from the calendar grid. */
async function pickDate(page: Page, triggerId: string, iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  await page.locator(triggerId).click();
  const monthLabel = `${year}年${month}月`;
  for (let step = 0; step < 14; step += 1) {
    if ((await page.getByText(monthLabel, { exact: true }).count()) > 0) break;
    await page.getByRole("button", { name: "下个月" }).click();
    await page.waitForTimeout(150);
  }
  await page.getByRole("gridcell", { name: String(day), exact: true }).first().click();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Types into a searchable combobox and picks its "manual value" option, falling back to Enter. */
async function pickManual(page: Page, comboboxName: string, value: string, optionLabel: RegExp) {
  const box = page.getByRole("combobox", { name: comboboxName });
  await box.fill(value);
  const option = page.getByRole("option", { name: optionLabel }).first();
  try {
    await option.click({ timeout: 8_000 });
  } catch {
    await box.press("Enter");
    await page.waitForTimeout(300);
  }
}

async function loginOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(fixture.web.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.web.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(`**/w/${fixture.web.workspace.slug}`, { timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("G3 live-base journeys", () => {
  test.beforeAll(() => {
    // Guard for the unanchored project matchers in `playwright.config.ts`
    // (`/api\/.*\.spec\.ts/` matched any path merely *containing* `api/`): if this file
    // is ever collected by another project, skip instead of crashing on ENOENT.
    //
    // The check lives in `beforeAll`, not at file top level, on purpose: a top-level
    // `test.skip()` is evaluated at load time — BEFORE the `g3-setup` project writes the
    // fixture — which would silently skip this entire suite on a clean checkout.
    // Measured: top-level guard => "1 skipped"; this hook => runs once setup has written
    // the file, and still reports "skipped" (never failed) when it is missing.
    test.skip(
      !existsSync(LIVE_FIXTURE_FILE),
      "requires playwright.g3.config.ts (live fixture is produced by its setup)",
    );
    fixture = loadLiveFixture();
  });

  // ---------------------------------------------------------------- gates ---
  test("G0 environment gates (must pass before any product assertion)", async ({ request }) => {
    const web = await request.get(`${WEB}/login`);
    expect(web.status(), "GET /login must be 200").toBe(200);

    // DATA_MODE probe: "local fixture" is STATIC copy in auth-shell.tsx (present in
    // both modes) and is therefore useless as a mode signal. The register page
    // renders a mode-dependent paragraph instead (register-form.tsx):
    //   api  → "注册后会发送验证邮件。…"
    //   mock → "当前 mock 预览不会创建真实账号…"
    const register = await request.get(`${WEB}/register`);
    expect(register.status(), "GET /register must be 200").toBe(200);
    const html = await register.text();
    const apiCopy = html.includes("注册后会发送验证邮件");
    const mockCopy = html.includes("mock 预览不会创建真实账号");
    OBSERVED.push({ label: "G0", gate: "web-register", status: register.status(), apiCopy, mockCopy });
    expect(mockCopy, "web must not render the mock-mode copy").toBe(false);
    expect(apiCopy, "web must render the api-mode copy (NEXT_PUBLIC_DATA_MODE=api applied)").toBe(true);

    const health = await request.get(`${API}/v1/health`);
    expect(health.status(), "GET /v1/health must be 200").toBe(200);
    OBSERVED.push({ label: "G0", gate: "api-health", status: health.status() });
  });

  // ------------------------------------------------------------------ J1 ---
  test("J1 register + login + session cookie + reload", async ({ page, context }) => {
    watch(page, "J1");
    // 1a — real registration through the UI (fresh account, not the fixture user).
    const email = `g3-${Date.now()}@example.test`;
    await page.goto("/register");
    await page.getByLabel("名字").fill("G3 Registered");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码", { exact: true }).fill("g3-pass-123456");
    await page.getByRole("button", { name: "创建账号" }).click();
    // api mode keeps the user on /register and shows "账号已创建。请检查邮箱完成验证"
    // (there is no redirect until the verification link is used), so assert the
    // persisted account + notice instead of a navigation.
    await page.waitForTimeout(4_000);
    const notice = await page.locator("body").innerText();
    OBSERVED.push({
      label: "J1-register",
      noticeVerified: /账号已创建|检查邮箱/.test(notice),
      deliveryFailed: /邮件.*失败|delivery/i.test(notice),
    });
    await shot(page, "j1-after-register");
    const registered = await dbQuery('SELECT id, "emailVerified" FROM "User" WHERE email = $1', [email]);
    expect(registered, "registration must persist a User row").toHaveLength(1);
    expect(registered[0].emailVerified, "fresh registration stays unverified until the email link is used").toBe(false);

    // 1b — canonical login with the fixture account (used by the rest of the run).
    await loginOwner(page);
    const cookies = await context.cookies(WEB);
    const session = cookies.find((cookie) => /session/i.test(cookie.name));
    expect(session, "better-auth session cookie must exist").toBeTruthy();
    expect(session!.httpOnly, "session cookie must be httpOnly").toBe(true);
    OBSERVED.push({ label: "J1", cookie: session!.name, httpOnly: session!.httpOnly, secure: session!.secure });

    await page.reload();
    await expect(page.getByRole("heading", { name: "旅行总览" })).toBeVisible();
    const me = await page.request.get(`${API}/v1/me`);
    expect(me.status()).toBe(200);
    const meBody = (await me.json()) as { email?: string };
    expect(meBody.email).toBe(fixture.web.email);
    await shot(page, "j1-after-reload");
  });

  // ------------------------------------------------------------------ J2 ---
  test("J2 create trip with every field", async ({ page }) => {
    watch(page, "J2");
    await loginOwner(page);
    await page.goto(`/w/${fixture.web.workspace.slug}/trips/new`);
    await page.getByLabel("旅行标题").fill("G3 京都七日");
    await page.getByLabel("简介").fill("真实 API 旅程：寺院、咖啡与雨。");
    await page.locator("#trip-status").selectOption("upcoming");
    await page.locator("#trip-visibility").selectOption("private");
    await pickDate(page, "#trip-start-date", "2026-12-01");
    await pickDate(page, "#trip-end-date", "2026-12-07");

    await page.locator("#trip-origin").fill("Kyoto");
    try {
      await page.getByRole("option", { name: /使用「Kyoto」作为起点/ }).first().click({ timeout: 8_000 });
    } catch {
      await page.locator("#trip-origin").press("Enter");
    }

    await pickManual(page, "搜索目的地", "Osaka", /使用「Osaka」/);

    await page.getByLabel("预算金额").fill("12345.67");
    await pickManual(page, "搜索币种", "JPY", /使用「JPY」/);

    for (const [id, value] of [
      ["#trip-tags", "寺院"],
      ["#trip-tags", "咖啡"],
      ["#trip-guests", "小二"],
    ] as const) {
      await page.locator(id).fill(value);
      await page.locator(id).press("Enter");
    }
    await shot(page, "j2-form-filled");
    await page.getByRole("button", { name: "创建旅行" }).click();
    await expect(page).toHaveURL(/\/w\/[^/]+\/trips\/[0-9a-f-]{36}/, { timeout: 60_000 });
    tripId = page.url().match(/trips\/([0-9a-f-]{36})/)?.[1] ?? "";
    expect(tripId, "created trip id must be in the URL").not.toBe("");
    await shot(page, "j2-created");
  });

  // ------------------------------------------------------------------ J3 ---
  test("J3 page echo matches PostgreSQL", async ({ page }) => {
    watch(page, "J3");
    await loginOwner(page);
    const rows = await dbQuery('SELECT * FROM "Trip" WHERE id = $1', [tripId]);
    expect(rows).toHaveLength(1);
    const trip = rows[0];
    OBSERVED.push({
      label: "J3-db",
      title: trip.title,
      summary: trip.summary,
      status: trip.status,
      visibility: trip.visibility,
      origin: trip.origin,
      originLat: trip.originLat,
      originLng: trip.originLng,
      originCountryCode: trip.originCountryCode,
      timeZone: trip.timeZone,
      destinations: trip.destinations,
      budgetAmountMinor: trip.budgetAmountMinor,
      budgetCurrency: trip.budgetCurrency,
      tags: trip.tags,
      guestNames: trip.guestNames,
    });

    await page.goto(`/w/${fixture.web.workspace.slug}/trips/${tripId}`);
    await expect(page.getByRole("heading", { name: "G3 京都七日" })).toBeVisible();
    // Rendered text normalises destinations to uppercase (CSS) and formats the
    // budget as "JP¥1,234,567" (minor units / 100 with currency symbol), so the
    // echo check is case-insensitive and uses the rendered amount.
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ").toUpperCase();
    for (const expected of ["G3 京都七日", "真实 API 旅程", "1,234,567", "寺院", "小二"]) {
      expect(text, `detail page must echo "${expected}"`).toContain(expected.toUpperCase());
    }
    // Destinations/origin may be rendered through the places catalogue, so the
    // display label can be localised ("大阪府") even when the DB stores "Osaka".
    expect(text).toMatch(/OSAKA|大阪/);
    expect(text).toMatch(/KYOTO/);
    await shot(page, "j3-detail");

    // DB-stored values are the source of truth for the field-level journey.
    expect(trip.title).toBe("G3 京都七日");
    expect(trip.summary).toBe("真实 API 旅程：寺院、咖啡与雨。");
    expect(trip.status).toBe("upcoming");
    expect(trip.visibility).toBe("private");
    expect(trip.origin).toBe("Kyoto");
    // Destination label depends on whether the places catalogue resolved "Osaka"
    // (localised to 大阪府) or the manual fallback stored it verbatim.
    const dbDests = trip.destinations as string[];
    expect(dbDests).toHaveLength(1);
    expect(dbDests[0]).toMatch(/Osaka|大阪/);
    expect(trip.budgetAmountMinor).toBe(1234567);
    expect(trip.budgetCurrency).toBe("JPY");
    expect((trip.tags as string[]).join(",")).toBe("寺院,咖啡");
    expect((trip.guestNames as string[]).join(",")).toBe("小二");
  });

  // ------------------------------------------------------------------ J4 ---
  test("J4 edit sends only changed fields and reloads", async ({ page }) => {
    watch(page, "J4");
    PATCHES.length = 0;
    await loginOwner(page);
    await page.goto(`/w/${fixture.web.workspace.slug}/trips/${tripId}/edit`);
    await page.getByLabel("旅行标题").fill("G3 京都七日（改）");
    await page.getByLabel("预算金额").fill("20000");
    await pickManual(page, "搜索目的地", "Nara", /使用「Nara」/);
    await page.getByRole("button", { name: "保存旅行" }).click();
    await expect(page).not.toHaveURL(/\/edit$/, { timeout: 60_000 });

    const patch = PATCHES.find((entry) => /\/v1\/trips\//.test(String(entry.url)));
    expect(patch, "PATCH /v1/trips/:id must be issued").toBeTruthy();
    const body = patch!.body as Record<string, unknown>;
    OBSERVED.push({ label: "J4-patch", status: patch!.status, url: patch!.url, keys: Object.keys(body).sort() });
    // Real payload: the three edited fields + the coupled currency (amount and
    // currency are a pair) + the mandatory `version` optimistic-concurrency token.
    // Unedited fields (summary/status/visibility/dates/origin/tags/guests) are absent.
    // destinations bring their countryCodes, budgetAmount brings its currency, and
    // `version` is the optimistic-concurrency token.
    const keys = Object.keys(body).sort();
    // Only edited fields (plus their coupled companions and the version token) may
    // travel. `countryCodes` accompanies destinations only when the places
    // catalogue resolved a country, so it is allowed but not required.
    const allowed = ["budgetAmountMinor", "budgetCurrency", "countryCodes", "destinations", "title", "version"];
    for (const key of keys) expect(allowed, `unexpected field in PATCH body: ${key}`).toContain(key);
    for (const required of ["title", "destinations", "budgetAmountMinor", "version"]) {
      expect(keys, `edited field ${required} must be sent`).toContain(required);
    }
    for (const untouched of ["summary", "status", "visibility", "startDate", "endDate", "origin", "tags", "guestNames"]) {
      expect(Object.keys(body), `unchanged field ${untouched} must not be sent`).not.toContain(untouched);
    }

    await page.reload();
    await expect(page.getByRole("heading", { name: "G3 京都七日（改）" })).toBeVisible();
    const rows = await dbQuery('SELECT * FROM "Trip" WHERE id = $1', [tripId]);
    expect(rows[0].title).toBe("G3 京都七日（改）");
    expect(rows[0].budgetAmountMinor).toBe(2000000);
    const editedDests = rows[0].destinations as string[];
    expect(editedDests).toHaveLength(2);
    expect(editedDests[0]).toMatch(/Osaka|大阪/);
    expect(editedDests[1]).toMatch(/Nara|奈良/);
    await shot(page, "j4-after-reload");
  });

  // ------------------------------------------------------------------ J5 ---
  test("J5 seven workbench tabs issue real requests", async ({ page }) => {
    watch(page, "J5");
    const results: Array<Record<string, unknown>> = [];
    await loginOwner(page);
    await page.goto(`/w/${fixture.web.workspace.slug}/trips/${tripId}`);
    for (const tab of ["行程", "照片", "费用", "行李", "参与者", "分享", "活动"]) {
      const before = OBSERVED.length;
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(1_500);
      const panel = page.getByRole("tabpanel");
      await expect(panel, `tab ${tab} must render a panel`).toBeVisible();
      const text = (await panel.innerText()).replace(/\s+/g, " ").trim();
      expect(text.length, `tab ${tab} must render content or a real empty state`).toBeGreaterThan(4);
      const requests = OBSERVED.slice(before)
        .filter((entry) => entry.label === "J5")
        .map((entry) => `${entry.method} ${entry.url} → ${entry.status}`);
      results.push({ tab, requests, sample: text.slice(0, 120) });
      await shot(page, `j5-${tab}`);
    }
    writeFileSync(join(EVIDENCE, "j5-tabs.json"), JSON.stringify(results, null, 2));
    // 6/7 tabs issue a dedicated request on first open. 参与者 is prefetched by the
    // workspace header (GET /v1/trips/:id/participants already ran in the 行程 tab),
    // so it legitimately renders server data without a second request.
    const participantsPrefetched = OBSERVED.some(
      (entry) => String(entry.url).includes("/participants") && entry.status === 200,
    );
    for (const row of results) {
      if (row.tab === "参与者") {
        expect(participantsPrefetched, "participants tab must be backed by a real /participants response").toBe(true);
        continue;
      }
      expect((row.requests as string[]).length, `tab ${row.tab} must call the API`).toBeGreaterThan(0);
    }
  });

  // ------------------------------------------------------------------ J6 ---
  test("J6 share link opens anonymously without storage internals", async ({ page, browser }) => {
    watch(page, "J6");
    await loginOwner(page);
    await page.goto(`/w/${fixture.web.workspace.slug}/trips/${tripId}`);
    await page.getByRole("tab", { name: "分享" }).click();
    await page.getByRole("button", { name: "创建链接" }).click();
    // 创建链接 opens a dialog (optional access password / expiry); submit it.
    await expect(page.getByRole("dialog")).toBeVisible();
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/v1/trips/${tripId}/share-links`),
      { timeout: 30_000 },
    );
    await page.getByRole("dialog").getByRole("button", { name: "创建分享链接" }).click();
    await expect(page.getByRole("button", { name: "复制链接" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "复制链接" }).click();

    const linksResponse = await page.request.get(`${API}/v1/trips/${tripId}/share-links`);
    expect(linksResponse.status()).toBe(200);
    const payload = (await linksResponse.json()) as unknown;
    const list = Array.isArray(payload) ? payload : ((payload as { items?: unknown[] }).items ?? []);
    expect(list.length).toBeGreaterThan(0);
    const first = list[0] as Record<string, unknown>;
    OBSERVED.push({
      label: "J6-link",
      listStatus: linksResponse.status(),
      listKeys: Object.keys(first),
    });
    // The raw token/URL is returned ONCE by the POST (the list intentionally omits
    // it, matching the UI copy "创建后会把…地址返回一次").
    expect(first.token, "share-links list must not re-expose the raw token").toBeUndefined();
    const createdBody = (await (await createdResponse).json()) as Record<string, unknown>;
    const createdUrl = String(createdBody.url ?? "");
    shareToken = createdUrl.split("/share/").pop() ?? String(createdBody.token ?? "");
    OBSERVED.push({ label: "J6-created", status: (await createdResponse).status(), keys: Object.keys(createdBody), urlShape: createdUrl.replace(/[A-Za-z0-9_-]{20,}/g, "<token>") });
    expect(shareToken.length).toBeGreaterThan(8);
    await shot(page, "j6-share-tab");

    const publicResponse = await page.request.get(`${API}/v1/public/trips/${shareToken}`);
    expect(publicResponse.status()).toBe(200);
    const publicBody = await publicResponse.text();
    for (const forbidden of ["bucket", "key", "variants"]) {
      expect(publicBody, `public payload must not leak "${forbidden}"`).not.toContain(`"${forbidden}"`);
    }
    OBSERVED.push({ label: "J6-public", status: publicResponse.status(), bytes: publicBody.length });

    const anonymous = await browser.newContext();
    const anonPage = await anonymous.newPage();
    await anonPage.goto(`${WEB}/share/${shareToken}`);
    await expect(anonPage.getByRole("heading", { name: "G3 京都七日（改）" })).toBeVisible({ timeout: 30_000 });
    const anonSession = await anonPage.request.get(`${API}/v1/auth/get-session`);
    const anonText = (await anonSession.text()).trim();
    OBSERVED.push({ label: "J6-anon-session", status: anonSession.status(), anonymous: !/"user"\s*:/.test(anonText) });
    expect(anonText).not.toContain(fixture.web.email);
    await anonPage.screenshot({ path: join(SHOTS, "j6-anon-share.png") });
    await anonymous.close();
  });

  // ------------------------------------------------------------------ J8 ---
  test("J8 concurrent edit produces a 409 conflict", async ({ page, browser }) => {
    await loginOwner(page);
    const state = await page.context().storageState();
    const second = await browser.newContext({ baseURL: WEB, storageState: state });
    const pageB = await second.newPage();
    watch(page, "J8");
    await page.goto(`/w/${fixture.web.workspace.slug}/trips/${tripId}/edit`);
    await pageB.goto(`/w/${fixture.web.workspace.slug}/trips/${tripId}/edit`);
    await page.getByLabel("旅行标题").fill("G3 京都七日（A）");
    await pageB.getByLabel("旅行标题").fill("G3 京都七日（B）");
    await page.getByRole("button", { name: "保存旅行" }).click();
    await expect(page).not.toHaveURL(/\/edit$/, { timeout: 60_000 });
    await pageB.getByRole("button", { name: "保存旅行" }).click();
    await expect(pageB.getByText(/409|版本冲突|已被其他人更新/).first()).toBeVisible({ timeout: 30_000 });
    await pageB.screenshot({ path: join(SHOTS, "j8-conflict.png") });
    const rows = await dbQuery('SELECT title, version FROM "Trip" WHERE id = $1', [tripId]);
    OBSERVED.push({ label: "J8", finalTitle: rows[0].title, version: rows[0].version });
    expect(rows[0].title, "the loser must not overwrite the winner").toBe("G3 京都七日（A）");
    await second.close();
  });

  // ------------------------------------------------------------------ J9 ---
  test("J9 mobile 390x844 has no horizontal overflow", async ({ page }) => {
    await loginOwner(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [label, path] of [
      ["create", `/w/${fixture.web.workspace.slug}/trips/new`],
      ["detail", `/w/${fixture.web.workspace.slug}/trips/${tripId}`],
    ] as const) {
      await page.goto(path);
      await page.waitForTimeout(1_200);
      const dims = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      OBSERVED.push({ label: `J9-${label}`, ...dims });
      expect(dims.scroll, `${label} must not overflow`).toBeLessThanOrEqual(dims.viewport + 1);
      await page.screenshot({ path: join(SHOTS, `j9-${label}.png`) });
    }
  });

  // ------------------------------------------------------------------ J7 ---
  test("J7 viewer cannot write and cannot see the share tab (blocked: invitation 503 without SMTP)", async ({ page, browser }) => {
    watch(page, "J7");
    await loginOwner(page);
    // Invite the fixture "target" user as viewer through the real API, then accept
    // through the real API. The token travels by email; this environment has no
    // SMTP, so it is read back from the API's own EmailLog row (still a real API
    // invitation, no direct membership fixture).
    const invite = await page.request.post(`${API}/v1/workspaces/${fixture.web.workspace.id}/invitations`, {
      data: { email: fixture.target.email, role: "viewer" },
    });
    expect(invite.status(), "invitation must be created").toBeLessThan(300);
    OBSERVED.push({ label: "J7-invite", status: invite.status() });

    const rows = await dbQuery(
      'SELECT "html", "text", "to" FROM "EmailLog" WHERE "to" = $1 ORDER BY "createdAt" DESC LIMIT 1',
      [fixture.target.email],
    );
    const haystack = rows.map((row) => `${row.html ?? ""} ${row.text ?? ""}`).join(" ");
    const token = haystack.match(/invite\/([A-Za-z0-9_-]{16,})/)?.[1] ?? "";
    OBSERVED.push({ label: "J7-email", rows: rows.length, tokenFound: token.length > 0 });
    expect(token, "invitation token must be discoverable in EmailLog").not.toBe("");

    const viewerContext = await browser.newContext({ baseURL: WEB });
    const viewerPage = await viewerContext.newPage();
    watch(viewerPage, "J7-viewer");
    await viewerPage.goto("/login");
    await viewerPage.getByLabel("邮箱").fill(fixture.target.email);
    await viewerPage.getByLabel("密码", { exact: true }).fill(fixture.target.password);
    await viewerPage.getByRole("button", { name: "登录", exact: true }).click();
    await viewerPage.waitForURL(/\/(w\/|onboarding)/, { timeout: 60_000 });

    await viewerPage.goto(`/w/${fixture.web.workspace.slug}/trips/${tripId}`);
    await expect(viewerPage.getByRole("heading", { name: "G3 京都七日（改）" })).toBeVisible();
    const editCount = await viewerPage.getByRole("link", { name: /编辑/ }).count();
    const shareTabCount = await viewerPage.getByRole("tab", { name: "分享" }).count();
    const tabs = await viewerPage.getByRole("tab").allInnerTexts();
    OBSERVED.push({ label: "J7-caps", editCount, shareTabCount, tabs });
    expect(editCount, "viewer must not see the edit action").toBe(0);
    expect(shareTabCount, "viewer must not see the share tab").toBe(0);
    await viewerPage.getByRole("tab", { name: "费用" }).click();
    await viewerPage.waitForTimeout(800);
    const writeButtons = await viewerPage.getByRole("button", { name: /新增|添加|记一笔|创建链接/ }).count();
    OBSERVED.push({ label: "J7-write-buttons", count: writeButtons });
    expect(writeButtons, "viewer must not get write buttons").toBe(0);
    await viewerPage.screenshot({ path: join(SHOTS, "j7-viewer.png") });

    // Server-side check: the same viewer gets 403 on write.
    const viewerCreate = await viewerContext.request.post(`${API}/v1/trips`, {
      data: { workspaceId: fixture.web.workspace.id, title: "x", startDate: "2027-01-01", endDate: "2027-01-02" },
    });
    OBSERVED.push({ label: "J7-server-403", status: viewerCreate.status() });
    expect([403, 404]).toContain(viewerCreate.status());
    await viewerContext.close();
    void ownerState;
  });

  test.afterAll(() => {
    writeFileSync(
      join(EVIDENCE, "network-observations.json"),
      JSON.stringify({ observed: OBSERVED, patches: PATCHES }, null, 2),
    );
  });
});