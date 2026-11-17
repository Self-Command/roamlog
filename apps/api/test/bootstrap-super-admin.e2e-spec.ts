import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createPrismaClient } from "@roamlog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.ROAMLOG_STAGING_SERVICES === "1";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRoot = resolve(repoRoot, "apps/api");
const databaseRoot = resolve(repoRoot, "packages/db");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const prismaSchema = resolve(databaseRoot, "prisma/schema.prisma");
const databaseUrl =
  process.env.ROAMLOG_STAGING_BOOTSTRAP_DATABASE_URL ??
  "postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=staging_bootstrap_e2e";
const databaseSchema = new URL(databaseUrl).searchParams.get("schema")?.trim() || "public";
if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(databaseSchema)) {
  throw new Error("The bootstrap E2E database schema name is invalid.");
}
const mailpitUrl = (
  process.env.ROAMLOG_STAGING_MAILPIT_URL ??
  process.env.MAILPIT_URL ??
  "http://127.0.0.1:8025"
).replace(/\/+$/u, "");
const appUrl = "http://127.0.0.1:3000";
const adminUrl = "http://127.0.0.1:3001";
const authSecret = "roamlog-staging-bootstrap-e2e-secret-at-least-32-bytes";
const apiStartupTimeoutMs = 60_000;
const cliTimeoutMs = 30_000;

interface ApiResponse {
  status: number;
  json: Record<string, unknown>;
  setCookies: string[];
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

interface MailpitMessageDetail extends MailpitMessageSummary {
  Text: string;
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.replaceAll("=", "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let buffer = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error("The TOTP URI contained an invalid base32 secret.");
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

function currentTotp(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 30_000);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBytes).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

function cookieHeader(setCookies: readonly string[]): string {
  return setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie): cookie is string => Boolean(cookie))
    .join("; ");
}

function parseJsonObject(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The bootstrap CLI did not return valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The bootstrap CLI returned an unexpected JSON payload.");
  }
  return parsed as Record<string, unknown>;
}

function redactDiagnostic(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "postgresql://[redacted]")
    .replace(/[?&]token=[^&\s]+/giu, "?token=[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu, "[redacted-token]")
    .slice(0, 2_000);
}

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("Could not reserve a loopback port for the bootstrap E2E API."));
        return;
      }
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

