#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateRawSync } from "node:zlib";

const TASK_ID = "STG-FULL-CHAIN";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../..");
const e2eRoot = join(repoRoot, "e2e", "staging-full");
const evidenceRoot = join(e2eRoot, "evidence");
const artifactsRoot = join(e2eRoot, "artifacts");
const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const runArtifacts = join(artifactsRoot, "runs", runId);
const pgDataDirectory = join(runArtifacts, "pgdata");
const startedAt = new Date();

const { values: options } = parseArgs({
  options: {
    "keep-runtime": { type: "boolean", default: false },
    "keep-objects": { type: "boolean", default: false },
  },
});
const keepRuntime =
  options["keep-runtime"] ||
  ["1", "true", "yes", "on"].includes(
    process.env.STAGING_FULL_KEEP_RUNTIME?.trim().toLowerCase() ?? "",
  );
const keepObjects =
  options["keep-objects"] ||
  ["1", "true", "yes", "on"].includes(
    process.env.STAGING_FULL_KEEP_OBJECTS?.trim().toLowerCase() ?? "",
  );

mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(runArtifacts, { recursive: true });

const localEnvironment = readLocalEnvironment();
const config = buildConfig();
const evidence = {
  taskId: TASK_ID,
  status: "running",
  runId,
  startedAt: startedAt.toISOString(),
  finishedAt: null,
  durationMs: null,
  environment: {
    apiPort: config.apiPort,
    postgresPort: config.pgPort,
    postgresSchema: config.schema,
    postgresEngine: null,
    redisPrefix: config.redisPrefix,
    redisUrl: config.redisUrl,
    s3Endpoint: config.s3.endpoint,
    s3Bucket: config.s3.bucket,
    mailpitUrl: config.mailpitUrl,
    artifactsDirectory: toWorkspacePath(runArtifacts),
  },
  checks: {},
  cleanup: {},
  notExecuted: [
    "Resend or external SMTP delivery (Mailpit is the local sink)",
    "Production TLS, OAuth, object-storage IAM, or cross-host networking",
    "Docker-managed PostgreSQL/MinIO services (this run uses local binaries and an isolated database)",
    "Desktop/mobile UI verification (this task exercises backend and worker paths)",
  ],
};

let postgresStarted = false;
let dbClient;
let apiProcess;
let workerProcess;
const cleanupKeys = new Set();
const cleanupObjects = [];

function log(message, context) {
  const suffix = context === undefined ? "" : ` ${JSON.stringify(context)}`;
  console.log(`[${TASK_ID}] ${message}${suffix}`);
}

function readLocalEnvironment() {
  const candidates = [
    process.env.ROAMLOG_ENV_FILE,
    join(repoRoot, ".env.local"),
    join(repoRoot, ".env"),
  ].filter(Boolean);
  const environmentFile = candidates.find((candidate) => existsSync(candidate));
  if (!environmentFile) {
    return {};
  }
  return parseEnv(readFileSync(environmentFile, "utf8"));
}

function setting(name, fallback) {
  return process.env[name]?.trim() || localEnvironment[name]?.trim() || fallback;
}

