import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  STAGING_AUTH_SECRET,
  STAGING_DATABASE_URL,
  STAGING_FIXTURE_FILE,
  STAGING_REDIS_PREFIX,
  STAGING_REDIS_URL,
  STAGING_ROOT,
  type StagingFixture,
} from "./env";

const FIXTURE_ENVIRONMENT = {
  ...process.env,
  DATABASE_URL: STAGING_DATABASE_URL,
  ROAMLOG_LIVE_DATABASE_URL: STAGING_DATABASE_URL,
  ROAMLOG_LIVE_AUTH_SECRET: STAGING_AUTH_SECRET,
  ROAMLOG_LIVE_FIXTURE_FILE: STAGING_FIXTURE_FILE,
  ROAMLOG_STAGING_FIXTURE_FILE: STAGING_FIXTURE_FILE,
  ROAMLOG_STAGING_REDIS_URL: STAGING_REDIS_URL,
  ROAMLOG_STAGING_REDIS_PREFIX: STAGING_REDIS_PREFIX,
};

export function runStagingFixtureScript(args: readonly string[] = []): string {
  const command = [
    "pnpm",
    "--filter",
    "@roamlog/api",
    "exec",
    "tsx",
    "../../tooling/scripts/e2e-auth-fixture.ts",
    ...args,
  ].join(" ");

  try {
    return execFileSync(
      process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
      {
        cwd: STAGING_ROOT,
        encoding: "utf8",
        env: FIXTURE_ENVIRONMENT,
        stdio: "pipe",
      },
    );
  } catch (error) {
    const stdout =
      typeof error === "object" && error !== null && "stdout" in error
        ? String(error.stdout ?? "")
        : "";
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr ?? "")
        : "";
    throw new Error(`Staging fixture failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`, {
      cause: error,
    });
  }
}

export function expireShareLink(shareLinkId: string): void {
  const command = [
    "pnpm",
    "--filter",
    "@roamlog/api",
    "exec",
    "tsx",
    "../../e2e/staging/mutate-share.ts",
    shareLinkId,
  ].join(" ");

  execFileSync(
    process.platform === "win32" ? "cmd.exe" : "/bin/sh",
    process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
    {
      cwd: STAGING_ROOT,
      encoding: "utf8",
      env: FIXTURE_ENVIRONMENT,
      stdio: "pipe",
    },
  );
}

export function writeStagingFixture(fixture: StagingFixture): void {
  mkdirSync(STAGING_ROOT + "/.e2e-live", { recursive: true });
  writeFileSync(STAGING_FIXTURE_FILE, `${JSON.stringify(fixture, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function readStagingFixture(): StagingFixture {
  return JSON.parse(readFileSync(STAGING_FIXTURE_FILE, "utf8")) as StagingFixture;
}

export function prepareStagingAdminOperations(): StagingFixture {
  runAdminOperationsCommand("seed");
  return readStagingFixture();
}

export function setStagingAdminRole(role: "admin" | "super_admin"): StagingFixture {
  runAdminOperationsCommand("role", role);
  return readStagingFixture();
}

export function readStagingRedisList(key: string): string[] {
  const executable =
    process.env.ROAMLOG_REDIS_CLI ??
    resolve(
      STAGING_ROOT,
      "tooling/services/runtime/bin/redis/Redis-8.10.3-Windows-x64-msys2/redis-cli.exe",
    );
  if (!existsSync(executable)) {
    throw new Error(
      `redis-cli.exe was not found at ${executable}. Set ROAMLOG_REDIS_CLI to inspect queued jobs.`,
    );
  }

  const connection = new URL(STAGING_REDIS_URL);
  const output = execFileSync(
    executable,
    [
      "-h",
      connection.hostname || "127.0.0.1",
      "-p",
      connection.port || "6379",
      "--raw",
      "LRANGE",
      `${STAGING_REDIS_PREFIX}:${key}`,
      "0",
      "-1",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  return output ? output.split(/\r?\n/u) : [];
}

function runAdminOperationsCommand(...args: string[]): string {
  const command = ["pnpm", "exec", "tsx", "e2e/staging/prepare-admin-operations.ts", ...args].join(
    " ",
  );

  try {
    return execFileSync(
      process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
      {
        cwd: STAGING_ROOT,
        encoding: "utf8",
        env: FIXTURE_ENVIRONMENT,
        stdio: "pipe",
      },
    );
  } catch (error) {
    const stdout =
      typeof error === "object" && error !== null && "stdout" in error
        ? String(error.stdout ?? "")
        : "";
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr ?? "")
        : "";
    throw new Error(`Staging Admin fixture failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`, {
      cause: error,
    });
  }
}