async function waitForApi(apiUrl: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + apiStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`The bootstrap E2E API exited before readiness (${process.exitCode}).`);
    }
    try {
      const response = await fetch(`${apiUrl}/v1/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The listener may not be bound yet.
    }
    await sleep(200);
  }
  throw new Error("The bootstrap E2E API did not become ready before the timeout.");
}

function runBootstrapCli(
  environment: NodeJS.ProcessEnv,
  email: string,
  extraArguments: string[] = [],
): Promise<CliResult> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/bootstrap-admin.ts", "--email", email, ...extraArguments],
      {
        cwd: apiRoot,
        env: {
          ...environment,
          BOOTSTRAP_SUPER_ADMIN_EMAIL: email,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectResult(new Error("The bootstrap CLI did not finish before the timeout."));
    }, cliTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectResult(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      resolveResult({ status, stdout, stderr });
    });
  });
}

async function callApi(
  apiUrl: string,
  path: string,
  input: {
    body?: Record<string, unknown>;
    cookie?: string;
  } = {},
): Promise<ApiResponse> {
  const headers = new Headers({
    origin: appUrl,
  });
  if (input.body) {
    headers.set("content-type", "application/json");
  }
  if (input.cookie) {
    headers.set("cookie", input.cookie);
  }

  const response = await fetch(`${apiUrl}/v1/auth${path}`, {
    method: "POST",
    headers,
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? parseJsonObject(text) : {},
    setCookies: response.headers.getSetCookie(),
  };
}

async function waitForMailpitMessages(
  recipient: string,
  subjects: readonly string[],
): Promise<Map<string, MailpitMessageDetail>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`);
    if (!response.ok) {
      throw new Error(`Mailpit message list failed with HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as { messages?: MailpitMessageSummary[] };
    const matchingSummaries = new Map<string, MailpitMessageSummary>();
    for (const message of payload.messages ?? []) {
      if (
        message.To.some((address) => address.Address.toLowerCase() === recipient) &&
        subjects.includes(message.Subject)
      ) {
        matchingSummaries.set(message.Subject, message);
      }
    }

    if (subjects.every((subject) => matchingSummaries.has(subject))) {
      const details = new Map<string, MailpitMessageDetail>();
      for (const subject of subjects) {
        const summary = matchingSummaries.get(subject);
        if (!summary) {
          throw new Error("A Mailpit message disappeared while collecting delivery evidence.");
        }
        const detailResponse = await fetch(
          `${mailpitUrl}/api/v1/message/${encodeURIComponent(summary.ID)}`,
        );
        if (!detailResponse.ok) {
          throw new Error(`Mailpit message detail failed with HTTP ${detailResponse.status}.`);
        }
        details.set(subject, (await detailResponse.json()) as MailpitMessageDetail);
      }
      return details;
    }
    await sleep(200);
  }
  throw new Error(
    `Mailpit did not receive all expected bootstrap messages: ${subjects.join(", ")}`,
  );
}

function requiredMessageLink(text: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(text);
  if (!match?.[0]) {
    throw new Error(`The bootstrap email did not contain the ${label} link.`);
  }
  return match[0];
}

async function stopProcess(process: ChildProcess | undefined): Promise<void> {
  if (!process || process.exitCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolveExit) => {
    process.once("exit", () => resolveExit());
  });
  process.kill("SIGTERM");
  const timeout = setTimeout(() => {
    if (process.exitCode === null) {
      process.kill("SIGKILL");
    }
  }, 5_000);
  await exited;
  clearTimeout(timeout);
}

describe.skipIf(!enabled)("super_admin bootstrap against PostgreSQL, Mailpit, and TOTP", () => {
  const email = `bootstrap-super-admin-${randomUUID()}@roamlog.test`;
  const password = `Roamlog-${randomUUID()}-Aa1!`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let apiProcess: ChildProcess | undefined;
  let apiUrl = "";
  let bootstrapEnvironment: NodeJS.ProcessEnv;

  beforeAll(async () => {
    if (!existsSync(prismaCli) || !existsSync(prismaSchema)) {
      throw new Error("The Prisma CLI or bootstrap E2E schema path is unavailable.");
    }

    const migration = spawnSync(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--schema", prismaSchema],
      {
        cwd: databaseRoot,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        encoding: "utf8",
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Prisma migrate deploy failed (exit ${String(migration.status)}): ${redactDiagnostic(
          migration.stderr || migration.stdout,
        )}`,
      );
    }

    prisma = createPrismaClient({ connectionString: databaseUrl });
    await prisma.$queryRaw`SELECT 1`;

    const apiPort = await reservePort();
    apiUrl = `http://127.0.0.1:${apiPort}`;
    bootstrapEnvironment = {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      API_PORT: String(apiPort),
      APP_URL: appUrl,
      ADMIN_URL: adminUrl,
      API_URL: apiUrl,
      CORS_ORIGINS: `${appUrl},${adminUrl}`,
      DATABASE_URL: databaseUrl,
      REDIS_URL: "redis://127.0.0.1:6379",
      REDIS_PREFIX: `roamlog:bootstrap-e2e:${randomUUID()}`,
      RATE_LIMIT_WINDOW_SECONDS: "60",
      AUTH_RATE_LIMIT_MAX: "100",
      PUBLIC_SHARE_RATE_LIMIT_MAX: "60",
      PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX: "20",
      MEDIA_PRESIGN_RATE_LIMIT_MAX: "20",
      BETTER_AUTH_SECRET: authSecret,
      BETTER_AUTH_URL: apiUrl,
      ADMIN_2FA_ENFORCED: "true",
      TRUST_PROXY: "false",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "roamlog-bootstrap-e2e",
      S3_ACCESS_KEY: "bootstrap-e2e",
      S3_SECRET_KEY: "bootstrap-e2e-secret",
      S3_REGION: "us-east-1",
      S3_FORCE_PATH_STYLE: "true",
      SENTRY_TRACES_SAMPLE_RATE: "0",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      RESEND_API_KEY: "",
      EMAIL_FROM: "Roamlog <bootstrap-e2e@roamlog.local>",
      EXPORT_SIGNED_URL_TTL: "900",
    };

    apiProcess = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: apiRoot,
      env: bootstrapEnvironment,
      stdio: ["ignore", "ignore", "ignore"],
    });
    await waitForApi(apiUrl, apiProcess);
  }, 120_000);

  afterAll(async () => {
    await stopProcess(apiProcess);
    await prisma?.$disconnect();
  }, 30_000);

  it("creates an invitation, delivers mail, verifies email, resets the password, enrolls TOTP, promotes once, and no-ops", async () => {
    const createdInvitation = await runBootstrapCli(bootstrapEnvironment, email, ["--force"]);
    expect(createdInvitation.status, "invitation bootstrap exit code").toBe(0);
    const invitation = parseJsonObject(createdInvitation.stdout);
    expect(invitation.status).toBe("invitation_sent");
    expect(invitation.platformRole).toBe("user");
    expect(invitation.emailVerified).toBe(false);
    expect(invitation.secondFactorRequired).toBe(true);
    expect(invitation.superAdminPromoted).toBe(false);
    expect(invitation.invitationComplete).toBe(true);
    expect(invitation.deliveredTemplates).toEqual(["auth.verify-email", "auth.reset-password"]);
    expect(createdInvitation.stdout).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./u);
    expect(createdInvitation.stdout).not.toMatch(/(?:password|token)=/iu);

    const invitedUser = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: {
        id: true,
        emailVerified: true,
        platformRole: true,
        twoFactorEnabled: true,
        status: true,
        accounts: {
          where: { providerId: "credential" },
          select: { password: true },
        },
        twoFactors: {
          select: { verified: true },
        },
      },
    });
    expect(invitedUser.emailVerified).toBe(false);
    expect(invitedUser.platformRole).toBe("user");
    expect(invitedUser.twoFactorEnabled).toBe(false);
    expect(invitedUser.status).toBe("active");
    expect(invitedUser.accounts).toHaveLength(1);
    expect(invitedUser.accounts[0]?.password).toBeTruthy();
    expect(invitedUser.twoFactors).toHaveLength(0);

    const messages = await waitForMailpitMessages(email, [
      "验证你的 Roamlog 邮箱",
      "重置你的 Roamlog 密码",
    ]);
    const verificationMessage = messages.get("验证你的 Roamlog 邮箱");
    const resetMessage = messages.get("重置你的 Roamlog 密码");
    if (!verificationMessage || !resetMessage) {
      throw new Error("Mailpit did not return both bootstrap messages.");
    }
    const verificationUrl = requiredMessageLink(
      verificationMessage.Text,
      /https?:\/\/[^\s<>"']+\/v1\/auth\/verify-email\?[^\s<>"']+/u,
      "email verification",
    );
    const resetCallbackUrl = requiredMessageLink(
      resetMessage.Text,
      /https?:\/\/[^\s<>"']+\/v1\/auth\/reset-password\/[^\s<>"']+/u,
      "password reset",
    );

    const verificationResponse = await fetch(verificationUrl, {
      redirect: "manual",
      headers: { origin: appUrl },
    });
    expect([200, 302, 303, 307, 308], "email verification status").toContain(
      verificationResponse.status,
    );
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { email },
        select: { emailVerified: true, platformRole: true },
      }),
    ).resolves.toEqual({ emailVerified: true, platformRole: "user" });

    const resetCallbackResponse = await fetch(resetCallbackUrl, {
      redirect: "manual",
      headers: { origin: appUrl },
    });
    expect([302, 303, 307, 308], "password reset callback status").toContain(
      resetCallbackResponse.status,
    );
    const resetLocation = resetCallbackResponse.headers.get("location");
    if (!resetLocation) {
      throw new Error("The password reset callback did not return a redirect location.");
    }
    const resetRedirect = new URL(resetLocation);
    expect(resetRedirect.origin).toBe(appUrl);
    const resetToken = resetRedirect.searchParams.get("token");
    expect(resetToken).toBeTruthy();

    const reset = await callApi(apiUrl, "/reset-password", {
      body: {
        token: resetToken,
        newPassword: password,
      },
    });
    expect(reset.status, "password reset status").toBe(200);

    const blockedPromotion = await runBootstrapCli(bootstrapEnvironment, email, ["--force"]);
    expect(blockedPromotion.status, "pre-TOTP promotion exit code").toBe(1);
    expect(blockedPromotion.stderr).toMatch(/verified TOTP factor/iu);
    expect(blockedPromotion.stderr).not.toContain(email);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { email },
        select: { platformRole: true },
      }),
    ).resolves.toEqual({ platformRole: "user" });

    const signIn = await callApi(apiUrl, "/sign-in/email", {
      body: {
        email,
        password,
        rememberMe: true,
      },
    });
    expect(signIn.status, "password sign-in status").toBe(200);
    expect(signIn.json.twoFactorRedirect).not.toBe(true);
    const sessionCookie = cookieHeader(signIn.setCookies);
    expect(sessionCookie).toContain("roamlog.session_token=");

    const enable = await callApi(apiUrl, "/two-factor/enable", {
      cookie: sessionCookie,
      body: {
        password,
        method: "totp",
      },
    });
    expect(enable.status, "TOTP enrollment status").toBe(200);
    const totpUri = enable.json.totpURI;
    if (typeof totpUri !== "string") {
      throw new Error("Better Auth did not return a TOTP URI.");
    }
    const totpSecret = new URL(totpUri).searchParams.get("secret");
    expect(totpSecret).toBeTruthy();
    if (!totpSecret) {
      throw new Error("The TOTP URI did not include a secret.");
    }
    expect(Array.isArray(enable.json.backupCodes)).toBe(true);
    expect(enable.json.backupCodes).not.toHaveLength(0);

    await expect(
      prisma.twoFactor.findFirstOrThrow({
        where: { user: { email } },
        select: { verified: true },
      }),
    ).resolves.toEqual({ verified: false });

    let verification = await callApi(apiUrl, "/two-factor/verify-totp", {
      cookie: sessionCookie,
      body: { code: currentTotp(totpSecret) },
    });
    if (verification.status === 401) {
      await sleep(1_500);
      verification = await callApi(apiUrl, "/two-factor/verify-totp", {
        cookie: sessionCookie,
        body: { code: currentTotp(totpSecret) },
      });
    }
    expect(verification.status, "TOTP verification status").toBe(200);

    const verifiedState = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: {
        id: true,
        emailVerified: true,
        platformRole: true,
        twoFactorEnabled: true,
        accounts: {
          where: { providerId: "credential" },
          select: { password: true },
        },
        twoFactors: {
          select: {
            secret: true,
            backupCodes: true,
            verified: true,
            lockedUntil: true,
          },
        },
      },
    });
    expect(verifiedState.emailVerified).toBe(true);
    expect(verifiedState.platformRole).toBe("user");
    expect(verifiedState.twoFactorEnabled).toBe(true);
    expect(verifiedState.accounts[0]?.password).not.toBe(password);
    expect(verifiedState.twoFactors).toHaveLength(1);
    expect(verifiedState.twoFactors[0]).toMatchObject({
      verified: true,
      lockedUntil: null,
    });
    expect(verifiedState.twoFactors[0]?.secret).toBeTruthy();
    expect(verifiedState.twoFactors[0]?.secret).not.toBe(totpSecret);
    expect(verifiedState.twoFactors[0]?.backupCodes).toBeTruthy();

    const promotionRuns = await Promise.all([
      runBootstrapCli(bootstrapEnvironment, email, ["--force"]),
      runBootstrapCli(bootstrapEnvironment, email, ["--force"]),
    ]);
    expect(promotionRuns.map((run) => run.status)).toEqual([0, 0]);
    const promotionStatuses = promotionRuns.map((run) => parseJsonObject(run.stdout).status);
    expect(promotionStatuses.toSorted()).toEqual(["already_bootstrapped", "promoted"]);
    expect(promotionRuns.every((run) => !/eyJ[A-Za-z0-9_-]{20,}\./u.test(run.stdout))).toBe(true);

    const promotedState = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: {
        id: true,
        emailVerified: true,
        platformRole: true,
        twoFactorEnabled: true,
        twoFactors: {
          select: { verified: true },
        },
      },
    });
    expect(promotedState).toMatchObject({
      emailVerified: true,
      platformRole: "super_admin",
      twoFactorEnabled: true,
    });
    expect(promotedState.twoFactors).toEqual([{ verified: true }]);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        targetId: promotedState.id,
        action: {
          in: ["admin.bootstrap_account_created", "admin.bootstrap_super_admin"],
        },
      },
      select: { action: true, actorType: true, metadata: true },
      orderBy: { createdAt: "asc" },
    });
    expect(auditLogs.map((audit) => audit.action)).toEqual([
      "admin.bootstrap_account_created",
      "admin.bootstrap_super_admin",
    ]);
    expect(auditLogs.every((audit) => audit.actorType === "system")).toBe(true);
    expect(auditLogs[1]?.metadata).toMatchObject({
      previousRole: "user",
      forced2fa: true,
    });

    const emailLogs = await prisma.emailLog.findMany({
      where: { to: email },
      select: { template: true, status: true, providerId: true },
      orderBy: { createdAt: "asc" },
    });
    expect(emailLogs.map((log) => log.template)).toEqual([
      "auth.verify-email",
      "auth.reset-password",
    ]);
    expect(emailLogs.every((log) => log.status === "sent")).toBe(true);
    expect(emailLogs.every((log) => Boolean(log.providerId))).toBe(true);

    const noOp = await runBootstrapCli(bootstrapEnvironment, email, ["--force"]);
    expect(noOp.status, "idempotent rerun exit code").toBe(0);
    expect(parseJsonObject(noOp.stdout)).toMatchObject({
      status: "already_bootstrapped",
      platformRole: "super_admin",
      secondFactorRequired: true,
      passwordChanged: false,
    });
    await expect(
      prisma.auditLog.count({
        where: {
          targetId: promotedState.id,
          action: "admin.bootstrap_super_admin",
        },
      }),
    ).resolves.toBe(1);

    const isolatedRows = await prisma.$queryRawUnsafe<
      Array<{
        emailVerified: boolean;
        platformRole: string;
        twoFactorEnabled: boolean;
      }>
    >(
      `SELECT "emailVerified", "platformRole"::text, "twoFactorEnabled" FROM "${databaseSchema}"."User" WHERE "email" = $1`,
      email,
    );
    expect(isolatedRows).toEqual([
      {
        emailVerified: true,
        platformRole: "super_admin",
        twoFactorEnabled: true,
      },
    ]);
    await expect(
      prisma.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "public"."User" WHERE "email" = $1',
        email,
      ),
    ).resolves.toEqual([]);

    console.info(
      JSON.stringify({
        status: "bootstrap_e2e_passed",
        userId: promotedState.id,
        mailpitMessageIds: [verificationMessage.ID, resetMessage.ID],
        emailTemplates: emailLogs.map((log) => log.template),
        auditActions: auditLogs.map((audit) => audit.action),
        idempotentRerun: "already_bootstrapped",
      }),
    );
  }, 180_000);
});
