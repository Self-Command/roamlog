import { test } from "@playwright/test";

import { runLiveFixtureScript } from "../live-support/fixture";

/** G3 teardown: removes the live fixture accounts/workspaces it created. */
test("clean up G3 live fixture", async () => {
  runLiveFixtureScript(["--cleanup"]);
});