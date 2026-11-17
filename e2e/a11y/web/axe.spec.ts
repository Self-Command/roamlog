import { expect, test } from "@playwright/test";

import { assertNoSeriousAxeViolations, gotoAndWait, WEB_ROUTES } from "../support";

for (const route of WEB_ROUTES) {
  test(`@axe web ${route.name} has no serious or critical findings`, async ({ page }, testInfo) => {
    await gotoAndWait(page, route);
    await assertNoSeriousAxeViolations(page, `web ${route.name}`, testInfo);
    await expect(page.locator("body")).toBeVisible();
  });
}
