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

Additional checks
  * CONFIG_ENCRYPTION_KEY is mandatory when APP_ENV=production, and every
    CONFIG_ENCRYPTION_KEY / CONFIG_ENCRYPTION_KEYS entry must decode to exactly
    32 bytes. The error includes the generation command.
  * AI_* is optional and has no separate on/off switch: the API derives
    "configured" from AI_BASE_URL + AI_MODEL. All three endpoint values empty
    means AI stays off (the endpoints answer 503 AI_NOT_CONFIGURED, which is
    not a startup failure); AI_BASE_URL set without AI_MODEL fails the
    preflight so the runtime cannot silently disagree with it.
  * PLACES_*, GEOAPIFY_* and MEDIA_* are optional; invalid values are reported.
    Errors name the variable and never print its value.

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
const VALID_AI_PROTOCOLS = ["openai-chat", "openai-responses", "anthropic-messages"] as const;
const VALID_PLACES_PROVIDERS = ["geoapify", "photon"] as const;
const TRUE_VALUES = ["true", "1", "yes", "on"] as const;
const FALSE_VALUES = ["false", "0", "no", "off"] as const;

const ENCRYPTION_GENERATION_COMMAND = "Generate a key with: openssl rand -base64 32";

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
  "CONFIG_ENCRYPTION_KEY",
  "CONFIG_ENCRYPTION_KEYS",
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
  "AI_API_KEY",
  "GEOAPIFY_API_KEY",
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

/**
 * Optional integer knob. Empty values keep the application default, so only
 * an explicit out-of-range value is an error.
 */
const checkIntegerOption = (key: string, minimum: number, maximum: number, unit: string): void => {
  const raw = env[key]?.trim();
  if (!raw) return;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    errors.push(`${key} must be an integer between ${minimum} and ${maximum} (${unit}).`);
  }
};

const isFlagEnabled = (raw: string | undefined): boolean =>
  raw !== undefined && (TRUE_VALUES as readonly string[]).includes(raw.trim().toLowerCase());

const isBooleanFlag = (raw: string): boolean => {
  const normalized = raw.trim().toLowerCase();
  return (
    (TRUE_VALUES as readonly string[]).includes(normalized) ||
    (FALSE_VALUES as readonly string[]).includes(normalized)
  );
};

/**
 * Settings encryption is a production blocker: without a valid key the first
 * secret save in Admin settings fails, and a key generated on the fly would
 * make ciphertext unreadable after a restart. Validate every configured value
 * and require the singular key when APP_ENV=production. Messages never echo the
 * key material.
 */
const checkEncryptionKey = (): void => {
  const singular = env.CONFIG_ENCRYPTION_KEY?.trim() ?? "";
  const ring = (env.CONFIG_ENCRYPTION_KEYS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!singular && ring.length === 0) {
    if (env.APP_ENV?.trim() === "production") {
      errors.push(
        `CONFIG_ENCRYPTION_KEY is required when APP_ENV=production: secrets saved in Admin settings cannot be encrypted without it. ${ENCRYPTION_GENERATION_COMMAND}`,
      );
    } else {
      warnings.push(
        `CONFIG_ENCRYPTION_KEY is not set; saving a secret in Admin settings will fail with SETTINGS_ENCRYPTION_UNAVAILABLE. ${ENCRYPTION_GENERATION_COMMAND}`,
      );
    }
    return;
  }

  const entries = [
    ...ring.map((key, index) => ({ label: `CONFIG_ENCRYPTION_KEYS entry ${index + 1}`, key })),
    ...(singular ? [{ label: "CONFIG_ENCRYPTION_KEY", key: singular }] : []),
  ];

  for (const entry of entries) {
    const decoded = Buffer.from(entry.key, "base64");
    // Buffer.from(..., "base64") ignores invalid characters, so compare the
    // canonical round-trip before trusting the byte length.
    if (decoded.length !== 32 || decoded.toString("base64") !== entry.key) {
      errors.push(
        `${entry.label} must be a base64-encoded 32-byte value (the value is not printed). ${ENCRYPTION_GENERATION_COMMAND}`,
      );
    }
  }
};

/**
 * Provider cutover is explicit in production. Development/test may omit the
 * variable and fall back to legacy, but a misspelled value must never boot.
 */
const checkProviderConfigMode = (): void => {
  const raw = env.PROVIDER_CONFIG_MODE?.trim().toLowerCase() ?? "";
  if (!raw) {
    if (env.APP_ENV?.trim() === "production") {
      errors.push(
        "PROVIDER_CONFIG_MODE is required when APP_ENV=production; set legacy, shadow, or v2 explicitly.",
      );
    } else {
      warnings.push(
        "PROVIDER_CONFIG_MODE is not set; development/test defaults to legacy. Set it explicitly before a provider cutover.",
      );
    }
    return;
  }
  if (!["legacy", "shadow", "v2"].includes(raw)) {
    errors.push("PROVIDER_CONFIG_MODE must be one of legacy, shadow, or v2.");
  }
};

