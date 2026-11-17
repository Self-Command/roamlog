import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

export const WORKSPACE_PATH = "/w/roamlog-crew";
export const KYOTO_TRIP_ID = "019a7e3a-2b40-7c1d-8a5f-000000000011";
export const KYOTO_TRIP_PATH = `${WORKSPACE_PATH}/trips/${KYOTO_TRIP_ID}`;
export const ADMIN_ROLE_STORAGE_KEY = "roamlog.admin.role-preview.v1";

export async function setAdminRole(page: Page, role: string): Promise<void> {
  await page.addInitScript(
    ([storageKey, storedRole]) => {
      window.localStorage.setItem(storageKey, storedRole);
    },
    [ADMIN_ROLE_STORAGE_KEY, role],
  );
}

export async function screenshot(page: Page, name: string): Promise<void> {
  const directory = path.join(process.cwd(), "e2e", "screenshots");
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, name),
    fullPage: true,
    animations: "disabled",
  });
}

export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));

  expect
    .soft(metrics.documentWidth, `${label}: document horizontal overflow`)
    .toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect
    .soft(metrics.bodyWidth, `${label}: body horizontal overflow`)
    .toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

export async function setRangeValue(page: Page, label: string, value: number): Promise<void> {
  const slider = page.getByRole("slider", { name: label });
  await expect(slider).toBeEnabled();
  const currentValue = Number(await slider.inputValue());
  const steps = Math.round((value - currentValue) / 5);
  await slider.focus();
  for (let index = 0; index < Math.abs(steps); index += 1) {
    await slider.press(steps > 0 ? "ArrowRight" : "ArrowLeft");
  }
  await expect(slider).toHaveValue(String(value));
}