function settingInt(name, fallback) {
  const value = Number(setting(name, String(fallback)));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function buildConfig() {
  const apiPort = settingInt("STAGING_FULL_API_PORT", 4300);
  const pgPort = settingInt("STAGING_FULL_PG_PORT", 55439);
  const redisPrefix = `staging-full-${runId}`;
  const pgUser = "roamlog";
  const pgDatabase = `roamlog_${runId.replaceAll("-", "_")}`;
  const schema = "public";
  return {
    apiPort,
    apiUrl: `http://127.0.0.1:${apiPort}`,
    pgPort,
    pgUser,
    pgDatabase,
    schema,
    databaseUrl: `postgresql://${pgUser}@127.0.0.1:${pgPort}/${pgDatabase}?schema=${schema}`,
    redisUrl: setting("STAGING_FULL_REDIS_URL", "redis://127.0.0.1:6379"),
    redisPrefix,
    s3: {
      endpoint: setting("STAGING_FULL_S3_ENDPOINT", "http://127.0.0.1:9000").replace(/\/+$/, ""),
      bucket: setting("STAGING_FULL_S3_BUCKET", "roamlog-test"),
      accessKey: setting("S3_ACCESS_KEY", setting("MINIO_ROOT_USER", "roamlog")),
      secretKey: setting("S3_SECRET_KEY", setting("MINIO_ROOT_PASSWORD", "roamlog-local-secret")),
      region: setting("S3_REGION", "us-east-1"),
    },
    mailpitUrl: setting("STAGING_FULL_MAILPIT_URL", "http://127.0.0.1:8025").replace(/\/+$/, ""),
    smtpPort: settingInt("STAGING_FULL_SMTP_PORT", settingInt("MAILPIT_SMTP_PORT", 1025)),
    authSecret: randomBytes(48).toString("hex"),
    appUrl: "http://127.0.0.1:3000",
    adminUrl: "http://127.0.0.1:3001",
    emailFrom: "Roamlog Staging Full <staging-full@roamlog.test>",
    ownerEmail: `staging-full-${runId}-owner@roamlog.test`,
    emailTarget: `staging-full-${runId}-worker@roamlog.test`,
    ownerPassword: "Roamlog-Full-Chain-Aa1!",
  };
}

function runLogged(command, args, options = {}) {
  const logPath = options.logPath ?? join(runArtifacts, "command.log");
  mkdirSync(dirname(logPath), { recursive: true });
  const descriptor = openSync(logPath, "a");
  try {
    const result = spawnSync(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      encoding: "utf8",
      shell: options.shell ?? false,
      stdio: ["ignore", descriptor, descriptor],
      timeout: options.timeoutMs ?? 180_000,
      windowsHide: true,
    });
    if (result.error) {
      throw new Error(`${command} ${args.join(" ")} failed to launch: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `${command} ${args.join(" ")} exited ${result.status}; see ${toWorkspacePath(logPath)}`,
      );
    }
    return result;
  } finally {
    closeSync(descriptor);
  }
}

function toWorkspacePath(filePath) {
  return filePath.startsWith(repoRoot)
    ? filePath.slice(repoRoot.length + 1).replaceAll("\\", "/")
    : filePath;
}

function sanitize(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, "postgresql://[redacted]@")
    .replace(/(Set-Cookie:\s*)[^\r\n]+/giu, "$1[redacted]")
    .replace(/(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s]+/giu, "$1[redacted]")
    .replace(/("?(?:secret|password|token|apiKey)"?\s*[:=]\s*"?)[^",\s}]+/giu, "$1[redacted]");
}

function recordCheck(name, value) {
  evidence.checks[name] = value;
  saveEvidence();
}

function saveEvidence() {
  const output = {
    ...evidence,
    finishedAt: evidence.finishedAt ?? new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
  };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  writeFileSync(join(evidenceRoot, `staging-full-chain-${runId}.json`), json);
  writeFileSync(join(evidenceRoot, "latest.json"), json);
}

function tail(logPath, maximum = 6000) {
  if (!existsSync(logPath)) {
    return "";
  }
  const content = readFileSync(logPath, "utf8");
  return sanitize(content.slice(-maximum));
}

function checkPortFree(port, label) {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      reject(new Error(`${label} port ${port} is unavailable: ${error.code ?? error.message}`));
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolvePromise());
    });
  });
}

function checkTcp(port) {
  return new Promise((resolvePromise) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(1_500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

async function checkHttp(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function serviceHealth() {
  const [redis, minioHttp, minioPort, mailpitHttp, smtp] = await Promise.all([
    checkTcp(new URL(config.redisUrl).port ? Number(new URL(config.redisUrl).port) : 6379),
    checkHttp(`${config.s3.endpoint}/minio/health/live`),
    checkTcp(Number(new URL(config.s3.endpoint).port || 9000)),
    checkHttp(`${config.mailpitUrl}/livez`),
    checkTcp(config.smtpPort),
  ]);
  return {
    redis,
    minio: minioHttp && minioPort,
    mailpit: mailpitHttp && smtp,
  };
}

async function ensureServices() {
  let health = await serviceHealth();
  let restarted = false;
  if (!health.redis || !health.minio || !health.mailpit) {
    log("Staging services are not fully healthy; attempting one idempotent start.", health);
    runLogged(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        join(repoRoot, "tooling", "services", "staging-services.ps1"),
        "-Action",
        "start",
      ],
      {
        shell: true,
        timeoutMs: 180_000,
        logPath: join(runArtifacts, "staging-services.log"),
      },
    );
    restarted = true;
    health = await serviceHealth();
  }
  if (!health.redis || !health.minio || !health.mailpit) {
    throw new Error(
      `Staging services are unhealthy after one start attempt: ${JSON.stringify(health)}`,
    );
  }
  recordCheck("stagingServices", { ...health, restarted });
}

function locatePostgresBinaries() {
  const configured = process.env.ROAMLOG_PG_BIN?.trim();
  const candidates = [
    configured,
    join(
      repoRoot,
      ".data",
      "bootstrap-e2e",
      "node_modules",
      "@embedded-postgres",
      "windows-x64",
      "native",
      "bin",
    ),
    join(repoRoot, ".data", "postgres", "bin"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const directory = isAbsolute(candidate) ? candidate : resolve(repoRoot, candidate);
    if (existsSync(join(directory, "initdb.exe")) && existsSync(join(directory, "pg_ctl.exe"))) {
      return directory;
    }
  }
  throw new Error(
    "PostgreSQL binaries were not found. Set ROAMLOG_PG_BIN to a directory containing initdb.exe and pg_ctl.exe.",
  );
}

async function waitForPostgres() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const client = new (loadPg().Client)({
        host: "127.0.0.1",
        port: config.pgPort,
        user: config.pgUser,
        database: "postgres",
      });
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`PostgreSQL did not become ready on port ${config.pgPort}`);
}

function loadPg() {
  const requireFromDb = createRequire(join(repoRoot, "packages", "db", "package.json"));
  return requireFromDb("pg");
}

async function startPostgres() {
  await checkPortFree(config.pgPort, "PostgreSQL");
  const pgBin = locatePostgresBinaries();
  const initdb = join(pgBin, "initdb.exe");
  const pgCtl = join(pgBin, "pg_ctl.exe");
  const initLog = join(runArtifacts, "postgres-init.log");
  const serverLog = join(runArtifacts, "postgres.log");

  log("Initializing an isolated PostgreSQL cluster.", { port: config.pgPort });
  runLogged(
    initdb,
    ["-D", pgDataDirectory, "-U", config.pgUser, "--auth=trust", "--encoding=UTF8", "--no-locale"],
    { timeoutMs: 120_000, logPath: initLog },
  );
  runLogged(
    pgCtl,
    [
      "-D",
      pgDataDirectory,
      "-l",
      serverLog,
      "-o",
      `-p ${config.pgPort} -h 127.0.0.1`,
      "-w",
      "start",
    ],
    { timeoutMs: 60_000, logPath: join(runArtifacts, "postgres-start.log") },
  );
  postgresStarted = true;
  await waitForPostgres();

  const { Client } = loadPg();
  const adminClient = new Client({
    host: "127.0.0.1",
    port: config.pgPort,
    user: config.pgUser,
    database: "postgres",
  });
  await adminClient.connect();
  try {
    const version = await adminClient.query("SELECT version() AS version");
    evidence.environment.postgresEngine = version.rows[0]?.version ?? null;
    const exists = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      config.pgDatabase,
    ]);
    if (exists.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE "${config.pgDatabase}"`);
    }
  } finally {
    await adminClient.end();
  }
  recordCheck("postgres", {
    status: "started",
    port: config.pgPort,
    dataDirectory: toWorkspacePath(pgDataDirectory),
  });
}

