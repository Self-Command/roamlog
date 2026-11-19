import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Integration coverage for `tooling/scripts/check-env.ts`.
 *
 * The preflight is a CLI with a `process.exit` contract, so the only honest
 * test is to spawn it. It lives under the Admin workspace because that is the
 * vitest runner wired into the repository scripts that owns these checks;
 * nothing in this file touches Admin runtime code.
 *
 * The regression it locks down: `AI_BASE_URL` set without `AI_MODEL` used to
 * be reported as fine (the removed `AI_ENABLED` switch said "off"), while the
 * API derives `configured` from `AI_BASE_URL && AI_MODEL` and would have
 * called the provider.
 */
const repoRoot = findRepoRoot(process.cwd());

function findRepoRoot(start: string): string {
  let directory = start;
  for (;;) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`workspace root not found above ${start}`);
    directory = parent;
  }
}

const REQUIRED_LOCAL_ENV = {
  DATABASE_URL: "postgresql://roamlog@127.0.0.1:5432/roamlog",
  REDIS_URL: "redis://127.0.0.1:6379",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef01234567",
  APP_URL: "http://127.0.0.1:3000",
  ADMIN_URL: "http://127.0.0.1:3001",
  API_URL: "http://127.0.0.1:4000",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_BUCKET: "roamlog-test",
  S3_ACCESS_KEY: "local-access-key",
  S3_SECRET_KEY: "local-secret-key",
  RESEND_API_KEY: "re_local_preflight_test",
  NEXT_PUBLIC_MAP_STYLE_URL: "https://tiles.example.test/style.json",
  NEXT_PUBLIC_GEOCODER_URL: "https://geo.example.test",
  EXPORT_SIGNED_URL_TTL: "900",
  BOOTSTRAP_SUPER_ADMIN_EMAIL: "admin@roamlog.test",
} as const;

function runCheckEnv(ai: Record<string, string>): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const emptyEnvFile = join(mkdtempSync(join(tmpdir(), "roamlog-check-env-")), "empty.env");
  writeFileSync(emptyEnvFile, "");
  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      join(repoRoot, "tooling", "scripts", "check-env.ts"),
      "--env-file",
      emptyEnvFile,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      // A blank --env-file keeps the run independent of the developer's
      // .env.local; process.env still overlays, so every AI value is explicit.
      env: { ...process.env, ...REQUIRED_LOCAL_ENV, ...ai },
      timeout: 60_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("check-env AI preflight", () => {
  it("fails when AI_BASE_URL is set without AI_MODEL", () => {
    const result = runCheckEnv({
      AI_BASE_URL: "https://ai.example.test/v1",
      AI_API_KEY: "",
      AI_MODEL: "",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AI_MODEL is required when AI_BASE_URL is set");
    // The same pair the API uses, spelled out so the operator can fix it.
    expect(result.stderr).toContain("AI_BASE_URL+AI_MODEL");
  }, 60_000);

  it("passes and explains 503 AI_NOT_CONFIGURED when the AI triple is empty", () => {
    const result = runCheckEnv({ AI_BASE_URL: "", AI_API_KEY: "", AI_MODEL: "" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Environment configuration looks valid.");
    expect(result.stderr).toContain(
      "AI is not configured (AI_BASE_URL/AI_API_KEY/AI_MODEL are all empty)",
    );
    expect(result.stderr).toContain("503 AI_NOT_CONFIGURED");
  }, 60_000);
});