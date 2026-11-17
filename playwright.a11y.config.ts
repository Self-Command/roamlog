import { defineConfig } from "@playwright/test";

const webBaseURL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const adminBaseURL = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";
const reuseExistingServer = true;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 2,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: "test-results/w5-a11y-results.json",
      },
    ],
  ],
  outputDir: "test-results/w5-a11y-perf",
  use: {
    browserName: "chromium",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "web-a11y",
      testMatch: /a11y\/web\/.*\.spec\.ts/,
      use: {
        baseURL: webBaseURL,
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "admin-a11y",
      testMatch: /a11y\/admin\/.*\.spec\.ts/,
      use: {
        baseURL: adminBaseURL,
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "web-visual",
      testMatch: /visual\/web\/.*\.spec\.ts/,
      use: {
        baseURL: webBaseURL,
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "admin-visual",
      testMatch: /visual\/admin\/.*\.spec\.ts/,
      use: {
        baseURL: adminBaseURL,
        viewport: { width: 1440, height: 1000 },
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
  ],
});