/**
 * AI is opt-in and the runtime has exactly one definition of “configured”:
 * `AI_BASE_URL && AI_MODEL`, which is also what turns the endpoints into 503
 * AI_NOT_CONFIGURED. There is deliberately no preflight-only switch — a flag
 * the API does not read can say “off” while the API keeps calling and billing
 * the provider. The preflight validates the same pair:
 *
 * - all three endpoint values empty: AI stays off, warn only (supported);
 * - AI_BASE_URL set: AI_MODEL becomes mandatory, otherwise exit 1;
 * - AI_BASE_URL empty with a leftover key/model: inert, warn only.
 */
const checkAiSettings = (): void => {
  const baseUrl = env.AI_BASE_URL?.trim() ?? "";
  const apiKey = env.AI_API_KEY?.trim() ?? "";
  const model = env.AI_MODEL?.trim() ?? "";

  // Checked before the "AI is off" early returns: a typo here is exactly the
  // trap this preflight exists for — the operator believes image input is on
  // while the runtime (which defaults to false) silently ignores the value.
  const visionRaw = env.AI_VISION_SUPPORTED?.trim();
  if (visionRaw && !isBooleanFlag(visionRaw)) {
    errors.push(
      "AI_VISION_SUPPORTED must be true or false (true/1/yes/on or false/0/no/off); leave it empty to use the default (false).",
    );
  }

  const protocol = env.AI_PROTOCOL?.trim().toLowerCase();
  if (protocol && !(VALID_AI_PROTOCOLS as readonly string[]).includes(protocol)) {
    errors.push(`AI_PROTOCOL must be one of ${VALID_AI_PROTOCOLS.join(", ")}.`);
  }

  if (!baseUrl && !apiKey && !model) {
    warnings.push(
      "AI is not configured (AI_BASE_URL/AI_API_KEY/AI_MODEL are all empty). The AI endpoints answer 503 AI_NOT_CONFIGURED; this is a supported deployment.",
    );
    return;
  }

  if (!baseUrl) {
    warnings.push(
      "AI_BASE_URL is empty, so the API treats AI as unconfigured and ignores AI_API_KEY/AI_MODEL. Empty them too, or set AI_BASE_URL and AI_MODEL together.",
    );
    return;
  }

  if (!model) {
    errors.push(
      "AI_MODEL is required when AI_BASE_URL is set: the API derives `configured` from AI_BASE_URL+AI_MODEL, so this deployment would answer 503 AI_NOT_CONFIGURED while a provider endpoint stays configured. Set the model id, or empty AI_BASE_URL/AI_API_KEY/AI_MODEL to turn AI off.",
    );
  }

  checkUrls(["AI_BASE_URL"]);
  checkIntegerOption("AI_TIMEOUT_MS", 5_000, 120_000, "milliseconds");
  checkIntegerOption("AI_MAX_OUTPUT_TOKENS", 256, 32_000, "tokens");
  checkIntegerOption("AI_DAILY_QUOTA", 0, 100_000, "plan runs per user per day");
};

/**
 * Geoapify without a key degrades to Photon; disabling the fallback on top of
 * that would leave place search with no provider at all.
 */
const checkPlacesSettings = (): void => {
  const provider = env.PLACES_PROVIDER?.trim().toLowerCase();
  if (provider && !(VALID_PLACES_PROVIDERS as readonly string[]).includes(provider)) {
    errors.push(`PLACES_PROVIDER must be one of ${VALID_PLACES_PROVIDERS.join(", ")}.`);
  }

  const fallbackRaw = env.PLACES_FALLBACK_TO_PHOTON?.trim();
  if (fallbackRaw && !isBooleanFlag(fallbackRaw)) {
    errors.push("PLACES_FALLBACK_TO_PHOTON must be true or false.");
  }

  checkIntegerOption("GEOAPIFY_DAILY_LIMIT", 0, 1_000_000, "requests per UTC day");

  const effectiveProvider = provider || "geoapify";
  if (effectiveProvider === "geoapify" && !env.GEOAPIFY_API_KEY?.trim()) {
    const fallbackEnabled = fallbackRaw === undefined || isFlagEnabled(fallbackRaw);
    const detail =
      "GEOAPIFY_API_KEY is empty, so Geoapify search is skipped. Set the key, or set PLACES_PROVIDER=photon.";
    if (fallbackEnabled) {
      warnings.push(`${detail} Photon fallback is enabled.`);
    } else {
      errors.push(
        `${detail} PLACES_FALLBACK_TO_PHOTON=false would leave place search with no provider.`,
      );
    }
  }
};

const checkMediaCompression = (): void => {
  const keepRaw = env.MEDIA_KEEP_ORIGINAL?.trim();
  if (keepRaw && !isBooleanFlag(keepRaw)) {
    errors.push("MEDIA_KEEP_ORIGINAL must be true or false.");
  }
  checkIntegerOption("MEDIA_MAX_EDGE", 320, 8_192, "pixels");
  checkIntegerOption("MEDIA_QUALITY", 1, 100, "percent");
  checkIntegerOption("MEDIA_TARGET_BYTES", 100_000, 50_000_000, "bytes");
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

// Deployment-wide checks, independent of the preflight mode. Encryption is a
// hard production requirement; AI, Places and media compression are optional
// features that only fail when explicitly enabled with an unusable value.
checkEncryptionKey();
checkProviderConfigMode();
checkAiSettings();
checkPlacesSettings();
checkMediaCompression();

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
