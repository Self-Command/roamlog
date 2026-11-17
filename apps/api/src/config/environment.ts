import { z } from "zod";

const emptyStringToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

const optionalString = z.preprocess(emptyStringToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyStringToUndefined, z.url().optional());

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const EnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    APP_URL: z.url().default("http://localhost:3000"),
    ADMIN_URL: z.url().default("http://localhost:3001"),
    API_URL: z.url().default("http://localhost:4000"),
    CORS_ORIGINS: optionalString,
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.url(),
    REDIS_PREFIX: z.string().min(1).default("roamlog"),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(10),
    PUBLIC_SHARE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(60),
    PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(20),
    MEDIA_PRESIGN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(20),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: optionalUrl,
    ADMIN_2FA_ENFORCED: booleanFromEnvironment.optional(),
    SESSION_COOKIE_DOMAIN: optionalString,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    TRUST_PROXY: booleanFromEnvironment.default(false),
    S3_ENDPOINT: z.url(),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_FORCE_PATH_STYLE: booleanFromEnvironment.default(true),
    SENTRY_DSN: optionalUrl,
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    RESEND_API_KEY: optionalString,
    EMAIL_FROM: z.string().min(1).default("Roamlog <hello@roamlog.local>"),
    EXPORT_SIGNED_URL_TTL: z.coerce.number().int().min(60).max(604_800).default(900),
    BOOTSTRAP_SUPER_ADMIN_EMAIL: optionalString,
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== "production") {
      return;
    }

    if (!environment.CORS_ORIGINS) {
      context.addIssue({
        code: "custom",
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS is required in production",
      });
    }

    if (environment.BETTER_AUTH_SECRET.includes("replace-with")) {
      context.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "Replace the local BETTER_AUTH_SECRET before production",
      });
    }

    for (const key of ["APP_URL", "ADMIN_URL", "API_URL"] as const) {
      if (!environment[key].startsWith("https://")) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must use https in production`,
        });
      }
    }
  });

export type Environment = Omit<z.infer<typeof EnvironmentSchema>, "CORS_ORIGINS"> & {
  CORS_ORIGINS: string[];
};

function normalizeCorsOrigins(rawOrigins: string): string[] {
  const origins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`);
      }

      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error(`CORS_ORIGINS must contain plain http(s) origins: ${origin}`);
      }

      return parsed.origin;
    });

  return [...new Set(origins)];
}

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const result = EnvironmentSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.map(String).join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const configuredOrigins =
    result.data.CORS_ORIGINS ?? `${result.data.APP_URL},${result.data.ADMIN_URL}`;
  const corsOrigins = normalizeCorsOrigins(configuredOrigins);

  if (corsOrigins.length === 0) {
    throw new Error("Invalid environment configuration: CORS_ORIGINS cannot be empty");
  }

  if (result.data.NODE_ENV === "production") {
    for (const origin of corsOrigins) {
      const parsed = new URL(origin);
      if (parsed.protocol !== "https:") {
        throw new Error(
          "Invalid environment configuration: production CORS origins must use https",
        );
      }
    }
  }

  return {
    ...input,
    ...result.data,
    CORS_ORIGINS: corsOrigins,
  };
}
