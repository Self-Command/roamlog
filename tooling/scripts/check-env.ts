import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateEnvironment } from "../../apps/api/src/config/environment.js";

type EnvMap = Record<string, string>;
type Mode = "local" | "production";

const USAGE = `Usage: check-env.ts [--env <local|production>] [--env-file <path>] [--help]

Read-only environment preflight. It never reads the network, Docker, or the
database, and it never prints a value: every error names the variable and the
rule that failed.

Modes
  local        (default) reads .env.local or .env, then overlays process.env.
               Permits local placeholders, warns about them instead.
  production   strict APP_ENV=production preflight. Reads
               docker/production.env.example unless --env-file is given.
               process.env is deliberately NOT overlaid, so the file under
               review is what gets judged.

The production rules themselves are not re-implemented here: this script calls
validateEnvironment() from apps/api/src/config/environment.ts (the same function
the API runs at boot) and only adds deployment-completeness checks that the API
schema cannot know about (placeholder leftovers, explicit APP_ENV /
EMAIL_PROVIDER, bucket CORS origins).

Exit codes
  0  configuration passed
  1  configuration failed, or bad usage

Retired flags
  The retired data-mode build flags were removed with the mock data mode.
  The application only has the live API path, so a leftover export is
  reported as a warning (never a failure) and has no effect.
`;

const DEFAULT_LOCAL_ENV_FILES = [".env.local", ".env"] as const;
const DEFAULT_PRODUCTION_ENV_FILE = "docker/production.env.example";

/**
 * Build-time switches retired with the mock data mode. They are listed here
 * only for a reverse assertion: a stale export is reported, never enforced.
 */
const RETIRED_DATA_MODE_KEYS = ["NEXT_PUBLIC_DATA_MODE", "NEXT_PUBLIC_ADMIN_DATA_MODE"] as const;

const BASE_REQUIRED_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "BETTER_AUTH_SECRET",
  "APP_URL",
  "ADMIN_URL",
  "API_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "RESEND_API_KEY",
  "NEXT_PUBLIC_MAP_STYLE_URL",
  "NEXT_PUBLIC_GEOCODER_URL",
  "EXPORT_SIGNED_URL_TTL",
  "BOOTSTRAP_SUPER_ADMIN_EMAIL",
] as const;

/**
 * Keys this task added to the preflight. `MEDIA_CORS_ORIGINS` is not part of
 * EnvironmentSchema (it configures the MinIO bucket CORS policy through
 * docker/minio-init), which is exactly why it needs a preflight of its own.
 */
const PRODUCTION_ONLY_REQUIRED_KEYS = [
  "APP_ENV",
  "EMAIL_PROVIDER",
  "S3_PUBLIC_ENDPOINT",
  "MEDIA_CORS_ORIGINS",
] as const;

/**
 * Keys that are safe to leave implicit locally because EnvironmentSchema
 * defaults them. In production `APP_ENV` and `EMAIL_PROVIDER` must be explicit:
 * omitting APP_ENV silently disables every strict production rule.
 */
const PRODUCTION_EXPLICIT_KEYS = ["APP_ENV", "EMAIL_PROVIDER"] as const;

const VALID_APP_ENV = ["development", "test", "staging", "production"] as const;
const VALID_EMAIL_PROVIDER = ["resend", "smtp", "mailpit"] as const;

/**
 * Same fragments EnvironmentSchema uses for placeholders, plus the marker the
 * production template uses (`CHANGE_ME`). Lower-cased comparison.
 */
const PLACEHOLDER_FRAGMENTS = [
  "replace-with",
  "local_placeholder",
  "changeme",
  "change_me",
  "change-me",
  "placeholder",
  "xxxx",
  "your-",
] as const;

/** Documentation-only domain. A production value must never contain it. */
const DOCUMENTATION_DOMAIN = "example.com";

/**
 * Values that must never reach stdout/stderr, even if a validator message
 * embeds them. Public origins are redacted too, because EnvironmentSchema
 * echoes an invalid CORS origin back in its message.
 */
