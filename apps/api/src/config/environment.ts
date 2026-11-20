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

/**
 * Boolean knob that may be omitted or left empty.
 *
 * Empty is "not set" (the code default applies), while an unrecognised value is
 * a hard boot error. That matters for `AI_VISION_SUPPORTED`: a typo such as
 * `ture` must not silently leave image input off while the operator believes it
 * is on, and it must not be silently coerced on either.
 */
const optionalBooleanFromEnvironment = z.preprocess(
  emptyStringToUndefined,
  booleanFromEnvironment.optional(),
);

/**
 * Deployment flavour. Defaults to `development` on purpose: staging also runs
 * `NODE_ENV=production` for Node runtime reasons and still delivers mail to a
 * local catcher, so production-only mail rules must key off APP_ENV instead of
 * NODE_ENV. Production sets APP_ENV=production explicitly.
 */
const AppEnvironment = z
  .enum(["development", "staging", "production", "test"])
  .default("development");

/** `mailpit` stays available for local/staging; production rejects it. */
const EmailProvider = z.enum(["resend", "smtp", "mailpit"]).default("smtp");

const LOCAL_MAIL_HOSTS = new Set([
  "mailpit",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "host.docker.internal",
]);

const PLACEHOLDER_FRAGMENTS = [
  "change_me",
  "change-me",
  "changeme",
  "placeholder",
  "replace-with",
  "xxxx",
  "your-",
];

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/** Extract the domain of `Name <local@domain>` or `local@domain`. */
function emailDomainFrom(value: string): string | undefined {
  const bracketed = /<([^<>@\s]+@[^<>\s]+)>/u.exec(value);
  const candidate = (bracketed?.[1] ?? value).trim();
  const at = candidate.lastIndexOf("@");
  if (at <= 0 || at === candidate.length - 1) {
    return undefined;
  }
  return candidate
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/[>);,]+$/u, "");
}

function isLocalMailDomain(domain: string): boolean {
  return domain === "local" || domain === "localhost" || domain.endsWith(".local");
}

function isUnreachableMailHost(host: string): boolean {
  return (
    LOCAL_MAIL_HOSTS.has(host) ||
    host.includes("mailpit") ||
    host.endsWith(".local") ||
    host === "example.com" ||
    host.endsWith(".example.com")
  );
}

/**
 * Hosts that can only ever be reached from inside the deployment. A presigned
 * URL is handed to a browser, so signing it against one of these makes media
 * unreachable from the internet even though the API itself works.
 */
const LOCAL_STORAGE_HOSTS = new Set([
  "minio",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "host.docker.internal",
]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => (/^\d{1,3}$/u.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isInternalStorageHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return true;
  }
  // IPv6 literals are always rejected: production media is a named TLS host.
  if (host.startsWith("[")) {
    return true;
  }
  if (LOCAL_STORAGE_HOSTS.has(host)) {
    return true;
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return true;
  }
  if (isPrivateIpv4(host)) {
    return true;
  }
  // A single-label hostname cannot be resolved by a public browser.
  return !host.includes(".");
}

/**
 * Validates a browser-facing storage URL. Messages name the variable only and
 * never echo the value (it is not a secret, but validation output ends up in
 * logs and issue trackers).
 */
function addPublicStorageUrlIssues(
  context: z.RefinementCtx,
  key: "S3_PUBLIC_ENDPOINT" | "S3_PUBLIC_BASE_URL",
  value: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} must be an absolute https URL`,
    });
    return;
  }

  if (parsed.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} must use https in production`,
    });
  }

  if (parsed.username || parsed.password) {
    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} must not embed credentials`,
    });
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} must be an origin without a path (presigned keys are appended to it)`,
    });
  }

  if (isInternalStorageHost(parsed.hostname)) {
    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} must be a public host, not minio/localhost/127.0.0.1/a private IP`,
    });
  }

  if (looksLikePlaceholder(value)) {
    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} still contains a placeholder; replace it before deploying`,
    });
  }
}

const EnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: AppEnvironment,
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
    /**
     * Master switch for the Redis failure policy.
     *
     * - `false` (default): Redis is treated as best-effort. Cache, rate limit,
     *   idempotency and quota calls fail open, the API boots and serves degraded
     *   traffic when Redis is down.
     * - `true`: the deployment declares Redis part of its baseline; the API
     *   refuses to boot when Redis is unreachable (`RedisService.onModuleInit`).
     *   Runtime behaviour stays fail-open on purpose: an outage after boot must
     *   still not take the API down.
     */
    REDIS_REQUIRED: booleanFromEnvironment.default(false),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(10),
    PUBLIC_SHARE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(60),
    PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(20),
    MEDIA_PRESIGN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(20),
    /**
     * Deployment-level defaults for the three upload ceilings. The operator
     * settings `limits.uploadMax*` win over these at request time (DB row, then
     * this variable, then the code default — see `limits-settings.consumer.ts`);
     * they exist so an existing deployment can pin the ceiling in its env instead
     * of the admin console. Defaults mirror the registry (20 files / 25 MiB /
     * 150 MiB).
     */
    MEDIA_UPLOAD_MAX_FILES_PER_BATCH: z.coerce.number().int().min(1).max(10_000).default(20),
    MEDIA_UPLOAD_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_073_741_824)
      .default(26_214_400),
    MEDIA_UPLOAD_MAX_BATCH_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_737_418_240)
      .default(157_286_400),
    /**
     * Lifetime of media read/upload URLs. Replaces the previous shared default
     * (`EXPORT_SIGNED_URL_TTL`); exports keep their own knob.
     */
    MEDIA_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(604_800).default(900),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: optionalUrl,
    /**
     * AES-256-GCM key material for `SystemSetting.secretCipher`. Optional so
     * local/CI runs that never save a secret can boot; saving one without a key
     * fails loudly with CONFIG_ENCRYPTION_KEY_MISSING instead of storing plaintext.
     * `CONFIG_ENCRYPTION_KEYS` is a comma-separated key ring: the first entry is
     * the current key, the rest decrypt historical ciphertext after a rotation.
     */
    CONFIG_ENCRYPTION_KEY: optionalString,
    CONFIG_ENCRYPTION_KEYS: optionalString,
    ADMIN_2FA_ENFORCED: booleanFromEnvironment.optional(),
    SESSION_COOKIE_DOMAIN: optionalString,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    TRUST_PROXY: booleanFromEnvironment.default(false),
    S3_ENDPOINT: z.url(),
    /**
     * Browser-facing MinIO origin used to presign URLs. Optional so local and
     * staging keep working (falls back to `S3_ENDPOINT`); required in a real
     * production deployment, where `S3_ENDPOINT` is an internal Docker name.
     */
    S3_PUBLIC_ENDPOINT: optionalUrl,
    /**
     * Optional unsigned public object base URL (CDN/origin). Reserved: no code
     * path serves media through it, because workspace media stays private and
     * is always reached through presigned URLs.
     */
    S3_PUBLIC_BASE_URL: optionalUrl,
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
    EMAIL_PROVIDER: EmailProvider,
    EMAIL_FROM: z.string().min(1).default("Roamlog <hello@roamlog.local>"),
    EXPORT_SIGNED_URL_TTL: z.coerce.number().int().min(60).max(604_800).default(900),
    BOOTSTRAP_SUPER_ADMIN_EMAIL: optionalString,
    /**
     * AI planner gateway (protocol-agnostic: chat completions, responses or
     * Anthropic messages). Optional as a group: an unconfigured deployment keeps
     * booting and the AI endpoints answer 503 AI_NOT_CONFIGURED.
     */
    AI_PROTOCOL: z
      .preprocess(emptyStringToUndefined, z.enum(["openai-chat", "openai-responses", "anthropic-messages"]).optional()),
    AI_BASE_URL: z.preprocess(emptyStringToUndefined, z.url().optional()),
    AI_API_KEY: optionalString,
    AI_MODEL: z.preprocess(emptyStringToUndefined, z.string().min(1).max(200).optional()),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(60_000),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(6_000),
    /** Per-user daily plan runs; 0 disables the cap. */
    AI_DAILY_QUOTA: z.coerce.number().int().min(0).max(100_000).default(20),
    /**
     * Image input capability for chat attachments. Declared here so a typo is a
     * boot error instead of a silently-off capability; the runtime default is
     * `false` (see `ai.settings.ts` `DEFAULT_AI_VISION`) and the gateway's
     * `/v1/models` `modalities` field is never trusted.
     */
    AI_VISION_SUPPORTED: optionalBooleanFromEnvironment,
  })
  .superRefine((environment, context) => {
    // The AI gateway is optional, but a configured one must point at plain
    // http(s): other schemes would silently fail at the first tool call.
    if (environment.AI_BASE_URL && !/^https?:\/\//u.test(environment.AI_BASE_URL)) {
      context.addIssue({
        code: "custom",
        path: ["AI_BASE_URL"],
        message: "AI_BASE_URL must be an http(s) URL",
      });
    }
    if (environment.AI_BASE_URL && !environment.AI_MODEL) {
      context.addIssue({
        code: "custom",
        path: ["AI_MODEL"],
        message: "AI_MODEL is required when AI_BASE_URL is set",
      });
    }

    // Validate the encryption key ring whenever it is present, in every
    // environment: a mistyped key would only surface on the first secret save.
    // Errors name the variable and never echo the key material.
    const configuredKeys = [
      ...(environment.CONFIG_ENCRYPTION_KEYS?.split(",")
        .map((entry) => entry.trim())
        .filter(Boolean) ?? []),
      ...(environment.CONFIG_ENCRYPTION_KEY ? [environment.CONFIG_ENCRYPTION_KEY.trim()] : []),
    ];
    for (const configuredKey of configuredKeys) {
      const decoded = Buffer.from(configuredKey, "base64");
      if (decoded.length !== 32 || decoded.toString("base64") !== configuredKey) {
        context.addIssue({
          code: "custom",
          path: ["CONFIG_ENCRYPTION_KEY"],
          message:
            "CONFIG_ENCRYPTION_KEY and every CONFIG_ENCRYPTION_KEYS entry must be base64-encoded 32-byte values",
        });
        break;
      }
    }

    // Deployment-shape checks keep keying off NODE_ENV, because staging also
    // runs NODE_ENV=production.
    if (environment.NODE_ENV === "production") {
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
    }

    // Media delivery is gated on APP_ENV=production, not NODE_ENV: staging also
    // runs NODE_ENV=production and still signs against the internal endpoint.
    // Presigned URLs sign the Host header, so a production deployment must sign
    // against the public TLS origin or every browser request 403s.
    if (environment.APP_ENV === "production") {
      if (!environment.S3_PUBLIC_ENDPOINT) {
        context.addIssue({
          code: "custom",
          path: ["S3_PUBLIC_ENDPOINT"],
          message:
            "S3_PUBLIC_ENDPOINT is required when APP_ENV=production (presigned URLs are signed for the browser-facing host)",
        });
      } else {
        addPublicStorageUrlIssues(context, "S3_PUBLIC_ENDPOINT", environment.S3_PUBLIC_ENDPOINT);
      }

      if (environment.S3_PUBLIC_BASE_URL) {
        addPublicStorageUrlIssues(context, "S3_PUBLIC_BASE_URL", environment.S3_PUBLIC_BASE_URL);
      }
    }

    // Mail rules only apply to a real production deployment (APP_ENV), so
    // staging can keep using its local mail catcher.
    if (environment.APP_ENV !== "production") {
      return;
    }

    const provider = environment.EMAIL_PROVIDER;
    const fromDomain = emailDomainFrom(environment.EMAIL_FROM);

    if (!fromDomain) {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: "EMAIL_FROM must be an address such as Roamlog <no-reply@example.com>",
      });
    } else if (isLocalMailDomain(fromDomain)) {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: "EMAIL_FROM must not use a .local domain in production",
      });
    } else if (looksLikePlaceholder(environment.EMAIL_FROM)) {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: "Replace the placeholder EMAIL_FROM before production",
      });
    }

    if (provider === "mailpit") {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER"],
        message: "EMAIL_PROVIDER=mailpit is not allowed when APP_ENV=production",
      });
      return;
    }

    if (provider === "resend") {
      const apiKey = environment.RESEND_API_KEY?.trim();
      if (!apiKey) {
        context.addIssue({
          code: "custom",
          path: ["RESEND_API_KEY"],
          message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
        });
      } else if (!apiKey.startsWith("re_") || looksLikePlaceholder(apiKey)) {
        context.addIssue({
          code: "custom",
          path: ["RESEND_API_KEY"],
          message: "RESEND_API_KEY must be a real Resend key (re_...), not a placeholder",
        });
      }

      if (environment.SMTP_HOST) {
        context.addIssue({
          code: "custom",
          path: ["SMTP_HOST"],
          message:
            "SMTP_HOST must be empty when EMAIL_PROVIDER=resend, otherwise the API prefers SMTP",
        });
      }
      return;
    }

    const smtpHost = environment.SMTP_HOST?.trim().toLowerCase();
    if (!smtpHost) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "SMTP_HOST is required when EMAIL_PROVIDER=smtp",
      });
    } else if (isUnreachableMailHost(smtpHost)) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "SMTP_HOST must be a reachable relay in production, not a local or example host",
      });
    }

    if (environment.SMTP_PORT === 1025) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_PORT"],
        message: "SMTP_PORT 1025 is the local mail-catcher port; set the production relay port",
      });
    }

    if (!environment.SMTP_USER?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_USER"],
        message: "SMTP_USER is required when EMAIL_PROVIDER=smtp",
      });
    }

    if (!environment.SMTP_PASSWORD?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_PASSWORD"],
        message: "SMTP_PASSWORD is required when EMAIL_PROVIDER=smtp",
      });
    } else if (looksLikePlaceholder(environment.SMTP_PASSWORD)) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_PASSWORD"],
        message: "Replace the placeholder SMTP_PASSWORD before production",
      });
    }
  });

export type Environment = Omit<
  z.infer<typeof EnvironmentSchema>,
  "CORS_ORIGINS" | "S3_PUBLIC_ENDPOINT"
> & {
  CORS_ORIGINS: string[];
  /** Always resolved: falls back to `S3_ENDPOINT` when it is not configured. */
  S3_PUBLIC_ENDPOINT: string;
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
    S3_PUBLIC_ENDPOINT: (result.data.S3_PUBLIC_ENDPOINT ?? result.data.S3_ENDPOINT).replace(
      /\/+$/u,
      "",
    ),
    CORS_ORIGINS: corsOrigins,
  };
}
