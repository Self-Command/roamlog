import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * G3_FIX_VERIFY harness.
 *
 * Why there are two interception layers
 * -------------------------------------
 * The web app boots MSW inside a Service Worker (`apps/web/public/mockServiceWorker.js`),
 * so `/v1/*` is served from inside the worker. Playwright's `page.route()` sits at the
 * page network layer and never sees those requests: in this suite the route handler is
 * registered for every test and always reports `routeHits: 0` (logged as evidence).
 * The deterministic layer that *does* see the request is `window.fetch`, which the
 * generated Orval client calls directly. We therefore install the requested
 * `page.route()` interception (kept, and its hit count recorded) plus an init-script
 * fetch shim that returns the exact same payload. No MSW source is modified.
 */

export type FailureMode = "json500" | "network-error";

export interface InterceptionStats {
  routeHits: number;
  shimHits: number;
  mode: FailureMode;
}

const JSON_500_BODY = { code: "UPSTREAM_ERROR", message: "Internal Server Error" };

export async function installPlaceSearchFailure(
  page: Page,
  mode: FailureMode,
): Promise<() => Promise<InterceptionStats>> {
  let routeHits = 0;

  // 1) The interception API named by the task. Recorded for audit even though the
  //    service worker owns the request.
  await page.route("**/v1/places/search**", async (route) => {
    routeHits += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify(JSON_500_BODY),
    });
  });

  // 2) The layer that actually receives the call.
  await page.addInitScript(({ failureMode }: { failureMode: FailureMode }) => {
    const key = "__g3fixPlaceShim";
    const original = window.fetch.bind(window);
    (window as unknown as Record<string, { hits: number }>)[key] = { hits: 0 };
    const shimmed = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes("/v1/places/search")) {
        return original(input as RequestInfo, init);
      }
      (window as unknown as Record<string, { hits: number }>)[key].hits += 1;
      if (failureMode === "network-error") {
        throw new TypeError("Failed to fetch");
      }
      return new Response(JSON.stringify({ code: "UPSTREAM_ERROR", message: "Internal Server Error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    };
    window.fetch = shimmed as typeof window.fetch;
  }, { failureMode: mode });

  return async () => {
    const shimHits = await page.evaluate(
      () =>
        (window as unknown as Record<string, { hits: number }>).__g3fixPlaceShim?.hits ?? -1,
    );
    return { routeHits, shimHits, mode };
  };
}

export const ORIGIN_INPUT_LABEL = "旅行起点";

export function originCombobox(page: Page) {
  return page.getByRole("combobox", { name: ORIGIN_INPUT_LABEL });
}

export function originListbox(page: Page) {
  return page.getByRole("listbox", { name: `${ORIGIN_INPUT_LABEL}建议` });
}

export async function gotoNewTrip(page: Page): Promise<void> {
  await page.goto("/w/roamlog-crew/trips/new", { waitUntil: "domcontentloaded" });
  // Third environment gate: the real create form must be interactive.
  await page.getByRole("button", { name: "创建旅行" }).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("combobox", { name: ORIGIN_INPUT_LABEL }).waitFor({ state: "visible" });
}

/** "2026年11月18日" -> "2026-11-18" */
export function parseChineseDate(text: string): string {
  const match = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(text);
  if (!match) throw new Error(`no calendar date in "${text}"`);
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(
    next.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function inclusiveDays(startIso: string, endIso: string): number {
  const toTs = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toTs(endIso) - toTs(startIso)) / 86_400_000) + 1;
}

export async function readPickerDate(page: Page, pickerId: string): Promise<string> {
  const trigger = page.locator(`#${pickerId}`);
  await trigger.waitFor({ state: "visible" });
  return parseChineseDate(await trigger.innerText());
}

/** Opens a DatePicker popover and navigates to the month holding `targetIso`. */
export async function openCalendarDate(
  page: Page,
  pickerId: string,
  gridLabel: string,
  targetIso: string,
) {
  await page.locator(`#${pickerId}`).click();
  const grid = page.getByRole("grid", { name: gridLabel });
  await grid.waitFor({ state: "visible" });

  const [targetYear, targetMonth] = targetIso.split("-").map(Number);
  const monthLabel = page.locator('[aria-live="polite"]').filter({ hasText: /^\d{4}年\d{1,2}月$/ });
  for (let attempt = 0; attempt < 14; attempt += 1) {
    if ((await page.locator(`#date-picker-${gridLabel}-${targetIso}`).count()) > 0) break;
    const current = /(\d{4})年(\d{1,2})月/.exec(await monthLabel.first().innerText());
    if (!current) throw new Error("cannot read the visible month");
    const currentValue = Number(current[1]) * 12 + Number(current[2]);
    const targetValue = targetYear * 12 + targetMonth;
    await page
      .getByRole("button", { name: currentValue < targetValue ? "下个月" : "上个月" })
      .click();
  }

  const cell = page.locator(`#date-picker-${gridLabel}-${targetIso}`);
  await cell.waitFor({ state: "visible" });
  return cell;
}

/** Opens a DatePicker popover and clicks `targetIso`, navigating months as needed. */
export async function pickCalendarDate(
  page: Page,
  pickerId: string,
  gridLabel: string,
  targetIso: string,
): Promise<void> {
  const cell = await openCalendarDate(page, pickerId, gridLabel, targetIso);
  const ariaDisabled = await cell.getAttribute("aria-disabled");
  if (ariaDisabled === "true") {
    throw new Error(`date ${targetIso} is aria-disabled inside ${gridLabel}`);
  }
  await cell.click();
  await page.getByRole("grid", { name: gridLabel }).waitFor({ state: "hidden" });
}

export async function readDurationLabel(page: Page): Promise<string> {
  const text = await page.getByText(/共 \d+ 天 · \d+ 晚/).first().innerText();
  return text.trim();
}

/** Centres the origin field so the open listbox is inside the viewport screenshot. */
export async function focusOriginField(page: Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelector('[role="combobox"][aria-label="旅行起点"]')
      ?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(200);
}

export function writeLog(name: string, payload: unknown): string {
  const dir = path.resolve(".audit/evidence/g3-fix/logs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

export const SHOTS = ".audit/evidence/g3-fix/shots";