const REDACTED_KEYS = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "REDIS_PASSWORD",
  "POSTGRES_PASSWORD",
  "MINIO_ROOT_PASSWORD",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "RESEND_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_SECRET",
  "APP_URL",
  "ADMIN_URL",
  "API_URL",
  "CORS_ORIGINS",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_PUBLIC_BASE_URL",
  "EMAIL_FROM",
  "SMTP_HOST",
  "BOOTSTRAP_SUPER_ADMIN_EMAIL",
] as const;

const parseEnvFile = (path: string): EnvMap => {
  const values: EnvMap = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

/** Never echo a value: replace known values in a validator message. */
const redact = (message: string, env: EnvMap): string => {
  let output = message;
  const values = REDACTED_KEYS.map((key) => env[key]?.trim() ?? "")
    .filter((value) => value.length >= 4)
    .sort((left, right) => right.length - left.length);
  for (const value of values) {
    output = output.split(value).join("<redacted>");
  }
  return output;
};

const looksLikePlaceholder = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_FRAGMENTS.some((fragment) => normalized.includes(fragment));
};

const looksLikeDocumentationDomain = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === DOCUMENTATION_DOMAIN ||
    normalized.includes(`.${DOCUMENTATION_DOMAIN}`) ||
    normalized.includes(`@${DOCUMENTATION_DOMAIN}`)
  );
};

interface Arguments {
  mode: Mode;
  envFile: string | undefined;
  help: boolean;
}

const parseArguments = (argv: string[]): Arguments => {
  const options: Arguments = { mode: "local", envFile: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = (): string => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      return value;
    };
    switch (argument) {
      case "--env":
        options.mode = nextValue() as Mode;
        index += 1;
        break;
      case "--env-file":
        options.envFile = nextValue();
        index += 1;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.mode !== "local" && options.mode !== "production") {
    throw new Error(`--env must be "local" or "production" (got: ${options.mode})`);
  }
  return options;
};

const fail = (message: string): never => {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exit(1);
};

const root = process.cwd();
const errors: string[] = [];
const warnings: string[] = [];