function migrate() {
  log("Applying Prisma migrations to the isolated database.", {
    database: config.pgDatabase,
    schema: config.schema,
  });
  const environment = buildDatabaseEnvironment();
  const preSchemaClientPath = join(runArtifacts, "prisma-migrate.log");
  runLogged("pnpm", ["--filter", "@roamlog/db", "exec", "prisma", "migrate", "deploy"], {
    env: environment,
    shell: true,
    timeoutMs: 180_000,
    logPath: preSchemaClientPath,
  });
  recordCheck("migrations", {
    status: "applied",
    command: "pnpm --filter @roamlog/db exec prisma migrate deploy",
    log: toWorkspacePath(preSchemaClientPath),
  });
}

function buildDatabaseEnvironment() {
  return {
    ...process.env,
    DATABASE_URL: config.databaseUrl,
  };
}

async function connectDatabase() {
  const { Client } = loadPg();
  dbClient = new Client({ connectionString: config.databaseUrl });
  await dbClient.connect();
  await dbClient.query(`SET search_path TO "${config.schema}"`);
  const searchPath = await dbClient.query(
    "SELECT current_schema() AS schema, current_setting('search_path') AS search_path",
  );
  evidence.databaseSession = searchPath.rows[0];
}

function startNodeProcess(name, cwd, entrypoint, environment) {
  const stdoutPath = join(runArtifacts, `${name}.stdout.log`);
  const stderrPath = join(runArtifacts, `${name}.stderr.log`);
  const stdout = openSync(stdoutPath, "a");
  const stderr = openSync(stderrPath, "a");
  const child = spawn(process.execPath, ["--import", "tsx", entrypoint], {
    cwd,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  });
  closeSync(stdout);
  closeSync(stderr);
  const entry = {
    name,
    child,
    stdoutPath,
    stderrPath,
    exitCode: null,
  };
  child.once("exit", (code, signal) => {
    entry.exitCode = code;
    entry.signal = signal;
  });
  return entry;
}

function apiEnvironment() {
  return {
    ...process.env,
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    API_PORT: String(config.apiPort),
    API_URL: config.apiUrl,
    APP_URL: config.appUrl,
    ADMIN_URL: config.adminUrl,
    CORS_ORIGINS: `${config.appUrl},${config.adminUrl}`,
    DATABASE_URL: config.databaseUrl,
    REDIS_URL: config.redisUrl,
    REDIS_PREFIX: config.redisPrefix,
    BETTER_AUTH_SECRET: config.authSecret,
    BETTER_AUTH_URL: config.apiUrl,
    ADMIN_2FA_ENFORCED: "false",
    S3_ENDPOINT: config.s3.endpoint,
    S3_BUCKET: config.s3.bucket,
    S3_ACCESS_KEY: config.s3.accessKey,
    S3_SECRET_KEY: config.s3.secretKey,
    S3_REGION: config.s3.region,
    S3_FORCE_PATH_STYLE: "true",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(config.smtpPort),
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: config.emailFrom,
    EXPORT_SIGNED_URL_TTL: "900",
    SENTRY_TRACES_SAMPLE_RATE: "0",
  };
}

function workerEnvironment() {
  return {
    ...apiEnvironment(),
    NODE_ENV: "test",
    EMAIL_PROVIDER: "mailpit",
    MAILPIT_URL: config.mailpitUrl,
  };
}

async function waitForApiReady(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;
  let lastBody;
  while (Date.now() < deadline) {
    if (apiProcess?.exitCode !== null) {
      throw new Error(
        `API exited during startup (${apiProcess.exitCode}). stderr: ${tail(
          apiProcess.stderrPath,
        )}`,
      );
    }
    try {
      const response = await fetch(`${config.apiUrl}/v1/ready`, {
        signal: AbortSignal.timeout(5_000),
      });
      lastStatus = response.status;
      lastBody = await response.text();
      if (response.ok) {
        const payload = JSON.parse(lastBody);
        if (payload.status === "ok") {
          recordCheck("apiReadiness", {
            status: "ok",
            httpStatus: response.status,
            checks: payload.checks,
          });
          return;
        }
      }
    } catch (error) {
      lastBody = error instanceof Error ? error.message : String(error);
    }
    await sleep(750);
  }
  throw new Error(
    `API readiness timed out (last HTTP ${lastStatus ?? "n/a"}): ${sanitize(lastBody ?? "")}`,
  );
}

async function waitForWorkerReady(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (workerProcess?.exitCode !== null) {
      throw new Error(
        `Worker exited during startup (${workerProcess.exitCode}). stderr: ${tail(
          workerProcess.stderrPath,
        )}`,
      );
    }
    const stdout = existsSync(workerProcess.stdoutPath)
      ? readFileSync(workerProcess.stdoutPath, "utf8")
      : "";
    if (stdout.includes('"event":"worker.ready"') || stdout.includes("worker runtime ready")) {
      recordCheck("worker", {
        status: "ready",
        stdout: toWorkspacePath(workerProcess.stdoutPath),
        stderr: toWorkspacePath(workerProcess.stderrPath),
      });
      return;
    }
    await sleep(500);
  }
  throw new Error(`Worker readiness timed out. stdout: ${tail(workerProcess.stdoutPath)}`);
}

async function rawRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { response, payload, text };
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("Accept", "application/json");
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.cookie) {
    headers.set("Cookie", options.cookie);
  }
  const result = await rawRequest(`${config.apiUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!result.response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${result.response.status}: ${sanitize(
        result.text.slice(0, 2_000),
      )}`,
    );
  }
  return result;
}

