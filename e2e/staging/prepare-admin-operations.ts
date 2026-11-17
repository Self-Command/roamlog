import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createPrismaClient } from "../../packages/db/src/client.js";
import type { StagingFixture } from "./env.js";

const ROOT = resolve(process.cwd());
const FIXTURE_FILE =
  process.env.ROAMLOG_STAGING_FIXTURE_FILE ?? resolve(ROOT, ".e2e-live/staging-fixture.json");
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=staging_release_gate";
const REDIS_URL = process.env.ROAMLOG_STAGING_REDIS_URL ?? "redis://127.0.0.1:6379";
const REDIS_PREFIX = process.env.ROAMLOG_STAGING_REDIS_PREFIX ?? "roamlog-staging-release";
const FLAG_KEY = "staging_release_gate";
const QUEUE_NAME = "email" as const;

function uuidV7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function readFixture(): StagingFixture {
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as StagingFixture;
}

function writeFixture(fixture: StagingFixture): void {
  writeFileSync(FIXTURE_FILE, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
}

function redisCliPath(): string {
  const candidates = [
    process.env.ROAMLOG_REDIS_CLI,
    resolve(
      ROOT,
      "tooling/services/runtime/bin/redis/Redis-8.10.3-Windows-x64-msys2/redis-cli.exe",
    ),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const discovered = execFileSync("where.exe", ["redis-cli.exe"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const path = discovered.split(/\r?\n/u)[0];
    if (path) {
      return path;
    }
  } catch {
    // Fall through to the actionable error below.
  }

  throw new Error(
    "redis-cli.exe was not found. Set ROAMLOG_REDIS_CLI to the real Redis CLI executable.",
  );
}

function redisConnection(): { host: string; port: string } {
  const parsed = new URL(REDIS_URL);
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port || "6379",
  };
}

function redis(args: readonly string[]): string {
  const connection = redisConnection();
  const output = execFileSync(
    redisCliPath(),
    ["-h", connection.host, "-p", connection.port, "--raw", ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return output.trim();
}

function clearIsolatedRedisPrefix(): void {
  const keys = redis(["--scan", "--pattern", `${REDIS_PREFIX}:*`])
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);

  for (let index = 0; index < keys.length; index += 100) {
    const batch = keys.slice(index, index + 100);
    if (batch.length > 0) {
      redis(["DEL", ...batch]);
    }
  }
}

async function setRole(role: string | undefined): Promise<void> {
  if (role !== "admin" && role !== "super_admin") {
    throw new Error("Role must be either admin or super_admin.");
  }
  const fixture = readFixture();
  const prisma = createPrismaClient({ connectionString: DATABASE_URL });
  try {
    await prisma.user.update({
      where: { id: fixture.admin.id },
      data: { platformRole: role },
    });
    writeFixture({
      ...fixture,
      admin: {
        ...fixture.admin,
        platformRole: role,
      },
    });
    console.log(JSON.stringify({ adminId: fixture.admin.id, role }));
  } finally {
    await prisma.$disconnect();
  }
}

async function seed(): Promise<void> {
  const fixture = readFixture();
  if (!fixture.journey?.tripId) {
    throw new Error(
      "The staging journey fixture must exist before Admin operations can be seeded.",
    );
  }

  clearIsolatedRedisPrefix();

  const prisma = createPrismaClient({ connectionString: DATABASE_URL });
  try {
    await prisma.user.update({
      where: { id: fixture.admin.id },
      data: { platformRole: "super_admin" },
    });
    await prisma.featureFlag.upsert({
      where: { key: FLAG_KEY },
      create: {
        key: FLAG_KEY,
        description: "Roamlog staging release-gate mutation probe.",
        enabled: false,
        rolloutPercentage: 0,
        rules: { workspaceAllowlist: [] },
        updatedById: fixture.admin.id,
      },
      update: {
        description: "Roamlog staging release-gate mutation probe.",
        enabled: false,
        rolloutPercentage: 0,
        rules: { workspaceAllowlist: [] },
        updatedById: fixture.admin.id,
      },
    });
    await prisma.emailLog.deleteMany({ where: { template: "staging.release-gate" } });
    const emailLog = await prisma.emailLog.create({
      data: {
        id: uuidV7(),
        to: fixture.target.email,
        template: "staging.release-gate",
        subject: `STG release-gate resend source ${fixture.runId}`,
        status: "delivered",
      },
    });

    const failedJobId = `release-gate-${fixture.runId}`;
    const timestamp = Date.now().toString();
    redis([
      "HSET",
      `${REDIS_PREFIX}:${QUEUE_NAME}:${failedJobId}`,
      "name",
      "email.send",
      "data",
      JSON.stringify({ source: "staging-release-gate", emailLogId: emailLog.id }),
      "timestamp",
      timestamp,
      "processedOn",
      timestamp,
      "finishedOn",
      timestamp,
      "attemptsMade",
      "2",
      "failedReason",
      "Injected staging release-gate failure for retry coverage.",
    ]);
    redis(["ZADD", `${REDIS_PREFIX}:${QUEUE_NAME}:failed`, timestamp, failedJobId]);

    const completed: StagingFixture = {
      ...fixture,
      admin: {
        ...fixture.admin,
        platformRole: "super_admin",
      },
      adminOperations: {
        flagKey: FLAG_KEY,
        emailLogId: emailLog.id,
        emailTo: emailLog.to,
        failedJobId,
        queueName: QUEUE_NAME,
        contentTripId: fixture.journey.tripId,
        contentTitle: fixture.journey.tripTitle,
      },
    };
    writeFixture(completed);
    console.log(
      JSON.stringify({
        flagKey: flagKeyForOutput(),
        emailLogId: emailLog.id,
        failedJobId,
        contentTripId: fixture.journey.tripId,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function flagKeyForOutput(): string {
  return FLAG_KEY;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "seed";
  if (command === "seed") {
    await seed();
    return;
  }
  if (command === "role") {
    await setRole(process.argv[3]);
    return;
  }
  throw new Error(`Unknown Admin operations command: ${command}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Admin fixture error.";
  console.error(message);
  process.exitCode = 1;
});
