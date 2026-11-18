import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** Journey 1 — full-field trip creation in mock mode (real browser, real clicks). */

const WORKSPACE = "roamlog-crew";
const NEW_TRIP = `/w/${WORKSPACE}/trips/new`;
const SHOTS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/shots");
const LOGS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/logs");

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, name), animations: "disabled" });
}

function log(name: string, payload: unknown) {
  fs.mkdirSync(LOGS, { recursive: true });
  fs.writeFileSync(path.join(LOGS, name), JSON.stringify(payload, null, 2));
}

async function openCreate(page: Page) {
  await page.goto(NEW_TRIP);
  await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible({ timeout: 30_000 });
}

/**
 * Clicks an enabled calendar day. The end date has to be moved first: the start
 * picker's `max` is the current end date, which defaults to today.
 */
async function pickDate(page: Page, trigger: string, iso: string) {
  await page.locator(trigger).click();
  const grid = page.getByRole("grid").first();
  await expect(grid).toBeVisible();
  const day = String(Number(iso.slice(8)));
  await grid
    .locator('[role="gridcell"]:not([aria-hidden="true"]):not([aria-disabled="true"])')
    .filter({ hasText: new RegExp(`^${day}$`) })
    .first()
    .click();
  await expect(grid).toBeHidden();
}

test("create: date fields are calendar pickers with no raw date input", async ({ page }) => {
  await openCreate(page);

  // A date field implemented as a bare text box is explicitly not acceptable.
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.locator("#trip-start-date")).toHaveJSProperty("tagName", "BUTTON");
  await expect(page.locator("#trip-end-date")).toHaveJSProperty("tagName", "BUTTON");
  await expect(page.locator("#trip-start-date")).toHaveAttribute("aria-haspopup", "dialog");
  // The form defaults both dates to today, so the trigger shows a human date.
  await expect(page.locator("#trip-start-date")).toHaveText(/^\d{4}年\d{1,2}月\d{1,2}日$/);
  await expect(page.locator("#trip-start-date")).not.toHaveAttribute("readonly", "true");

  // Opening the trigger must reveal a real calendar grid, and the grid owns focus.
  await page.locator("#trip-start-date").click();
  const grid = page.getByRole("grid").first();
  await expect(grid).toBeVisible();
  await expect(grid).toHaveAttribute("aria-activedescendant", /date-picker-.+-\d{4}-\d{2}-\d{2}$/);
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute("role") ?? null),
    "opening the popover should move focus into the grid",
  ).toBe("grid");

  await page.keyboard.press("Escape");
  await expect(grid).toBeHidden();
});

test("create: calendar selection drives the derived duration", async ({ page }) => {
  await openCreate(page);

  await pickDate(page, "#trip-end-date", "2026-11-24");
  await pickDate(page, "#trip-start-date", "2026-11-20");

  await expect(page.locator("#trip-start-date")).toHaveText("2026年11月20日");
  await expect(page.locator("#trip-end-date")).toHaveText("2026年11月24日");
  await expect(page.getByText("共 5 天 · 4 晚").first()).toBeVisible();
  await expect(page.getByText(/2026年11月20日.*2026年11月24日/).first()).toBeVisible();
});

