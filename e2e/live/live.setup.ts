import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { runLiveFixtureScript } from "../live-support/fixture";

test("provision isolated live API accounts", async () => {
  const output = runLiveFixtureScript();
  expect(output).toContain('"webUserId"');

  const fixture = JSON.parse(
    readFileSync(process.env.ROAMLOG_LIVE_FIXTURE_FILE ?? ".e2e-live/fixture.json", "utf8"),
  ) as { web: { email: string }; admin: { totpSecret: string } };
  expect(fixture.web.email).toMatch(/^wave5-e2e-/);
  expect(fixture.admin.totpSecret).toMatch(/^[A-Z2-7]+=*$/);
});
