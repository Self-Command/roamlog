import { defineConfig } from "@playwright/test";

import { LIVE_ADMIN_URL, LIVE_API_URL, LIVE_AUTH_SECRET, LIVE_FIXTURE_FILE, LIVE_WEB_URL } from "./e2e/live-support/env";

/**
 * G3 API journeys on the repository's **live** base (same orchestration as
 * `playwright.live.config.ts`, minus admin).
 *
 * Only the G3-owned database/ports are used:
 *   DATABASE_URL override → 55443 / roamlog_g3 (G3 sandbox, not the root agent's 55442)
 *   api :4100, web :3100 — both owned by this run.
 */
process.env.ROAMLOG_LIVE_DATABASE_URL ??=
  "postgresql://postgres@127.0.0.1:55443/roamlog_g3?schema=public";

const LIVE_DATABASE_URL = process.env.ROAMLOG_LIVE_DATABASE_URL;

process.env.DATABASE_URL = LIVE_DATABASE_URL;
process.env.ROAMLOG_LIVE_FIXTURE_FILE = LIVE_FIXTURE_FILE;
process.env.ROAMLOG_LIVE_AUTH_SECRET = LIVE_AUTH_SECRET;

const apiEnvironment = {
  NODE_ENV: "test",
  LOG_LEVEL: "warn",
  API_PORT: "4100",
  API_URL: LIVE_API_URL,
  APP_URL: LIVE_WEB_URL,
  ADMIN_URL: LIVE_ADMIN_URL,
  CORS_ORIGINS: `${LIVE_WEB_URL},${LIVE_ADMIN_URL}`,
  DATABASE_URL: LIVE_DATABASE_URL,
  REDIS_URL: "redis://127.0.0.1:46379",
  REDIS_PREFIX: "roamlog-g3-live-e2e",
  BETTER_AUTH_SECRET: LIVE_AUTH_SECRET,
  BETTER_AUTH_URL: LIVE_API_URL,
  ADMIN_2FA_ENFORCED: "true",
  S3_ENDPOINT: "http://127.0.0.1:49000",
  S3_BUCKET: "roamlog-g3-live-e2e",
  S3_ACCESS_KEY: "g3-live-e2e",
  S3_SECRET_KEY: "g3-live-e2e-secret",
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: "true",
  EMAIL_FROM: "Roamlog <g3-live-e2e@roamlog.test>",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e/g3-api",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: ".audit/evidence/g3-api/playwright-report" }]],
  outputDir: ".audit/evidence/g3-api/test-results",
  use: {
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "g3-setup",
      testMatch: /g3\.setup\.ts/,
      teardown: "g3-teardown",
    },
    {
      name: "g3-journeys",
      testMatch: /journeys\.spec\.ts/,
      dependencies: ["g3-setup"],
      use: {
        baseURL: LIVE_WEB_URL,
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "g3-teardown",
      testMatch: /g3\.teardown\.ts/,
    },
  ],
  webServer: [
    {
      command:
        "pnpm --filter @roamlog/db exec prisma migrate deploy && pnpm --filter @roamlog/api exec tsx ../../e2e/live-support/start-api.ts",
      url: `${LIVE_API_URL}/v1/health`,
      env: apiEnvironment,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command:
        "pnpm exec tsx e2e/live-support/prepare-next-runtime.ts web && pnpm --filter @roamlog/web exec next dev ../../.e2e-live/runtime/web --hostname 127.0.0.1 --port 3100",
      url: `${LIVE_WEB_URL}/login`,
      env: {
        NEXT_PUBLIC_DATA_MODE: "api",
        API_URL: LIVE_API_URL,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});