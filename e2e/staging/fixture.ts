import { readFileSync } from "node:fs";

import { STAGING_FIXTURE_FILE, type StagingFixture } from "./env";

export function loadStagingFixture(): StagingFixture {
  return JSON.parse(readFileSync(STAGING_FIXTURE_FILE, "utf8")) as StagingFixture;
}
