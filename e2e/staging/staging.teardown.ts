import { rmSync } from "node:fs";

import { test } from "@playwright/test";

import { STAGING_FIXTURE_FILE } from "./env";
import { runStagingFixtureScript } from "./request";

test("clean staging fixture database", async () => {
  runStagingFixtureScript(["--cleanup"]);
  rmSync(STAGING_FIXTURE_FILE, { force: true });
});