function cookieFromResponse(response) {
  const cookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return cookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function createAuthenticatedUser() {
  log("Creating the owner through the real Better Auth HTTP endpoint.");
  const signUp = await rawRequest(`${config.apiUrl}/v1/auth/sign-up/email`, {
    method: "POST",
    headers: {
      Origin: config.appUrl,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: config.ownerEmail,
      password: config.ownerPassword,
      name: "Staging Full Chain Owner",
    }),
  });
  if (!signUp.response.ok) {
    throw new Error(
      `Better Auth sign-up returned ${signUp.response.status}: ${sanitize(
        signUp.text.slice(0, 2_000),
      )}`,
    );
  }

  const verified = await dbClient.query(
    `UPDATE "User"
       SET "emailVerified" = true, "platformRole" = 'admin'
       WHERE email = $1
       RETURNING id, email, "platformRole", "emailVerified"`,
    [config.ownerEmail],
  );
  if (verified.rowCount !== 1) {
    throw new Error("The sign-up user was not found in the real PostgreSQL schema.");
  }

  const signIn = await rawRequest(`${config.apiUrl}/v1/auth/sign-in/email`, {
    method: "POST",
    headers: {
      Origin: config.appUrl,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: config.ownerEmail,
      password: config.ownerPassword,
      rememberMe: true,
    }),
  });
  const cookie = cookieFromResponse(signIn.response);
  if (!signIn.response.ok || !cookie) {
    throw new Error(
      `Better Auth sign-in returned ${signIn.response.status} without a usable session cookie.`,
    );
  }

  const user = verified.rows[0];
  recordCheck("auth", {
    status: "authenticated",
    signUpHttpStatus: signUp.response.status,
    signInHttpStatus: signIn.response.status,
    userId: user.id,
    emailVerified: user.emailVerified,
    platformRole: user.platformRole,
    sessionCookie: "[present]",
  });
  return { user, cookie };
}

