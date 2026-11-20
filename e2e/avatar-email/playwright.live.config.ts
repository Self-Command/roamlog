import { defineConfig } from "@playwright/test";

/**
 * Runs the avatar/email acceptance suite against the long-lived local stack:
 * Web on 3000 and API on 4000. Unlike `playwright.avatar-email.config.ts`, this
 * config does not start or replace either server, so the run proves the current
 * source tree works after an API restart.
 */
const WEB_URL = process.env.ROAMLOG_ACCEPTANCE_WEB_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  timeout: 180_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "../../test-results/avatar-email/playwright-live",
  use: {
    baseURL: WEB_URL,
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