test("create: destinations keep order, can be reordered and removed, and dedupe", async ({
  page,
}) => {
  await openCreate(page);

  const manual = page.locator("#trip-destination-manual");
  const addButton = page.getByRole("button", { name: "添加", exact: true });
  const list = page.getByRole("list", { name: "已添加的目的地" });

  for (const city of ["金泽", "白川乡"]) {
    await manual.fill(city);
    await addButton.click();
  }
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("金泽");
  await expect(list).toContainText("白川乡");

  // Dedupe (case-insensitive) is enforced with a visible error on the field.
  await manual.fill("金泽");
  await addButton.click();
  await expect(page.getByText("「金泽」已在目的地列表中")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(2);

  // Reorder: move 白川乡 up, then remove 金泽.
  await page.getByRole("button", { name: "上移「白川乡」" }).click();
  await expect(list.getByRole("listitem").first()).toContainText("白川乡");

  await page.getByRole("button", { name: "移除「金泽」" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem").first()).toContainText("白川乡");

  // Restore the intended order for the pre-submit screenshots.
  await manual.fill("金泽");
  await addButton.click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
});

test("create: budget, tags dedupe and guests are editable", async ({ page }) => {
  await openCreate(page);

  // Budget amount + searchable currency combobox.
  await page.locator("#trip-budget-amount").fill("18800");
  await page.locator("#trip-budget-currency").fill("CNY");
  const currencyOption = page.getByRole("listbox").getByRole("option", { name: /^CNY/ }).first();
  await expect(currencyOption).toBeVisible();
  await currencyOption.click();
  await expect(page.locator("#trip-budget-currency")).toHaveValue("CNY");
  await expect(page.getByText(/预览 ¥18,800/)).toBeVisible();

  // Tags: add two, third duplicate is rejected.
  const tags = page.locator("#trip-tags");
  await tags.fill("城市漫步");
  await tags.press("Enter");
  await tags.fill("咖啡");
  await tags.press("Enter");
  await expect(page.getByRole("button", { name: "移除标签「城市漫步」" })).toBeVisible();
  await expect(page.getByRole("button", { name: "移除标签「咖啡」" })).toBeVisible();

  await tags.fill("城市漫步");
  await tags.press("Enter");
  await expect(page.getByText("「城市漫步」已存在，不能重复添加")).toBeVisible();
  await expect(page.getByRole("button", { name: /^移除标签/ })).toHaveCount(2);

  // Guests: one row.
  const guests = page.locator("#trip-guests");
  await guests.fill("Mira Chen");
  await guests.press("Enter");
  await expect(page.getByRole("button", { name: "移除同行人「Mira Chen」" })).toBeVisible();
});

async function fillFullForm(page: Page) {
  await page.locator("#trip-title").fill("G3 验收：京都七日");
  await page.locator("#trip-summary").fill("QA 在真实浏览器里逐字段填写这趟旅行。");
  await pickDate(page, "#trip-end-date", "2026-11-24");
  await pickDate(page, "#trip-start-date", "2026-11-20");

  const manual = page.locator("#trip-destination-manual");
  const addButton = page.getByRole("button", { name: "添加", exact: true });
  for (const city of ["金泽", "白川乡"]) {
    await manual.fill(city);
    await addButton.click();
  }

  await page.locator("#trip-budget-amount").fill("18800");
  await page.locator("#trip-budget-currency").fill("CNY");
  await page.getByRole("listbox").getByRole("option", { name: /^CNY/ }).first().click();

  await page.locator("#trip-tags").fill("城市漫步");
  await page.locator("#trip-tags").press("Enter");
  await page.locator("#trip-tags").fill("咖啡");
  await page.locator("#trip-tags").press("Enter");
  await page.locator("#trip-guests").fill("Mira Chen");
  await page.locator("#trip-guests").press("Enter");

  await expect(page.getByText("共 5 天 · 4 晚").first()).toBeVisible();
}

test("create: full form filled, screenshots at 1440 and 390 before submit", async ({ page }) => {
  await openCreate(page);
  await fillFullForm(page);

  await shot(page, "create-form-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "create-form-390.png");
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("create: origin search in mock mode offers a manual fallback", async ({ page }) => {
  await openCreate(page);

  const origin = page.locator("#trip-origin");
  const network: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/v1/places/search")) network.push(response.status().toString());
  });

  await origin.click();
  await origin.fill("京都");
  await expect(origin).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(2500); // debounce (250ms) + mocked failure
  await shot(page, "combobox-real-mock.png");

  const listbox = page.getByRole("listbox");
  log("origin-search-mock.json", {
    network,
    listboxText: await listbox.innerText().catch(() => null),
    options: await listbox.getByRole("option").count(),
    expanded: await origin.getAttribute("aria-expanded"),
    originCount: await page.getByText("手动地点", { exact: true }).count(),
  });

  // Requirement: when search is unavailable the form must still allow a manual origin.
  await expect(listbox.getByRole("option", { name: /使用「京都」作为起点/ })).toBeVisible();
});

test("create: submit navigates to the new trip detail", async ({ page }) => {
  await openCreate(page);
  await page.locator("#trip-title").fill("G3 提交验收");
  await pickDate(page, "#trip-end-date", "2026-11-22");
  await pickDate(page, "#trip-start-date", "2026-11-20");
  await page.getByRole("button", { name: /创建旅行/ }).click();

  await page.waitForTimeout(4000);
  const observed = {
    url: page.url(),
    alerts: await page.locator('[role="alert"]').allInnerTexts(),
    status: await page.locator('[role="status"]').allInnerTexts(),
  };
  log("create-submit-observed.json", observed);
  console.log("CREATE SUBMIT OBSERVED:", JSON.stringify(observed));
  await shot(page, "create-submit-result.png");

  await expect(page).toHaveURL(new RegExp(`/w/${WORKSPACE}/trips/[0-9a-f-]{36}$`), {
    timeout: 15_000,
  });
});