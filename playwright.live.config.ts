import { defineConfig } from "@playwright/test";

import {
  LIVE_ADMIN_URL,
  LIVE_API_URL,
  LIVE_AUTH_SECRET,
  LIVE_DATABASE_URL,
  LIVE_FIXTURE_FILE,
  LIVE_WEB_URL,
} from "./e2e/live-support/env";

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
  REDIS_PREFIX: "roamlog-wave5-live-e2e",
  BETTER_AUTH_SECRET: LIVE_AUTH_SECRET,
  BETTER_AUTH_URL: LIVE_API_URL,
  ADMIN_2FA_ENFORCED: "true",
  S3_ENDPOINT: "http://127.0.0.1:49000",
  S3_BUCKET: "roamlog-wave5-live-e2e",
  S3_ACCESS_KEY: "wave5-live-e2e",
  S3_SECRET_KEY: "wave5-live-e2e-secret",
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: "true",
  EMAIL_FROM: "Roamlog <wave5-live-e2e@roamlog.test>",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e/live",
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/live" }]],
  outputDir: "test-results/live/playwright",
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "live-setup",
      testMatch: /live\.setup\.ts/,
      teardown: "live-teardown",
    },
    {
      name: "web-live",
      testMatch: /web\.spec\.ts/,
      dependencies: ["live-setup"],
      use: {
        baseURL: LIVE_WEB_URL,
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "admin-live",
      testMatch: /admin\.spec\.ts/,
      dependencies: ["live-setup"],
      use: {
        baseURL: LIVE_ADMIN_URL,
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "api-live",
      testMatch: /api\.spec\.ts/,
      dependencies: ["live-setup"],
      use: {
        baseURL: LIVE_API_URL,
      },
    },
    {
      name: "live-teardown",
      testMatch: /live\.teardown\.ts/,
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
    {
      command:
        "pnpm exec tsx e2e/live-support/prepare-next-runtime.ts admin && pnpm --filter @roamlog/admin exec next dev ../../.e2e-live/runtime/admin --hostname 127.0.0.1 --port 3101",
      url: `${LIVE_ADMIN_URL}/login`,
      env: {
        NEXT_PUBLIC_ADMIN_DATA_MODE: "api",
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
