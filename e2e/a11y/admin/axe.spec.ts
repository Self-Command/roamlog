import { expect, test } from "@playwright/test";

import { ADMIN_ROUTES, assertNoSeriousAxeViolations, gotoAndWait, setAdminRole } from "../support";

for (const route of ADMIN_ROUTES) {
  test(`@axe admin ${route.name} has no serious or critical findings`, async ({
    page,
  }, testInfo) => {
    await setAdminRole(page);
    await gotoAndWait(page, route);
    await assertNoSeriousAxeViolations(page, `admin ${route.name}`, testInfo);
    await expect(page.locator("body")).toBeVisible();
  });
}
