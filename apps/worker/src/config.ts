import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export interface WorkerConfig {
  redisUrl: string;
  redisPrefix: string;
  logLevel: string;
  environmentFile?: string;
}

function candidateEnvironmentFiles(): string[] {
  const explicit = process.env.ROAMLOG_ENV_FILE;
  if (explicit) {
    return [resolve(explicit)];
  }

  const cwd = process.cwd();
  return [
    resolve(cwd, ".env.local"),
    resolve(cwd, "../../.env.local"),
    resolve(cwd, ".env"),
    resolve(cwd, "../../.env"),
  ];
}

/**
 * Loads a local env file without overwriting variables supplied by the runtime
 * environment. Production deployments should provide configuration directly.
 */
export function loadLocalEnvironment(): string | undefined {
  if (process.env.NODE_ENV === "production" && !process.env.ROAMLOG_ENV_FILE) {
    return undefined;
  }

  const file = candidateEnvironmentFiles().find((candidate) => existsSync(candidate));
  if (!file) {
    return undefined;
  }

  const parsed = parseEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
  return file;
}

export function readWorkerConfig(environmentFile?: string): WorkerConfig {
  return {
    redisUrl: process.env.REDIS_URL?.trim() || "redis://localhost:6379",
    redisPrefix: process.env.REDIS_PREFIX?.trim() || "roamlog",
    logLevel: process.env.LOG_LEVEL?.trim() || "info",
    environmentFile,
  };
}
