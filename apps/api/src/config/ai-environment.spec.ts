import { describe, expect, it } from "vitest";

import { validateEnvironment } from "./environment";

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

describe("AI gateway environment", () => {
  it("boots without any AI_* variable (module reports 503, app still starts)", () => {
    const result = validateEnvironment({ ...baseEnvironment });

    expect(result.AI_BASE_URL).toBeUndefined();
    expect(result.AI_PROTOCOL).toBeUndefined();
    expect(result.AI_TIMEOUT_MS).toBe(60_000);
    expect(result.AI_MAX_OUTPUT_TOKENS).toBe(6_000);
    expect(result.AI_DAILY_QUOTA).toBe(20);
    // Unset = the runtime default (`false`); the schema never invents `true`.
    expect(result.AI_VISION_SUPPORTED).toBeUndefined();
  });

  it("parses the vision opt-in strictly, treating empty as unset", () => {
    for (const value of ["true", "TRUE", "1", "yes", "on"]) {
      expect(
        validateEnvironment({ ...baseEnvironment, AI_VISION_SUPPORTED: value })
          .AI_VISION_SUPPORTED,
      ).toBe(true);
    }
    for (const value of ["false", "0", "no", "off"]) {
      expect(
        validateEnvironment({ ...baseEnvironment, AI_VISION_SUPPORTED: value })
          .AI_VISION_SUPPORTED,
      ).toBe(false);
    }
    // An empty value in `.env` means "use the code default", not an error.
    expect(
      validateEnvironment({ ...baseEnvironment, AI_VISION_SUPPORTED: "" })
        .AI_VISION_SUPPORTED,
    ).toBeUndefined();
  });

  it("fails the boot on a typo instead of silently leaving vision off", () => {
    for (const value of ["ture", "maybe", "2"]) {
      expect(() =>
        validateEnvironment({ ...baseEnvironment, AI_VISION_SUPPORTED: value }),
      ).toThrow(/AI_VISION_SUPPORTED/u);
    }
  });

  it("accepts a fully configured gateway and coerces numeric knobs", () => {
    const result = validateEnvironment({
      ...baseEnvironment,
      AI_PROTOCOL: "anthropic-messages",
      AI_BASE_URL: "http://127.0.0.1:3425/v1",
      AI_API_KEY: "local-test-key",
      AI_MODEL: "auto/deepseek-v4.1-flash",
      AI_TIMEOUT_MS: "45000",
      AI_MAX_OUTPUT_TOKENS: "8000",
      AI_DAILY_QUOTA: "5",
    });

    expect(result).toMatchObject({
      AI_PROTOCOL: "anthropic-messages",
      AI_BASE_URL: "http://127.0.0.1:3425/v1",
      AI_MODEL: "auto/deepseek-v4.1-flash",
      AI_TIMEOUT_MS: 45_000,
      AI_MAX_OUTPUT_TOKENS: 8_000,
      AI_DAILY_QUOTA: 5,
    });
  });

  it("rejects an unknown protocol, a non-http base URL, a missing model and out-of-range budgets", () => {
    expect(() =>
      validateEnvironment({ ...baseEnvironment, AI_PROTOCOL: "grpc" }),
    ).toThrow(/AI_PROTOCOL/u);

    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        AI_BASE_URL: "ftp://127.0.0.1/v1",
        AI_MODEL: "m",
      }),
    ).toThrow(/AI_BASE_URL must be an http\(s\) URL/u);

    expect(() =>
      validateEnvironment({ ...baseEnvironment, AI_BASE_URL: "http://127.0.0.1:3425/v1" }),
    ).toThrow(/AI_MODEL is required/u);

    expect(() =>
      validateEnvironment({ ...baseEnvironment, AI_TIMEOUT_MS: "1000" }),
    ).toThrow(/AI_TIMEOUT_MS/u);

    expect(() =>
      validateEnvironment({ ...baseEnvironment, AI_TIMEOUT_MS: "600000" }),
    ).toThrow(/AI_TIMEOUT_MS/u);

    expect(() =>
      validateEnvironment({ ...baseEnvironment, AI_DAILY_QUOTA: "500000" }),
    ).toThrow(/AI_DAILY_QUOTA/u);
  });
});