let options: Arguments;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (options.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const selectedFile = options.envFile
  ? resolve(root, options.envFile)
  : options.mode === "production"
    ? resolve(root, DEFAULT_PRODUCTION_ENV_FILE)
    : DEFAULT_LOCAL_ENV_FILES.map((name) => resolve(root, name)).find(existsSync);

const envFileExists = selectedFile !== undefined && existsSync(selectedFile);
let env: EnvMap = {};

if (options.mode === "production" && !envFileExists) {
  errors.push(
    `Environment file not found: ${selectedFile ?? "(none)"}. Pass --env-file <path> (production deployments use /opt/roamlog/config/.env.production).`,
  );
} else if (envFileExists && selectedFile) {
  const fileEnv: EnvMap = parseEnvFile(selectedFile);
  // Production judges the reviewed file only; a shell export must not repair it.
  env = options.mode === "production" ? fileEnv : { ...fileEnv, ...process.env };
} else {
  env = { ...process.env } as EnvMap;
}

const requiredKeys: string[] = [
  ...BASE_REQUIRED_KEYS,
  ...(options.mode === "production" ? PRODUCTION_ONLY_REQUIRED_KEYS : ([] as readonly string[])),
].filter((key) => options.mode !== "production" || !key.startsWith("NEXT_PUBLIC_"));

for (const key of requiredKeys) {
  if (env[key]?.trim()) continue;
  errors.push(
    (PRODUCTION_EXPLICIT_KEYS as readonly string[]).includes(key)
      ? `${key} must be set explicitly when APP_ENV=production (the schema default silently weakens production checks).`
      : `Missing required environment variable: ${key}`,
  );
}

const checkSecret = (): void => {
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret && secret.length < 32) {
    errors.push("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
};

const checkUrls = (keys: readonly string[]): void => {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (!value) continue;
    try {
      new URL(value);
    } catch {
      errors.push(`${key} must be a valid URL.`);
    }
  }
};

const checkIntegerRange = (
  key: string,
  minimum: number,
  maximum: number,
  options_: { required: boolean },
): void => {
  const raw = env[key]?.trim();
  if (!raw) {
    // Range-checked by EnvironmentSchema in production (defaults to 900).
    if (options_.required) {
      errors.push(`${key} must be an integer between ${minimum} and ${maximum}.`);
    }
    return;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    errors.push(`${key} must be an integer between ${minimum} and ${maximum} seconds.`);
  }
};

const checkAppEnv = (): void => {
  const raw = env.APP_ENV?.trim();
  if (!raw) return;
  if (!(VALID_APP_ENV as readonly string[]).includes(raw)) {
    errors.push(`APP_ENV must be one of ${VALID_APP_ENV.join(", ")}.`);
  }
};

const checkEmailProvider = (): void => {
  const raw = env.EMAIL_PROVIDER?.trim();
  if (!raw) return;
  if (!(VALID_EMAIL_PROVIDER as readonly string[]).includes(raw)) {
    errors.push(`EMAIL_PROVIDER must be one of ${VALID_EMAIL_PROVIDER.join(", ")}.`);
  }
};

/**
 * Mirrors the bucket CORS rules enforced by docker/minio-init/01-create-bucket.sh
 * plus the production requirement documented in docs/operations/media-delivery.md.
 * Error messages identify the entry by position, never by value.
 */
const checkMediaCorsOrigins = (requireHttps: boolean): void => {
  const raw = env.MEDIA_CORS_ORIGINS?.trim();
  if (!raw) {
    // The required-key check already names a missing MEDIA_CORS_ORIGINS;
    // only the local mode treats an empty list as acceptable.
    return;
  }

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    errors.push("MEDIA_CORS_ORIGINS must list at least one browser origin.");
    return;
  }

  const origins: string[] = [];
  entries.forEach((entry, index) => {
    const position = index + 1;
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      errors.push(`MEDIA_CORS_ORIGINS entry ${position} is not an absolute URL.`);
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      errors.push(`MEDIA_CORS_ORIGINS entry ${position} must be an http(s) origin.`);
      return;
    }
    if (requireHttps && parsed.protocol !== "https:") {
      errors.push(`MEDIA_CORS_ORIGINS entry ${position} must use https in production.`);
    }
    if (parsed.username || parsed.password) {
      errors.push(`MEDIA_CORS_ORIGINS entry ${position} must not embed credentials.`);
    }
    if (parsed.pathname !== "/" && parsed.pathname !== "") {
      errors.push(`MEDIA_CORS_ORIGINS entry ${position} must be a bare origin without a path.`);
      return;
    }
    if (entry.endsWith("/")) {
      errors.push(
        `MEDIA_CORS_ORIGINS entry ${position} must be a bare origin without a trailing slash.`,
      );
      return;
    }
    if (parsed.search || parsed.hash) {
      errors.push(`MEDIA_CORS_ORIGINS entry ${position} must not contain a query or fragment.`);
      return;
    }
    origins.push(parsed.origin);
  });

  const appUrl = env.APP_URL?.trim();
  if (appUrl && origins.length > 0) {
    try {
      const appOrigin = new URL(appUrl).origin;
      if (!origins.includes(appOrigin)) {
        errors.push(
          "MEDIA_CORS_ORIGINS must include the APP_URL origin so browser uploads and image reads are allowed.",
        );
      }
    } catch {
      // APP_URL validity is reported by the URL check above.
    }
  }
};

const reportPlaceholders = (keys: readonly string[], asError: boolean): void => {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (!value) continue;
    if (!looksLikePlaceholder(value) && !looksLikeDocumentationDomain(value)) continue;
    const message = `${key} still contains a placeholder value; replace it before deploying.`;
    if (asError) errors.push(message);
    else warnings.push(message.replace("; replace it", " (local default)"));
  }
};

/**
 * Reverse assertion for the retired data-mode build flag. It must not fail:
 * the build ignores the variable now, so a leftover export is a warning that
 * names the key and tells the operator where to remove it.
 */
