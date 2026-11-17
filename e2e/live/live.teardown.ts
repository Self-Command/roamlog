import { expect, test } from "@playwright/test";

import { runLiveFixtureScript } from "../live-support/fixture";

test("clean isolated live API accounts", async () => {
  const output = runLiveFixtureScript(["--cleanup"]);
  expect(output).toContain("cleaned");
});
