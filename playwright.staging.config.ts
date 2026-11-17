import { defineConfig } from "@playwright/test";

import {
  STAGING_ADMIN_URL,
  STAGING_API_URL,
  STAGING_AUTH_SECRET,
  STAGING_DATABASE_URL,
  STAGING_EVIDENCE_ROOT,
  STAGING_FIXTURE_FILE,
  STAGING_REDIS_PREFIX,
  STAGING_REDIS_URL,
  STAGING_S3_ACCESS_KEY,
  STAGING_S3_BUCKET,
  STAGING_S3_ENDPOINT,
  STAGING_S3_SECRET_KEY,
  STAGING_SMTP_HOST,
  STAGING_SMTP_PORT,
  STAGING_WEB_URL,
} from "./e2e/staging/env";

process.env.DATABASE_URL = STAGING_DATABASE_URL;
process.env.ROAMLOG_STAGING_FIXTURE_FILE = STAGING_FIXTURE_FILE;
process.env.ROAMLOG_STAGING_DATABASE_URL = STAGING_DATABASE_URL;
process.env.ROAMLOG_STAGING_AUTH_SECRET = STAGING_AUTH_SECRET;

const apiEnvironment = {
  NODE_ENV: "test",
  LOG_LEVEL: "warn",
  API_PORT: "4100",
  API_URL: STAGING_API_URL,
  APP_URL: STAGING_WEB_URL,
  ADMIN_URL: STAGING_ADMIN_URL,
  CORS_ORIGINS: `${STAGING_WEB_URL},${STAGING_ADMIN_URL}`,
  DATABASE_URL: STAGING_DATABASE_URL,
  REDIS_URL: STAGING_REDIS_URL,
  REDIS_PREFIX: STAGING_REDIS_PREFIX,
  TRUST_PROXY: "true",
  BETTER_AUTH_SECRET: STAGING_AUTH_SECRET,
  BETTER_AUTH_URL: STAGING_API_URL,
  ADMIN_2FA_ENFORCED: "true",
  S3_ENDPOINT: STAGING_S3_ENDPOINT,
  S3_BUCKET: STAGING_S3_BUCKET,
  S3_ACCESS_KEY: STAGING_S3_ACCESS_KEY,
  S3_SECRET_KEY: STAGING_S3_SECRET_KEY,
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: "true",
  SMTP_HOST: STAGING_SMTP_HOST,
  SMTP_PORT: STAGING_SMTP_PORT,
  EMAIL_FROM: "Roamlog <staging-release-gate@roamlog.test>",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e/staging",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/staging-release" }],
  ],
  outputDir: `${STAGING_EVIDENCE_ROOT}/playwright`,
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    {
      name: "staging-setup",
      testMatch: /staging\.setup\.ts/,
      teardown: "staging-teardown",
    },
    {
      name: "admin-staging",
      testMatch: /admin-operations\.spec\.ts/,
      dependencies: ["staging-setup"],
      use: { baseURL: STAGING_ADMIN_URL },
    },
    {
      name: "staging",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /admin-operations\.spec\.ts/,
      dependencies: ["staging-setup"],
      use: { baseURL: STAGING_WEB_URL },
    },
    {
      name: "staging-teardown",
      testMatch: /staging\.teardown\.ts/,
    },
  ],
  webServer: [
    {
      command:
        "pnpm --filter @roamlog/db exec prisma migrate deploy && pnpm --filter @roamlog/api exec tsx src/main.ts",
      url: `${STAGING_API_URL}/v1/health`,
      env: apiEnvironment,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command:
        "pnpm exec tsx e2e/live-support/prepare-next-runtime.ts web && pnpm --filter @roamlog/web exec next dev ../../.e2e-live/runtime/web --hostname 127.0.0.1 --port 3100",
      url: `${STAGING_WEB_URL}/login`,
      env: {
        NEXT_PUBLIC_DATA_MODE: "api",
        API_URL: STAGING_API_URL,
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
      url: `${STAGING_ADMIN_URL}/login`,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_ADMIN_DATA_MODE: "api",
        API_URL: STAGING_API_URL,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