const reportRetiredDataModeFlags = (): void => {
  for (const key of RETIRED_DATA_MODE_KEYS) {
    if (process.env[key] === undefined) continue;
    warnings.push(
      `${key} is still set in process.env but the data-mode build flag was removed; the app only has the live API path. Remove it from your shell/profile or env file.`,
    );
  }
};

// Checked even in production mode, where the reviewed file (not process.env)
// drives the rules: a leftover shell export is exactly the stale usage wanted.
reportRetiredDataModeFlags();

if (options.mode === "production") {
  checkAppEnv();
  checkEmailProvider();

  const configuredAppEnv = env.APP_ENV?.trim();
  if (configuredAppEnv && configuredAppEnv !== "production") {
    errors.push("APP_ENV must be production when validating a production deployment file.");
  }

  // Deployment-completeness checks the API schema cannot perform.
  reportPlaceholders(Object.keys(env), true);
  checkMediaCorsOrigins(true);
  checkIntegerRange("MEDIA_SIGNED_URL_TTL_SECONDS", 60, 604_800, { required: false });
  checkIntegerRange("EXPORT_SIGNED_URL_TTL", 60, 604_800, { required: false });
  checkUrls(["S3_PUBLIC_BASE_URL"]);

  if (env.DEMO_SEED_ENABLED === "true") {
    errors.push("DEMO_SEED_ENABLED must not be true in production.");
  }

  // Single source of truth: the exact schema the API validates at boot.
  // The aggregated message is `PATH: message; PATH: message`; some messages
  // contain "; " themselves, so only split where a new path starts.
  try {
    validateEnvironment(env);
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), env);
    const prefix = "Invalid environment configuration: ";
    const details = message.startsWith(prefix) ? message.slice(prefix.length) : message;
    for (const detail of details.split(/;\s+(?=[A-Z][A-Z0-9_]*:\s)/u)) {
      if (detail.trim()) errors.push(detail.trim());
    }
  }
} else {
  checkAppEnv();
  checkEmailProvider();
  checkSecret();
  checkUrls(["APP_URL", "ADMIN_URL", "API_URL", "S3_ENDPOINT", "S3_PUBLIC_ENDPOINT"]);
  checkUrls(["S3_PUBLIC_BASE_URL"]);
  checkIntegerRange("EXPORT_SIGNED_URL_TTL", 1, 86_400, { required: true });
  checkIntegerRange("MEDIA_SIGNED_URL_TTL_SECONDS", 60, 604_800, { required: false });
  checkMediaCorsOrigins(false);

  const databaseUrl = env.DATABASE_URL ?? "";
  if (databaseUrl && !/^postgres(ql)?:\/\//u.test(databaseUrl)) {
    errors.push("DATABASE_URL must be a PostgreSQL connection string.");
  }

  const redisUrl = env.REDIS_URL ?? "";
  if (redisUrl && !/^rediss?:\/\//u.test(redisUrl)) {
    errors.push("REDIS_URL must be a redis:// or rediss:// URL.");
  }

  const nodeEnv = env.NODE_ENV ?? "development";
  if (nodeEnv === "production") {
    if (env.DEMO_SEED_ENABLED === "true") {
      errors.push("DEMO_SEED_ENABLED must not be true in production.");
    }
    const secret = env.BETTER_AUTH_SECRET ?? "";
    if (secret.length > 0 && looksLikePlaceholder(secret)) {
      errors.push("BETTER_AUTH_SECRET must not use a placeholder in production.");
    }
  } else {
    // Local development is allowed to keep template defaults; warn only.
    reportPlaceholders(requiredKeys, false);
  }
}

if (selectedFile && envFileExists) {
  console.log(`Loaded environment from ${selectedFile} (mode: ${options.mode})`);
} else if (options.mode === "local") {
  console.warn("WARN: no .env.local or .env found; checking process.env only.");
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${redact(error, env)}`);
  console.error(`\nEnvironment configuration is invalid (${errors.length} problem(s)).`);
  process.exit(1);
}

console.log("Environment configuration looks valid.");
