import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Journey 2 — the searchable combobox's five states.
 *
 * Mock mode ships no `/v1/places/search` handler at all. MSW lives in a service
 * worker, so `page.route()` cannot see its bypassed requests (verified: the
 * interception never fired). Each state below is therefore produced by patching
 * `window.fetch` from an init script *before* the app boots — the component,
 * debounce, keyboard handling and ARIA are the real ones.
 */

const WORKSPACE = "roamlog-crew";
const NEW_TRIP = `/w/${WORKSPACE}/trips/new`;
const SHOTS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/shots");

const PLACE = {
  provider: "photon",
  providerPlaceId: "photon:node/700001",
  name: "京都",
  country: "日本",
  countryCode: "JP",
  lat: 35.0116,
  lng: 135.7681,
  timeZone: "Asia/Tokyo",
  type: "city",
};

interface FakeSearch {
  status?: number;
  degraded?: boolean;
  items?: unknown[];
  delayMs?: number;
}

async function installSearchFake(page: Page, config: FakeSearch) {
  await page.addInitScript((cfg: FakeSearch) => {
    const original = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (!url.includes("/v1/places/search")) return original(input as RequestInfo, init);
      if (cfg.delayMs) await new Promise((resolve) => setTimeout(resolve, cfg.delayMs));
      const status = cfg.status ?? 200;
      if (status >= 400) {
        return new Response(
          JSON.stringify({ title: "Upstream failure", status, detail: "place provider down" }),
          { status, headers: { "content-type": "application/problem+json" } },
        );
      }
      return new Response(
        JSON.stringify({
          items: cfg.items ?? [],
          provider: "photon",
          degraded: Boolean(cfg.degraded),
          cached: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
  }, config);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, name), animations: "disabled" });
}

async function openCreate(page: Page) {
  await page.goto(NEW_TRIP);
  await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible({ timeout: 30_000 });
  return page.locator("#trip-origin");
}

test("combobox: loading state keeps the ARIA contract intact", async ({ page }) => {
  await installSearchFake(page, { items: [PLACE], delayMs: 4000 });
  const origin = await openCreate(page);

  await origin.click();
  await origin.fill("京都");
  await expect(origin).toHaveAttribute("role", "combobox");
  await expect(origin).toHaveAttribute("aria-expanded", "true");
  await expect(origin).toHaveAttribute("aria-autocomplete", "list");
  await expect(origin).toHaveAttribute("aria-haspopup", "listbox");
  await expect(origin).toHaveAttribute("aria-controls", /listbox/);
  await expect(page.getByRole("listbox").getByRole("status")).toContainText("正在搜索…");
  await shot(page, "combobox-loading.png");
});

test("combobox: empty result falls back to the manual row", async ({ page }) => {
  await installSearchFake(page, { items: [] });
  const origin = await openCreate(page);

  await origin.click();
  await origin.fill("京都");
  const listbox = page.getByRole("listbox");
  await expect(listbox.getByRole("option")).toHaveCount(1);
  await expect(listbox.getByRole("option")).toContainText("使用「京都」作为起点");
  await expect(origin).toHaveAttribute("aria-activedescendant", /manual/);
  await shot(page, "combobox-empty.png");
});

test("combobox: error state is announced and offers retry", async ({ page }) => {
  await installSearchFake(page, { status: 500 });
  const origin = await openCreate(page);

  await origin.click();
  await origin.fill("京都");
  const listbox = page.getByRole("listbox");
  await expect(listbox.getByRole("status")).toBeVisible();
  await expect(listbox.getByRole("status")).toContainText(/status 500|搜索失败/);
  await expect(listbox.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(origin).toHaveAttribute("aria-expanded", "true");
  await shot(page, "combobox-error.png");
});

test("combobox: degraded provider shows the degraded notice above results", async ({ page }) => {
  await installSearchFake(page, { items: [PLACE], degraded: true });
  const origin = await openCreate(page);

  await origin.click();
  await origin.fill("京都");
  const listbox = page.getByRole("listbox");
  await expect(listbox.getByText("搜索服务暂时降级，可手动填写。")).toBeVisible();
  await expect(listbox.getByRole("option", { name: /京都/ }).first()).toBeVisible();
  await expect(origin).toHaveAttribute("aria-activedescendant", /listbox-/);
  await shot(page, "combobox-degraded.png");
});

test("combobox: manual degradation row sets a coordinate-less origin", async ({ page }) => {
  await installSearchFake(page, { items: [PLACE], degraded: true });
  const origin = await openCreate(page);

  await origin.click();
  await origin.fill("京都站附近");
  const manual = page
    .getByRole("listbox")
    .getByRole("option", { name: /使用「京都站附近」作为起点/ });
  await expect(manual).toBeVisible();
  await shot(page, "combobox-manual.png");
  await manual.click();

  await expect(page.getByText("手动地点", { exact: true })).toBeVisible();
  await expect(page.getByText("坐标为空")).toBeVisible();
  await expect(origin).toHaveValue("京都站附近");
  await expect(origin).toHaveAttribute("aria-expanded", "false");
});