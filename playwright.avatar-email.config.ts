import { defineConfig } from "@playwright/test";

/**
 * Acceptance for `AVATAR_EMAIL_FIX`.
 *
 * Runs against an isolated pair of servers (second API on 4173, second web on
 * 3200, both from the current source tree) so the long-running dev API on 4000
 * never has to be restarted. Redis, the BullMQ worker, MinIO (the local S3
 * stub) and Mailpit are expected to be up — see `e2e/avatar-email/README.md`.
 *
 * `node node_modules/@playwright/test/cli.js test e2e/avatar-email --config=playwright.avatar-email.config.ts`
 */
const API_URL = "http://127.0.0.1:4173";
const WEB_URL = "http://127.0.0.1:3200";

export default defineConfig({
  testDir: "./e2e/avatar-email",
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/avatar-email/playwright",
  use: {
    baseURL: WEB_URL,
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "pnpm --filter @roamlog/api exec tsx src/main.ts",
      cwd: "apps/api",
      url: `${API_URL}/v1/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        NODE_ENV: "development",
        LOG_LEVEL: "warn",
        API_PORT: "4173",
        API_URL,
        APP_URL: WEB_URL,
        ADMIN_URL: "http://127.0.0.1:3101",
        CORS_ORIGINS: `${WEB_URL},http://localhost:3200`,
        DATABASE_URL:
          process.env.ROAMLOG_ACCEPTANCE_DATABASE_URL ??
          "postgresql://roamlog:roamlog@127.0.0.1:55444/roamlog_local?schema=public",
        REDIS_URL: "redis://127.0.0.1:6379",
        BETTER_AUTH_SECRET: "roamlog-avatar-email-acceptance-secret-32b",
        BETTER_AUTH_URL: API_URL,
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1025",
        DEMO_SEED_ENABLED: "false",
      },
    },
    {
      command:
        "pnpm exec tsx e2e/live-support/prepare-next-runtime.ts web && pnpm --filter @roamlog/web exec next dev ../../.e2e-live/runtime/web --hostname 127.0.0.1 --port 3200",
      url: `${WEB_URL}/login`,
      reuseExistingServer: true,
      timeout: 240_000,
      env: {
        NEXT_PUBLIC_DATA_MODE: "api",
        API_URL,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});