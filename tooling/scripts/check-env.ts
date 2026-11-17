import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type EnvMap = Record<string, string>;

const requiredKeys = [
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

const placeholderFragments = [
  "replace-with",
  "local_placeholder",
  "changeme",
  "your-",
  "example.com",
];

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

const root = process.cwd();
const envFile = [".env.local", ".env"].map((name) => resolve(root, name)).find(existsSync);
const fileEnv = envFile ? parseEnvFile(envFile) : {};
const env: EnvMap = { ...fileEnv, ...process.env } as EnvMap;
const errors: string[] = [];
const warnings: string[] = [];

for (const key of requiredKeys) {
  if (!env[key]?.trim()) errors.push(`Missing required environment variable: ${key}`);
}

const secret = env.BETTER_AUTH_SECRET ?? "";
if (secret && secret.length < 32) {
  errors.push("BETTER_AUTH_SECRET must contain at least 32 characters.");
}

const databaseUrl = env.DATABASE_URL ?? "";
if (databaseUrl && !/^postgres(ql)?:\/\//u.test(databaseUrl)) {
  errors.push("DATABASE_URL must be a PostgreSQL connection string.");
}

const redisUrl = env.REDIS_URL ?? "";
if (redisUrl && !/^rediss?:\/\//u.test(redisUrl)) {
  errors.push("REDIS_URL must be a redis:// or rediss:// URL.");
}

for (const key of ["APP_URL", "ADMIN_URL", "API_URL", "S3_ENDPOINT"] as const) {
  const value = env[key];
  if (!value) continue;
  try {
    new URL(value);
  } catch {
    errors.push(`${key} must be a valid URL.`);
  }
}

const ttl = Number(env.EXPORT_SIGNED_URL_TTL);
if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 86_400) {
  errors.push("EXPORT_SIGNED_URL_TTL must be an integer between 1 and 86400 seconds.");
}

const nodeEnv = env.NODE_ENV ?? "development";
if (nodeEnv !== "production") {
  for (const key of requiredKeys) {
    const value = env[key] ?? "";
    if (placeholderFragments.some((fragment) => value.includes(fragment))) {
      warnings.push(`${key} still contains a local placeholder value.`);
    }
  }
}

if (nodeEnv === "production") {
  if (env.DEMO_SEED_ENABLED === "true") {
    errors.push("DEMO_SEED_ENABLED must not be true in production.");
  }
  if (secret && placeholderFragments.some((fragment) => secret.includes(fragment))) {
    errors.push("BETTER_AUTH_SECRET must not use a placeholder in production.");
  }
}

if (envFile) {
  console.log(`Loaded environment from ${envFile}`);
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log("Environment configuration looks valid.");