function uuidV7() {
  const bytes = randomBytes(16);
  let timestamp = BigInt(Date.now());
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

async function seedFixtures(user) {
  const scope = {
    workspaceId: uuidV7(),
    tripId: uuidV7(),
    entryId: uuidV7(),
    itineraryId: uuidV7(),
    packingId: uuidV7(),
    expenseId: uuidV7(),
    emailLogId: uuidV7(),
  };
  const workspaceSlug = `staging-full-${runId}`;

  await dbClient.query("BEGIN");
  await dbClient.query(
    `INSERT INTO "Workspace"
       (id, name, slug, "ownerId", "settings", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
    [
      scope.workspaceId,
      "Roamlog Full Chain",
      workspaceSlug,
      user.id,
      JSON.stringify({ source: "staging-full-chain" }),
    ],
  );
  await dbClient.query(
    `INSERT INTO "WorkspaceMember"
       (id, "workspaceId", "userId", role, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'owner', 'active', NOW(), NOW())`,
    [uuidV7(), scope.workspaceId, user.id],
  );
  await dbClient.query(
    `INSERT INTO "Trip"
       (id, "workspaceId", title, summary, status, "startDate", "endDate",
        origin, destinations, "countryCodes", tags, "guestNames", visibility,
        version, "createdById", "updatedById", "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, $4, 'planning', $5::date, $6::date,
        'Shanghai', ARRAY['Kyoto', 'Osaka'], ARRAY['JP'], ARRAY['staging', 'full-chain'],
        ARRAY[]::text[], 'workspace', 1, $7, $7, NOW(), NOW())`,
    [
      scope.tripId,
      scope.workspaceId,
      "Roamlog Full Chain Kyoto",
      "A deterministic staging trip for queue-to-worker evidence.",
      "2026-11-20",
      "2026-11-24",
      user.id,
    ],
  );
  await dbClient.query(
    `INSERT INTO "JournalEntry"
       (id, "tripId", "workspaceId", title, date, location, "contentJson",
        "contentHtml", excerpt, tags, version, "createdById", "updatedById",
        "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, $4, $5::date, 'Kyoto', $6::jsonb, $7, $8,
        ARRAY['staging'], 1, $9, $9, NOW(), NOW())`,
    [
      scope.entryId,
      scope.tripId,
      scope.workspaceId,
      "Arashiyama before the crowds",
      "2026-11-21",
      JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "The bamboo grove at sunrise." }],
          },
        ],
      }),
      "<p>The bamboo grove at sunrise.</p>",
      "The bamboo grove at sunrise.",
      user.id,
    ],
  );
  await dbClient.query(
    `INSERT INTO "ItineraryItem"
       (id, "tripId", "workspaceId", date, "startTime", "endTime", title, type,
        location, notes, done, "order", version, "createdById", "updatedById",
        "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, $4::date, '07:30', '09:00', 'Bamboo grove walk', 'activity',
        'Arashiyama', 'Arrive before 08:00.', false, 0, 1, $5, $5, NOW(), NOW())`,
    [scope.itineraryId, scope.tripId, scope.workspaceId, "2026-11-21", user.id],
  );
  await dbClient.query(
    `INSERT INTO "PackingItem"
       (id, "workspaceId", "tripId", category, name, quantity, packed, "order",
        version, "createdById", "updatedById", "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'gear', 'Camera battery', 2, false, 0, 1, $4, $4, NOW(), NOW())`,
    [scope.packingId, scope.workspaceId, scope.tripId, user.id],
  );
  await dbClient.query(
    `INSERT INTO "Expense"
       (id, "workspaceId", "tripId", date, category, note, "amountMinor",
        currency, "paidById", "splitMode", "createdById", "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, $4::date, 'food', 'Breakfast near the river', 1800,
        'JPY', $5, 'equal', $5, NOW(), NOW())`,
    [scope.expenseId, scope.workspaceId, scope.tripId, "2026-11-21", user.id],
  );
  await dbClient.query(
    `INSERT INTO "EmailLog"
       (id, "userId", "to", template, subject, status, "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'verify-email', 'Staging worker email job', 'sent', NOW(), NOW())`,
    [scope.emailLogId, user.id, config.emailTarget],
  );
  await dbClient.query("COMMIT");

  recordCheck("fixtures", {
    status: "seeded",
    workspaceId: scope.workspaceId,
    tripId: scope.tripId,
    journalEntryId: scope.entryId,
    emailLogId: scope.emailLogId,
  });
  return scope;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(body), 8 + data.length);
  return chunk;
}

function createTestPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 3 + 1;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      pixels[offset] = Math.round((x / Math.max(1, width - 1)) * 255);
      pixels[offset + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      pixels[offset + 2] = ((x * 7 + y * 11) % 256) | 0;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function waitFor(check, predicate, timeoutMs, label, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} timed out; last value: ${sanitize(JSON.stringify(lastValue))}`);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function putObject(uploadUrl, headers, bytes) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers,
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `Presigned PUT returned ${response.status}: ${sanitize(
        (await response.text()).slice(0, 1_000),
      )}`,
    );
  }
  return response.status;
}

async function runMediaFlow(cookie, scope) {
  log("Running media presign, failure retry, worker variants, and signed reads.");
  const validPng = createTestPng(1_600, 900);
  const invalidBytes = Buffer.from(
    "This is deliberately not an image; it exercises worker retry.",
    "utf8",
  );
  const presign = await apiRequest(`/v1/workspaces/${scope.workspaceId}/media/presign`, {
    method: "POST",
    cookie,
    body: {
      tripId: scope.tripId,
      fileName: "full-chain.png",
      mimeType: "image/png",
      size: validPng.length,
      width: 1_600,
      height: 900,
      caption: "Staging full-chain image",
      date: "2026-11-21",
      location: "Kyoto",
    },
  });
  const upload = presign.payload;
  if (!upload?.uploadUrl?.includes("X-Amz-Signature=")) {
    throw new Error("The presign response did not contain a signed upload URL.");
  }

  const mediaId = upload.mediaId;
  const firstPutStatus = await putObject(upload.uploadUrl, upload.headers, invalidBytes);
  const completion = await apiRequest(`/v1/media/${mediaId}/complete`, {
    method: "POST",
    cookie,
    body: { size: invalidBytes.length, width: 1_600, height: 900 },
  });
  if (completion.payload?.status !== "processing") {
    throw new Error(
      `Unexpected first completion status: ${completion.payload?.status ?? "missing"}`,
    );
  }

  const failed = await waitFor(
    async () => {
      const result = await dbClient.query(`SELECT status, error FROM "Media" WHERE id = $1`, [
        mediaId,
      ]);
      return result.rows[0];
    },
    (row) => row?.status === "failed",
    30_000,
    "media first-attempt failure",
  );
  recordCheck("mediaFailure", {
    status: failed.status,
    error: failed.error,
  });

  const retryPutStatus = await putObject(upload.uploadUrl, upload.headers, validPng);
  const ready = await waitFor(
    async () => {
      const result = await dbClient.query(
        `SELECT status, width, height, blurhash, error, variants
         FROM "Media" WHERE id = $1`,
        [mediaId],
      );
      return result.rows[0];
    },
    (row) => row?.status === "ready",
    60_000,
    "media worker retry success",
    500,
  );

  if (!ready.blurhash || ready.blurhash.length < 10) {
    throw new Error("The worker completed without a blurhash.");
  }
  const variantNames = Object.keys(ready.variants ?? {}).sort();
  const expectedVariants = [
    "large",
    "largeJpeg",
    "medium",
    "mediumJpeg",
    "original",
    "thumb",
    "thumbJpeg",
  ];
  if (JSON.stringify(variantNames) !== JSON.stringify(expectedVariants)) {
    throw new Error(`Unexpected media variants: ${JSON.stringify(variantNames)}`);
  }

  const mediaList = await apiRequest(`/v1/trips/${scope.tripId}/media`, {
    cookie,
  });
  const media = mediaList.payload.items?.find((item) => item.id === mediaId);
  if (!media) {
    throw new Error("The completed media was not returned by the real API.");
  }
  const signedOriginalUrl = media.variants?.original?.url;
  const signedThumbUrl = media.variants?.thumb?.url;
  if (
    typeof signedOriginalUrl !== "string" ||
    !signedOriginalUrl.includes("X-Amz-Signature=") ||
    typeof signedThumbUrl !== "string"
  ) {
    throw new Error("The API did not return signed media read URLs.");
  }
  const originalResponse = await fetch(signedOriginalUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  const originalBytes = Buffer.from(await originalResponse.arrayBuffer());
  if (originalResponse.status !== 200 || !originalBytes.equals(validPng)) {
    throw new Error("The signed original read did not match the retried upload.");
  }
  const thumbResponse = await fetch(signedThumbUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  const thumbBytes = Buffer.from(await thumbResponse.arrayBuffer());
  if (
    thumbResponse.status !== 200 ||
    thumbBytes.length === 0 ||
    !thumbResponse.headers.get("content-type")?.startsWith("image/webp")
  ) {
    throw new Error("The signed thumbnail read was not a WebP object.");
  }

  const mediaRow = await dbClient.query(`SELECT key, variants FROM "Media" WHERE id = $1`, [
    mediaId,
  ]);
  for (const value of Object.values(mediaRow.rows[0]?.variants ?? {})) {
    if (value && typeof value === "object" && typeof value.key === "string") {
      cleanupKeys.add(value.key);
    }
  }
  cleanupKeys.add(mediaRow.rows[0].key);
  const anonymousResponse = await fetch(anonymousObjectUrl(mediaRow.rows[0].key), {
    signal: AbortSignal.timeout(15_000),
  });
  if (![403, 404].includes(anonymousResponse.status)) {
    throw new Error(`Anonymous MinIO read was not denied (HTTP ${anonymousResponse.status}).`);
  }

  const idempotentCompletion = await apiRequest(`/v1/media/${mediaId}/complete`, {
    method: "POST",
    cookie,
    headers: {
      "Idempotency-Key": `media-complete-${runId}`,
    },
    body: { size: validPng.length, width: 1_600, height: 900 },
  });
  if (idempotentCompletion.payload?.status !== "ready") {
    throw new Error("The repeated media completion was not idempotent.");
  }

  const mediaJobs = await listAdminJobs(cookie, "media", "completed");
  const mediaJob = mediaJobs.filter((job) => job.data?.mediaId === mediaId);
  if (mediaJob.length !== 1) {
    throw new Error(
      `Expected one completed media job; got ${JSON.stringify(
        mediaJob.map((job) => ({ id: job.id, attempts: job.attempts })),
      )}`,
    );
  }
  const mediaJobEvents = readWorkerEvents().filter(
    (event) =>
      event.queue === "media" &&
      event.jobId === mediaJob[0].id &&
      ["job.active", "job.failed", "job.completed"].includes(event.event),
  );
  const activeAttempts = mediaJobEvents
    .filter((event) => event.event === "job.active")
    .map((event) => event.attempt);
  const failedAttempts = mediaJobEvents.filter((event) => event.event === "job.failed");
  const completedAttempts = mediaJobEvents.filter((event) => event.event === "job.completed");
  if (activeAttempts.length < 2 || failedAttempts.length < 1 || completedAttempts.length !== 1) {
    throw new Error(
      `Worker logs did not prove a failed-then-completed retry for ${mediaJob[0].id}: ${JSON.stringify(
        mediaJobEvents,
      )}`,
    );
  }

  recordCheck("media", {
    status: "ready",
    mediaId,
    initialPutHttpStatus: firstPutStatus,
    retryPutHttpStatus: retryPutStatus,
    failureWasObserved: true,
    automaticRetryJobId: mediaJob[0].id,
    automaticRetryAttemptsObserved: activeAttempts,
    automaticRetryFailedEventObserved: failedAttempts.length,
    automaticRetryCompletedEventObserved: completedAttempts.length,
    width: ready.width,
    height: ready.height,
    blurhashLength: ready.blurhash.length,
    variantNames,
    signedOriginalReadHttpStatus: originalResponse.status,
    originalSha256: hashBytes(validPng),
    originalRoundTrip: true,
    signedThumbnailReadHttpStatus: thumbResponse.status,
    signedThumbnailContentType: thumbResponse.headers.get("content-type"),
    anonymousReadHttpStatus: anonymousResponse.status,
    repeatedCompletionStatus: idempotentCompletion.payload.status,
    mediaJobCount: mediaJob.length,
  });
  return { mediaId, validPng, mediaJobId: mediaJob[0].id };
}

function readWorkerEvents() {
  if (!workerProcess?.stdoutPath || !existsSync(workerProcess.stdoutPath)) {
    return [];
  }
  return readFileSync(workerProcess.stdoutPath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === "object" ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function anonymousObjectUrl(key) {
  return `${config.s3.endpoint}/${encodeURIComponent(config.s3.bucket)}/${key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

async function listAdminJobs(cookie, queue, status) {
  const result = await apiRequest(
    `/v1/admin/jobs?queue=${encodeURIComponent(queue)}&status=${encodeURIComponent(
      status,
    )}&limit=100`,
    { cookie },
  );
  return result.payload.items ?? [];
}

async function mailpitMessages() {
  const response = await rawRequest(`${config.mailpitUrl}/api/v1/messages`);
  if (!response.response.ok) {
    throw new Error(`Mailpit message listing returned ${response.response.status}.`);
  }
  return Array.isArray(response.payload?.messages) ? response.payload.messages : [];
}

async function runEmailFlow(cookie, scope) {
  log("Triggering an API email resend job and verifying Mailpit delivery.");
  const resend = await apiRequest(`/v1/admin/emails/${scope.emailLogId}/resend`, {
    method: "POST",
    cookie,
  });
  const queued = resend.payload;
  if (queued?.status !== "queued") {
    throw new Error(
      `Admin email resend did not create a queued EmailLog: ${JSON.stringify(queued)}`,
    );
  }

  const sent = await waitFor(
    async () => {
      const result = await dbClient.query(
        `SELECT id, status, "providerId", subject, error
         FROM "EmailLog" WHERE id = $1`,
        [queued.id],
      );
      return result.rows[0];
    },
    (row) => row?.status === "sent",
    45_000,
    "worker email delivery",
    500,
  );

  const messages = await waitFor(
    async () => mailpitMessages(),
    (items) =>
      items.some(
        (message) =>
          message.ID === sent.providerId ||
          (message.Subject === sent.subject &&
            message.To?.some(
              (address) =>
                address.Address === config.emailTarget || address.Email === config.emailTarget,
            )),
      ),
    30_000,
    "Mailpit worker email",
    500,
  );
  const message = messages.find(
    (item) =>
      item.ID === sent.providerId ||
      (item.Subject === sent.subject &&
        item.To?.some(
          (address) =>
            address.Address === config.emailTarget || address.Email === config.emailTarget,
        )),
  );
  if (!message) {
    throw new Error("Mailpit retained no matching email job message.");
  }

  const emailJobs = await listAdminJobs(cookie, "email", "completed");
  const emailJob = emailJobs.filter((job) => job.data?.emailLogId === queued.id);
  if (emailJob.length !== 1) {
    throw new Error(`Expected one completed email job, found ${emailJob.length}.`);
  }

  recordCheck("email", {
    status: "sent",
    emailLogId: queued.id,
    emailJobId: emailJob[0].id,
    providerId: sent.providerId,
    providerIdMatchesMailpit: message.ID === sent.providerId,
    mailpitMessageId: message.ID,
    mailpitSubject: message.Subject,
    recipient: config.emailTarget,
    recipientWasRetained: true,
    mailboxTotal: messages.length,
  });
}

function unzipEntries(bytes) {
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) {
    throw new Error("ZIP end-of-central-directory record was not found.");
  }
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  let cursor = bytes.readUInt32LE(endOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central-directory entry at offset ${cursor}.`);
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (flags & 1) {
      throw new Error(`Encrypted ZIP entry is unsupported: ${name}`);
    }

    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for ${name}.`);
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);
    }
    if (data.length !== uncompressedSize) {
      throw new Error(`ZIP entry size mismatch for ${name}.`);
    }
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function runExportFlow(cookie, scope, media) {
  log("Running export request, worker ZIP generation, signed download, and TTL checks.");
  const idempotencyKey = `export-create-${runId}`;
  const body = {
    scope: "trip",
    tripId: scope.tripId,
    format: "zip",
    includeComments: false,
    includeExpenses: true,
    includeMedia: true,
  };
  const first = await apiRequest("/v1/exports", {
    method: "POST",
    cookie,
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });
  const repeated = await apiRequest("/v1/exports", {
    method: "POST",
    cookie,
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });
  if (first.payload?.id !== repeated.payload?.id) {
    throw new Error("Repeated export creation returned different export ids.");
  }
  const exportId = first.payload.id;

  const ready = await waitFor(
    async () => {
      const result = await dbClient.query(
        `SELECT id, status, "storageKey", error, "completedAt", "expiresAt"
         FROM "Export" WHERE id = $1`,
        [exportId],
      );
      return result.rows[0];
    },
    (row) => row?.status === "ready",
    90_000,
    "worker export completion",
    500,
  );
  if (!ready.storageKey || !ready.completedAt || !ready.expiresAt) {
    throw new Error("The completed export is missing storage or expiry metadata.");
  }

  const detail = await apiRequest(`/v1/exports/${exportId}`, { cookie });
  const exportDetail = detail.payload;
  const downloadUrl = exportDetail?.downloadUrl;
  if (
    exportDetail?.status !== "ready" ||
    typeof downloadUrl !== "string" ||
    !downloadUrl.includes("X-Amz-Signature=")
  ) {
    throw new Error("The real API did not return a signed export download URL.");
  }
  const ttlFromApi = Date.parse(exportDetail.expiresAt) - Date.parse(exportDetail.completedAt);
  const ttlFromDb = Number(
    (
      await dbClient.query(
        `SELECT EXTRACT(EPOCH FROM ("expiresAt" - "completedAt")) * 1000 AS ms
         FROM "Export" WHERE id = $1`,
        [exportId],
      )
    ).rows[0].ms,
  );
  if (ttlFromApi !== 7 * 24 * 60 * 60 * 1_000 || ttlFromDb !== ttlFromApi) {
    throw new Error(`Export TTL mismatch: API=${ttlFromApi}ms, DB=${ttlFromDb}ms.`);
  }

  const response = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  const zipBytes = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200 || zipBytes.length === 0) {
    throw new Error("The signed export download failed.");
  }
  const entries = unzipEntries(zipBytes);
  const required = [
    "trip.json",
    "journal.md",
    "itinerary.csv",
    "expenses.csv",
    "packing.csv",
    "README.txt",
    `photos/${media.mediaId}-original.png`,
  ];
  for (const name of required) {
    if (!entries.has(name)) {
      throw new Error(`ZIP is missing ${name}.`);
    }
  }
  const tripJson = JSON.parse(entries.get("trip.json").toString("utf8"));
  if (tripJson.title !== "Roamlog Full Chain Kyoto") {
    throw new Error("trip.json did not contain the seeded trip title.");
  }
  if (!entries.get("journal.md").toString("utf8").includes("Arashiyama before the crowds")) {
    throw new Error("journal.md did not include the seeded journal entry.");
  }
  const photo = entries.get(`photos/${media.mediaId}-original.png`);
  if (!photo.equals(media.validPng)) {
    throw new Error("The exported photo did not match the stored original.");
  }

  cleanupKeys.add(ready.storageKey);
  const anonymous = await fetch(anonymousObjectUrl(ready.storageKey), {
    signal: AbortSignal.timeout(15_000),
  });
  if (![403, 404].includes(anonymous.status)) {
    throw new Error(`Anonymous export object read was not denied (HTTP ${anonymous.status}).`);
  }

  const exportJobs = await listAdminJobs(cookie, "export", "completed");
  const exportJob = exportJobs.filter((job) => job.data?.exportId === exportId);
  if (exportJob.length !== 1) {
    throw new Error(`Expected one completed export job, found ${exportJob.length}.`);
  }

  recordCheck("export", {
    status: "ready",
    exportId,
    idempotentReplaySameId: true,
    exportJobId: exportJob[0].id,
    storageKey: ready.storageKey,
    signedDownloadHttpStatus: response.status,
    zipBytes: zipBytes.length,
    zipEntries: [...entries.keys()].sort(),
    pdf: "not-applicable",
    ttlMilliseconds: ttlFromApi,
    ttlDays: 7,
    expiresAt: exportDetail.expiresAt,
    completedAt: exportDetail.completedAt,
    photoRoundTrip: true,
    anonymousReadHttpStatus: anonymous.status,
  });
}

