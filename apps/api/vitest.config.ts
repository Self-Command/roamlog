import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "test/**/*.e2e-spec.ts",
      "src/**/*.spec.ts",
      // AI streaming e2e spec lives next to its module (required path
      // `src/modules/ai/__tests__/stream.e2e-spec.ts`) instead of test/.
      "src/**/*.e2e-spec.ts",
    ],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      API_PORT: "4000",
      APP_URL: "http://localhost:3000",
      ADMIN_URL: "http://localhost:3001",
      API_URL: "http://localhost:4000",
      CORS_ORIGINS: "http://localhost:3000,http://localhost:3001",
      DATABASE_URL: "postgresql://roamlog:roamlog@localhost:5432/roamlog?schema=api_test",
      REDIS_URL: "redis://localhost:6379",
      REDIS_PREFIX: "roamlog:test",
      BETTER_AUTH_SECRET: "test-only-secret-that-is-at-least-32-bytes",
      S3_ENDPOINT: "http://localhost:9000",
      S3_BUCKET: "roamlog-test",
      S3_ACCESS_KEY: "test-access-key",
      S3_SECRET_KEY: "test-secret-key",
      S3_REGION: "us-east-1",
      S3_FORCE_PATH_STYLE: "true",
      EXPORT_SIGNED_URL_TTL: "900",
      CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    },
  },
});
