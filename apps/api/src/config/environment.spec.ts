import { randomBytes } from "node:crypto";
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
      AUTH_RATE_LIMIT_MAX: 10,
      PUBLIC_SHARE_RATE_LIMIT_MAX: 60,
      PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX: 20,
      MEDIA_PRESIGN_RATE_LIMIT_MAX: 20,
      RATE_LIMIT_WINDOW_SECONDS: 60,
    });
  });

  it("accepts configurable rate-limit thresholds", () => {
    const result = validateEnvironment({
      ...baseEnvironment,
      AUTH_RATE_LIMIT_MAX: "7",
      PUBLIC_SHARE_RATE_LIMIT_MAX: "45",
      PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX: "5",
      MEDIA_PRESIGN_RATE_LIMIT_MAX: "12",
      RATE_LIMIT_WINDOW_SECONDS: "120",
    });

    expect(result).toMatchObject({
      AUTH_RATE_LIMIT_MAX: 7,
      PUBLIC_SHARE_RATE_LIMIT_MAX: 45,
      PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX: 5,
      MEDIA_PRESIGN_RATE_LIMIT_MAX: 12,
      RATE_LIMIT_WINDOW_SECONDS: 120,
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

describe("email transport configuration", () => {
  const productionEmail = {
    ...baseEnvironment,
    APP_ENV: "production",
    EMAIL_FROM: "Roamlog <no-reply@roamlog.app>",
    // Production also requires a browser-facing storage origin; kept here so
    // the mail cases fail only on mail rules.
    S3_PUBLIC_ENDPOINT: "https://media.roamlog.app",
  };

  const productionResend = {
    ...productionEmail,
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_live_example_key_value",
    SMTP_HOST: "",
  };

  const productionSmtp = {
    ...productionEmail,
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "smtp.mailgun.org",
    SMTP_PORT: "587",
    SMTP_USER: "postmaster",
    SMTP_PASSWORD: "smtp-application-password",
  };

  it("defaults to the smtp transport and development flavour for local Mailpit", () => {
    const result = validateEnvironment({ ...baseEnvironment });

    expect(result.APP_ENV).toBe("development");
    expect(result.EMAIL_PROVIDER).toBe("smtp");
    expect(result.SMTP_PORT).toBe(1025);
  });

  it("keeps local mailpit delivery working outside a production deployment", () => {
    const result = validateEnvironment({
      ...baseEnvironment,
      NODE_ENV: "production",
      APP_URL: "https://app.staging.roamlog.app",
      ADMIN_URL: "https://admin.staging.roamlog.app",
      API_URL: "https://api.staging.roamlog.app",
      CORS_ORIGINS: "https://app.staging.roamlog.app",
      EMAIL_PROVIDER: "mailpit",
      SMTP_HOST: "mailpit",
    });

    expect(result.EMAIL_PROVIDER).toBe("mailpit");
    expect(result.APP_ENV).toBe("development");
  });

  it("accepts a complete production resend configuration", () => {
    const result = validateEnvironment(productionResend);

    expect(result.EMAIL_PROVIDER).toBe("resend");
    expect(result.RESEND_API_KEY).toBe("re_live_example_key_value");
  });

  it("accepts a complete production smtp configuration", () => {
    const result = validateEnvironment(productionSmtp);

    expect(result.EMAIL_PROVIDER).toBe("smtp");
    expect(result.SMTP_HOST).toBe("smtp.mailgun.org");
    expect(result.SMTP_PORT).toBe(587);
  });

  it("rejects the mailpit transport in production", () => {
    expect(() =>
      validateEnvironment({
        ...productionEmail,
        EMAIL_PROVIDER: "mailpit",
        SMTP_HOST: "mailpit",
      }),
    ).toThrow(/EMAIL_PROVIDER=mailpit is not allowed when APP_ENV=production/);
  });

  it("requires a real Resend key in production", () => {
    expect(() => validateEnvironment({ ...productionResend, RESEND_API_KEY: "" })).toThrow(
      /RESEND_API_KEY is required/,
    );

    expect(() =>
      validateEnvironment({ ...productionResend, RESEND_API_KEY: "re_xxxxxxxxxxxxxxxx" }),
    ).toThrow(/not a placeholder/);
  });

  it("rejects a .local sender domain in production", () => {
    expect(() =>
      validateEnvironment({ ...productionResend, EMAIL_FROM: "Roamlog <hello@roamlog.local>" }),
    ).toThrow(/EMAIL_FROM must not use a \.local domain/);

    expect(() =>
      validateEnvironment({ ...productionSmtp, EMAIL_FROM: "Roamlog <hello@roamlog.local>" }),
    ).toThrow(/EMAIL_FROM must not use a \.local domain/);
  });

  it("keeps the resend transport unambiguous", () => {
    expect(() =>
      validateEnvironment({ ...productionResend, SMTP_HOST: "smtp.mailgun.org" }),
    ).toThrow(/SMTP_HOST must be empty when EMAIL_PROVIDER=resend/);
  });

  it("requires a reachable production SMTP relay", () => {
    expect(() => validateEnvironment({ ...productionSmtp, SMTP_HOST: "mailpit" })).toThrow(
      /SMTP_HOST must be a reachable relay/,
    );

    expect(() => validateEnvironment({ ...productionSmtp, SMTP_HOST: "localhost" })).toThrow(
      /SMTP_HOST must be a reachable relay/,
    );

    expect(() => validateEnvironment({ ...productionSmtp, SMTP_HOST: "smtp.example.com" })).toThrow(
      /SMTP_HOST must be a reachable relay/,
    );
  });

  it("requires SMTP credentials and a non-mail-catcher port", () => {
    expect(() => validateEnvironment({ ...productionSmtp, SMTP_USER: "" })).toThrow(
      /SMTP_USER is required/,
    );
    expect(() => validateEnvironment({ ...productionSmtp, SMTP_PASSWORD: "" })).toThrow(
      /SMTP_PASSWORD is required/,
    );
    expect(() => validateEnvironment({ ...productionSmtp, SMTP_PORT: "1025" })).toThrow(
      /SMTP_PORT 1025 is the local mail-catcher port/,
    );
  });

  it("does not echo secret values in validation errors", () => {
    const secret = "re_supersecretproductionkey";
    let message = "";

    try {
      validateEnvironment({
        ...productionResend,
        RESEND_API_KEY: secret,
        EMAIL_FROM: "Roamlog <hello@roamlog.local>",
        SMTP_PORT: "1025",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/EMAIL_FROM/);
    expect(message).not.toContain(secret);
    expect(message).not.toContain("smtp-application-password");
  });
});

describe("media storage configuration", () => {
  const productionStorage = {
    ...baseEnvironment,
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_URL: "https://we.example.com",
    ADMIN_URL: "https://we.example.com",
    API_URL: "https://we.example.com",
    CORS_ORIGINS: "https://we.example.com",
    EMAIL_PROVIDER: "resend",
    EMAIL_FROM: "Roamlog <no-reply@roamlog.app>",
    RESEND_API_KEY: "re_live_example_key_value",
    SMTP_HOST: "",
    SMTP_PORT: "587",
    S3_PUBLIC_ENDPOINT: "https://media.example.com",
  };

  it("falls back to S3_ENDPOINT when S3_PUBLIC_ENDPOINT is unset", () => {
    const result = validateEnvironment({ ...baseEnvironment });

    expect(result.S3_PUBLIC_ENDPOINT).toBe("http://localhost:9000");
  });

  it("keeps an explicit public endpoint and strips its trailing slash", () => {
    const result = validateEnvironment({
      ...baseEnvironment,
      S3_PUBLIC_ENDPOINT: "https://media.example.com/",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com",
    });

    expect(result.S3_PUBLIC_ENDPOINT).toBe("https://media.example.com");
    expect(result.S3_PUBLIC_BASE_URL).toBe("https://cdn.example.com");
  });

  it("defaults the media signed-URL TTL and enforces its 60s-7d range", () => {
    expect(validateEnvironment({ ...baseEnvironment }).MEDIA_SIGNED_URL_TTL_SECONDS).toBe(900);

    for (const value of [60, 900, 604_800]) {
      expect(
        validateEnvironment({ ...baseEnvironment, MEDIA_SIGNED_URL_TTL_SECONDS: String(value) })
          .MEDIA_SIGNED_URL_TTL_SECONDS,
      ).toBe(value);
    }

    expect(() =>
      validateEnvironment({ ...baseEnvironment, MEDIA_SIGNED_URL_TTL_SECONDS: "59" }),
    ).toThrow(/MEDIA_SIGNED_URL_TTL_SECONDS/);
    expect(() =>
      validateEnvironment({ ...baseEnvironment, MEDIA_SIGNED_URL_TTL_SECONDS: "604801" }),
    ).toThrow(/MEDIA_SIGNED_URL_TTL_SECONDS/);
  });

  it("requires a public endpoint in a real production deployment", () => {
    expect(() => validateEnvironment({ ...productionStorage, S3_PUBLIC_ENDPOINT: "" })).toThrow(
      /S3_PUBLIC_ENDPOINT is required when APP_ENV=production/,
    );
  });

  it("accepts a TLS media host in production", () => {
    const result = validateEnvironment({ ...productionStorage });

    expect(result.S3_PUBLIC_ENDPOINT).toBe("https://media.example.com");
  });

  it("keeps staging (APP_ENV=staging, NODE_ENV=production) working without a public endpoint", () => {
    const result = validateEnvironment({
      ...productionStorage,
      APP_ENV: "staging",
      S3_PUBLIC_ENDPOINT: "",
    });

    expect(result.S3_PUBLIC_ENDPOINT).toBe("http://localhost:9000");
  });

  it("rejects plain http, internal hosts and credential-bearing origins in production", () => {
    const rejected = [
      { S3_PUBLIC_ENDPOINT: "http://media.example.com", message: /must use https/ },
      { S3_PUBLIC_ENDPOINT: "https://minio:9000", message: /must be a public host/ },
      { S3_PUBLIC_ENDPOINT: "https://localhost:9000", message: /must be a public host/ },
      { S3_PUBLIC_ENDPOINT: "https://127.0.0.1:9000", message: /must be a public host/ },
      { S3_PUBLIC_ENDPOINT: "https://10.0.0.5", message: /must be a public host/ },
      { S3_PUBLIC_ENDPOINT: "https://172.20.1.4", message: /must be a public host/ },
      { S3_PUBLIC_ENDPOINT: "https://192.168.1.10", message: /must be a public host/ },
      { S3_PUBLIC_ENDPOINT: "https://host.docker.internal", message: /must be a public host/ },
      { S3_PUBLIC_ENDPOINT: "https://media.local", message: /must be a public host/ },
      { S3_PUBLIC_ENDPOINT: "https://mediaserver", message: /must be a public host/ },
      { S3_PUBLIC_ENDPOINT: "https://media.example.com/prefix", message: /origin without a path/ },
      {
        S3_PUBLIC_ENDPOINT: "https://user:pass@media.example.com",
        message: /must not embed credentials/,
      },
    ];

    for (const { S3_PUBLIC_ENDPOINT, message } of rejected) {
      expect(() => validateEnvironment({ ...productionStorage, S3_PUBLIC_ENDPOINT })).toThrow(
        message,
      );
    }
  });

  it("validates S3_PUBLIC_BASE_URL with the same rules when it is set", () => {
    expect(() =>
      validateEnvironment({ ...productionStorage, S3_PUBLIC_BASE_URL: "http://cdn.example.com" }),
    ).toThrow(/S3_PUBLIC_BASE_URL must use https/);

    expect(
      validateEnvironment({ ...productionStorage, S3_PUBLIC_BASE_URL: "https://cdn.example.com" })
        .S3_PUBLIC_BASE_URL,
    ).toBe("https://cdn.example.com");
  });

  it("rejects an unreplaced placeholder public endpoint in production", () => {
    expect(() =>
      validateEnvironment({
        ...productionStorage,
        S3_PUBLIC_ENDPOINT: "https://media.CHANGE_ME.example.com",
      }),
    ).toThrow(/S3_PUBLIC_ENDPOINT still contains a placeholder/);
  });

  it("does not echo storage secrets or the rejected endpoint in validation errors", () => {
    const secret = "super-secret-s3-application-key";
    const endpoint = "https://10.9.8.7:9000";
    let message = "";

    try {
      validateEnvironment({
        ...productionStorage,
        S3_SECRET_KEY: secret,
        S3_ACCESS_KEY: "access-key-should-not-leak",
        S3_PUBLIC_ENDPOINT: endpoint,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/S3_PUBLIC_ENDPOINT/);
    expect(message).not.toContain(secret);
    expect(message).not.toContain("access-key-should-not-leak");
    expect(message).not.toContain(endpoint);
  });

  it("accepts a valid CONFIG_ENCRYPTION_KEY ring in every environment", () => {
    const current = randomBytes(32).toString("base64");
    const previous = randomBytes(32).toString("base64");

    expect(
      validateEnvironment({ ...baseEnvironment, CONFIG_ENCRYPTION_KEY: current })
        .CONFIG_ENCRYPTION_KEY,
    ).toBe(current);
    expect(
      validateEnvironment({
        ...baseEnvironment,
        CONFIG_ENCRYPTION_KEYS: `${current},${previous}`,
      }).CONFIG_ENCRYPTION_KEYS,
    ).toBe(`${current},${previous}`);
  });

  it("rejects malformed encryption keys without echoing the key material", () => {
    const malformed = "not-a-base64-32-byte-key";

    let message = "";
    try {
      validateEnvironment({ ...baseEnvironment, CONFIG_ENCRYPTION_KEY: malformed });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/CONFIG_ENCRYPTION_KEY/);
    expect(message).toMatch(/base64-encoded 32-byte/);
    expect(message).not.toContain(malformed);

    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        CONFIG_ENCRYPTION_KEYS: `${randomBytes(32).toString("base64")},short`,
      }),
    ).toThrow(/CONFIG_ENCRYPTION_KEY/);
  });
});