function loadS3Module() {
  const requireFromWorker = createRequire(join(repoRoot, "apps", "worker", "package.json"));
  return requireFromWorker("@aws-sdk/client-s3");
}

async function cleanupS3() {
  if (keepObjects || cleanupKeys.size === 0) {
    return;
  }
  const { S3Client, DeleteObjectCommand } = loadS3Module();
  const client = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.s3.accessKey,
      secretAccessKey: config.s3.secretKey,
    },
  });
  let deleted = 0;
  const failures = [];
  try {
    for (const key of cleanupKeys) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
        deleted += 1;
      } catch (error) {
        failures.push({
          key,
          error: sanitize(error instanceof Error ? error.message : String(error)),
        });
      }
    }
  } finally {
    client.destroy();
  }
  evidence.cleanup.s3 = {
    attempted: cleanupKeys.size,
    deleted,
    failures,
  };
}

async function cleanupRedis() {
  const requireFromWorker = createRequire(join(repoRoot, "apps", "worker", "package.json"));
  const imported = requireFromWorker("ioredis");
  const Redis = imported.default ?? imported;
  const client = new Redis(config.redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    connectionName: "staging-full-cleanup",
  });
  let deleted = 0;
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        "MATCH",
        `${config.redisPrefix}:*`,
        "COUNT",
        500,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await client.del(...keys);
      }
    } while (cursor !== "0");
  } finally {
    await client.quit().catch(() => client.disconnect());
  }
  evidence.cleanup.redis = {
    keyPrefix: config.redisPrefix,
    deletedKeys: deleted,
  };
}

