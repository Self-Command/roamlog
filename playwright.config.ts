import { defineConfig } from "@playwright/test";

const webBaseURL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const adminBaseURL = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";
const apiBaseURL = process.env.E2E_API_URL ?? "http://localhost:4000";
const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "web",
      testMatch: /web\/.*\.spec\.ts/,
      use: {
        baseURL: webBaseURL,
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "admin",
      testMatch: /admin\/.*\.spec\.ts/,
      use: {
        baseURL: adminBaseURL,
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "api",
      testMatch: /api\/.*\.spec\.ts/,
      use: {
        baseURL: apiBaseURL,
      },
    },
  ],
  webServer: [
    ...(process.env.E2E_SKIP_WEB_SERVER === "1"
      ? []
      : [
          {
            command: "pnpm --filter @roamlog/web dev",
            url: webBaseURL,
            reuseExistingServer,
            timeout: 120_000,
          },
        ]),
    ...(process.env.E2E_SKIP_ADMIN_SERVER === "1"
      ? []
      : [
          {
            command: "pnpm --filter @roamlog/admin dev",
            url: adminBaseURL,
            reuseExistingServer,
            timeout: 120_000,
          },
        ]),
    ...(process.env.E2E_START_API === "1"
      ? [
          {
            command: "pnpm --filter @roamlog/api dev",
            url: `${apiBaseURL}/v1/health`,
            reuseExistingServer,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
