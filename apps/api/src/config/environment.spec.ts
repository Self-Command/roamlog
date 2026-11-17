import { describe, expect, it } from "vitest";

import { validateEnvironment } from "./environment.js";

const baseEnvironment = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  APP_URL: "http://localhost:3000",
  ADMIN_URL: "http://localhost:3001",
  API_URL: "http://localhost:4000",
  CORS_ORIGINS: "http://localhost:3000,http://localhost:3001",
  DATABASE_URL: "postgresql://roamlog:roamlog@localhost:5432/roamlog",
  REDIS_URL: "redis://localhost:6379",
  REDIS_PREFIX: "roamlog:test",
  BETTER_AUTH_SECRET: "test-only-secret-that-is-at-least-32-bytes",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "roamlog-test",
  S3_ACCESS_KEY: "test-access-key",
  S3_SECRET_KEY: "test-secret-key",
} as const;

describe("validateEnvironment", () => {
  it("normalizes CORS origins and preserves variables owned by later modules", () => {
    const result = validateEnvironment({
      ...baseEnvironment,
      CORS_ORIGINS: "http://localhost:3000/ , http://localhost:3001",
      RESEND_API_KEY: "re_test_preserved",
    });

    expect(result.CORS_ORIGINS).toEqual(["http://localhost:3000", "http://localhost:3001"]);
    expect(result).toMatchObject({
      RESEND_API_KEY: "re_test_preserved",
    });
  });

  it("rejects local and insecure production configuration", () => {
    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        NODE_ENV: "production",
        APP_URL: "http://app.roamlog.app",
        ADMIN_URL: "http://admin.roamlog.app",
        API_URL: "http://api.roamlog.app",
        CORS_ORIGINS: "http://app.roamlog.app",
      }),
    ).toThrow(/must use https|production CORS origins must use https/);
  });
});