async function stopChild(entry) {
  if (!entry || entry.exitCode !== null) {
    return;
  }
  entry.child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolvePromise) => entry.child.once("exit", () => resolvePromise(true))),
    sleep(8_000).then(() => false),
  ]);
  if (!exited && entry.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(entry.child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
  evidence.cleanup[`${entry.name}Termination`] = {
    exitCode: entry.child.exitCode,
    signalCode: entry.child.signalCode,
  };
}

async function stopPostgres() {
  if (!postgresStarted) {
    return;
  }
  const pgCtl = join(locatePostgresBinaries(), "pg_ctl.exe");
  runLogged(pgCtl, ["-D", pgDataDirectory, "-m", "fast", "-w", "stop"], {
    timeoutMs: 60_000,
    logPath: join(runArtifacts, "postgres-stop.log"),
  });
  postgresStarted = false;
}

function removeOwnedRuntime() {
  const resolvedArtifacts = resolve(runArtifacts);
  const allowedPrefix = `${resolve(artifactsRoot)}${process.platform === "win32" ? "\\" : "/"}`;
  if (!resolvedArtifacts.startsWith(allowedPrefix, process.platform === "win32" ? 0 : undefined)) {
    throw new Error(
      `Refusing to remove PostgreSQL data outside the staging-full artifacts root: ${resolvedArtifacts}`,
    );
  }
  if (!keepRuntime && existsSync(pgDataDirectory)) {
    rmSync(pgDataDirectory, { recursive: true, force: true });
  }
}

async function cleanup() {
  await stopChild(apiProcess);
  await stopChild(workerProcess);
  if (dbClient) {
    await dbClient.end().catch(() => undefined);
    dbClient = undefined;
  }
  await cleanupS3().catch((error) => {
    evidence.cleanup.s3 = {
      status: "failed",
      error: sanitize(error instanceof Error ? error.message : String(error)),
    };
  });
  await cleanupRedis().catch((error) => {
    evidence.cleanup.redis = {
      status: "failed",
      error: sanitize(error instanceof Error ? error.message : String(error)),
    };
  });
  await stopPostgres().catch((error) => {
    evidence.cleanup.postgres = {
      status: "stop_failed",
      error: sanitize(error instanceof Error ? error.message : String(error)),
    };
  });
  if (postgresStarted === false) {
    removeOwnedRuntime();
  }
}

async function main() {
  log("Starting isolated full-chain run.", {
    runId,
    apiPort: config.apiPort,
    postgresPort: config.pgPort,
    redisPrefix: config.redisPrefix,
  });

  await checkPortFree(config.apiPort, "API");
  await ensureServices();
  runLogged(process.execPath, [join(repoRoot, "tooling", "services", "bootstrap-bucket.mjs")], {
    env: {
      ...process.env,
      S3_ENDPOINT: config.s3.endpoint,
      S3_BUCKET: config.s3.bucket,
      S3_ACCESS_KEY: config.s3.accessKey,
      S3_SECRET_KEY: config.s3.secretKey,
      S3_REGION: config.s3.region,
      S3_FORCE_PATH_STYLE: "true",
      STAGING_TEST_BUCKET: config.s3.bucket,
    },
    timeoutMs: 60_000,
    logPath: join(runArtifacts, "bucket-bootstrap.log"),
  });
  recordCheck("bucket", {
    status: "ready",
    bucket: config.s3.bucket,
    log: "artifacts/runs/" + runId + "/bucket-bootstrap.log",
  });

  await startPostgres();
  migrate();
  await connectDatabase();
  const dbVersion = await dbClient.query("SELECT current_schema() AS schema, version() AS version");
  recordCheck("database", {
    status: "connected",
    schema: dbVersion.rows[0].schema,
    version: dbVersion.rows[0].version,
  });

  log("Starting real API and Worker processes.");
  apiProcess = startNodeProcess(
    "api",
    join(repoRoot, "apps", "api"),
    "src/main.ts",
    apiEnvironment(),
  );
  workerProcess = startNodeProcess(
    "worker",
    join(repoRoot, "apps", "worker"),
    "src/main.ts",
    workerEnvironment(),
  );
  await waitForApiReady();
  await waitForWorkerReady();

  const auth = await createAuthenticatedUser();
  const scope = await seedFixtures(auth.user);
  const media = await runMediaFlow(auth.cookie, scope);
  await runEmailFlow(auth.cookie, scope);
  await runExportFlow(auth.cookie, scope, media);

  evidence.status = "passed";
  recordCheck("queueBoundary", {
    status: "verified",
    apiIngress: "jobs:ingress",
    redisPrefix: config.redisPrefix,
    workerConsumers: ["media", "email", "export"],
  });
  log("All full-chain checks passed.", {
    evidence: `e2e/staging-full/evidence/staging-full-chain-${runId}.json`,
  });
}

main()
  .catch((error) => {
    evidence.status = "failed";
    evidence.error = sanitize(
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
    evidence.apiLogTail = apiProcess ? tail(apiProcess.stderrPath) : undefined;
    evidence.workerLogTail = workerProcess ? tail(workerProcess.stderrPath) : undefined;
    console.error(`[${TASK_ID}] FAILED: ${evidence.error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    evidence.finishedAt = new Date().toISOString();
    saveEvidence();
    await cleanup().catch((error) => {
      evidence.cleanup.error = sanitize(error instanceof Error ? error.message : String(error));
      evidence.status = "failed";
      saveEvidence();
      process.exitCode = 1;
    });
    saveEvidence();
    console.log(
      JSON.stringify(
        {
          status: evidence.status,
          runId,
          evidence: `e2e/staging-full/evidence/staging-full-chain-${runId}.json`,
          checks: Object.keys(evidence.checks),
        },
        null,
        2,
      ),
    );
  });
