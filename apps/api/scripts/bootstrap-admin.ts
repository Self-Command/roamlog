import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins/two-factor";
import { createPrismaClient } from "@roamlog/db";
import { z } from "zod";

import type { AppConfigService } from "../src/config/app-config.service.js";
import type { Environment } from "../src/config/environment.js";
import { loadEnvironmentFiles } from "../src/config/load-environment.js";
import { validateEnvironment } from "../src/config/environment.js";
import { buildAuthOptions } from "../src/modules/auth/auth-options.js";
import { assertBootstrapTwoFactorReady } from "../src/modules/auth/bootstrap-two-factor.js";
import { EmailDeliveryService } from "../src/modules/auth/email-delivery.service.js";
import type { PrismaService } from "../src/modules/prisma/prisma.service.js";

const emailSchema = z.email();
const nameSchema = z.string().trim().min(2).max(80);
const emailVerificationTemplate = "auth.verify-email";
const passwordResetTemplate = "auth.reset-password";

interface CliArguments {
  email?: string;
  name?: string;
  force: boolean;
  dryRun: boolean;
  help: boolean;
}

interface AuthHandler {
  handler(request: Request): Promise<Response>;
}

interface BootstrapEmailEvidence {
  deliveredTemplates: string[];
  failedTemplates: string[];
}

type PrismaClient = ReturnType<typeof createPrismaClient>;

function readArguments(): CliArguments {
  const rawArguments = [...process.argv.slice(2)];
  if (rawArguments[0] === "--") {
    rawArguments.shift();
  }
  const { values } = parseArgs({
    args: rawArguments,
    allowPositionals: false,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  return {
    ...(values.email ? { email: values.email } : {}),
    ...(values.name ? { name: values.name } : {}),
    force: values.force,
    dryRun: values["dry-run"],
    help: values.help,
  };
}

function fail(message: string): never {
  throw new Error(message);
}

function printHelp(): void {
  process.stdout.write(
    [
      "Roamlog one-time platform administrator bootstrap",
      "",
      "Usage:",
      "  pnpm admin:bootstrap -- --force [--email <address>] [--name <display name>]",
      "  pnpm admin:bootstrap -- --dry-run",
      "",
      "Safety:",
      "  - A missing account is created as a normal user with a generated,",
      "    non-disclosed credential and verification/password-reset emails.",
      "  - super_admin promotion requires a verified email and verified TOTP.",
      "  - Rerun the command after the operator enrolls TOTP.",
      "",
    ].join("\n"),
  );
}

function assertEmailProviderConfigured(environment: Environment): void {
  const smtpConfigured = Boolean(environment.SMTP_HOST?.trim());
  const resendConfigured = Boolean(
    environment.RESEND_API_KEY?.trim() &&
    !environment.RESEND_API_KEY.toLowerCase().includes("placeholder"),
  );

  if (!smtpConfigured && !resendConfigured) {
    fail(
      "Email delivery is not configured. Set SMTP_HOST for Mailpit/staging SMTP or a real RESEND_API_KEY before creating an invitation.",
    );
  }
}

function createConfigView(environment: Environment): AppConfigService {
  const view = {
    nodeEnv: environment.NODE_ENV,
    isProduction: environment.NODE_ENV === "production",
    logLevel: environment.LOG_LEVEL,
    apiPort: environment.API_PORT,
    appUrl: environment.APP_URL,
    adminUrl: environment.ADMIN_URL,
    apiUrl: environment.API_URL,
    corsOrigins: environment.CORS_ORIGINS,
    databaseUrl: environment.DATABASE_URL,
    redisUrl: environment.REDIS_URL,
    redisPrefix: environment.REDIS_PREFIX,
    betterAuthSecret: environment.BETTER_AUTH_SECRET,
    sessionCookieDomain: environment.SESSION_COOKIE_DOMAIN,
    betterAuthUrl: environment.BETTER_AUTH_URL ?? environment.API_URL,
    adminTwoFactorEnforced: environment.ADMIN_2FA_ENFORCED ?? environment.NODE_ENV === "production",
    googleClientId: environment.GOOGLE_CLIENT_ID,
    googleClientSecret: environment.GOOGLE_CLIENT_SECRET,
    githubClientId: environment.GITHUB_CLIENT_ID,
    githubClientSecret: environment.GITHUB_CLIENT_SECRET,
    trustProxy: environment.TRUST_PROXY,
    sentryDsn: environment.SENTRY_DSN,
    sentryTracesSampleRate: environment.SENTRY_TRACES_SAMPLE_RATE,
    smtpHost: environment.SMTP_HOST,
    smtpPort: environment.SMTP_PORT,
    smtpUser: environment.SMTP_USER,
    smtpPassword: environment.SMTP_PASSWORD,
    resendApiKey: environment.RESEND_API_KEY,
    emailFrom: environment.EMAIL_FROM,
    signedUrlTtlSeconds: environment.EXPORT_SIGNED_URL_TTL,
    bootstrapSuperAdminEmail: environment.BOOTSTRAP_SUPER_ADMIN_EMAIL,
    storageSettings: {
      endpoint: environment.S3_ENDPOINT,
      bucket: environment.S3_BUCKET,
      accessKey: environment.S3_ACCESS_KEY,
      secretKey: environment.S3_SECRET_KEY,
      region: environment.S3_REGION,
      forcePathStyle: environment.S3_FORCE_PATH_STYLE,
      signedUrlTtlSeconds: environment.EXPORT_SIGNED_URL_TTL,
    },
  };
  return view as unknown as AppConfigService;
}

function createAuthHandler(
  config: AppConfigService,
  prisma: PrismaClient,
  email: EmailDeliveryService,
): AuthHandler {
  const options = buildAuthOptions({
    config,
    prisma: { client: prisma } as unknown as PrismaService,
    email,
    prismaAdapter: prismaAdapter as never,
    twoFactor: twoFactor as never,
  });
  return betterAuth(options as never) as unknown as AuthHandler;
}

async function callAuth(
  auth: AuthHandler,
  environment: Environment,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await auth.handler(
    new Request(`${environment.API_URL.replace(/\/+$/u, "")}/v1/auth${path}`, {
      method: "POST",
      headers: {
        origin: environment.APP_URL,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const code = typeof payload.code === "string" ? ` (${payload.code})` : "";
    throw new Error(`Better Auth ${path} returned HTTP ${response.status}${code}`);
  }
  return payload;
}

async function waitForBootstrapEmails(
  prisma: PrismaClient,
  userId: string,
  since: Date,
): Promise<BootstrapEmailEvidence> {
  const expected = new Set([emailVerificationTemplate, passwordResetTemplate]);
  let templates = new Map<string, string>();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const logs = await prisma.emailLog.findMany({
      where: {
        userId,
        createdAt: { gte: since },
        template: { in: [emailVerificationTemplate, passwordResetTemplate] },
      },
      select: { template: true, status: true },
      orderBy: { createdAt: "desc" },
    });
    templates = new Map(logs.map((log) => [log.template, log.status]));
    if ([...expected].every((template) => templates.has(template))) {
      break;
    }
    await sleep(500);
  }

  const deliveredTemplates = [...expected].filter((template) =>
    ["sent", "delivered"].includes(templates.get(template) ?? ""),
  );
  const failedTemplates = [...expected].filter((template) => {
    const status = templates.get(template);
    return status === "failed" || status === "bounced" || status === "complained";
  });

  return { deliveredTemplates, failedTemplates };
}

function printResult(result: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function createInvitation(
  environment: Environment,
  config: AppConfigService,
  prisma: PrismaClient,
  email: EmailDeliveryService,
  input: { email: string; name: string; force: boolean },
): Promise<void> {
  const startedAt = new Date();
  const auth = createAuthHandler(config, prisma, email);
  const generatedPassword = randomBytes(48).toString("base64url");

  await callAuth(auth, environment, "/sign-up/email", {
    name: input.name,
    email: input.email,
    password: generatedPassword,
    callbackURL: `${environment.ADMIN_URL}/login?verified=1`,
  });

  const createdUser = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      platformRole: true,
      status: true,
      deletedAt: true,
      accounts: {
        where: { providerId: "credential" },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (
    !createdUser ||
    createdUser.emailVerified ||
    createdUser.platformRole !== "user" ||
    createdUser.status !== "active" ||
    createdUser.deletedAt !== null ||
    createdUser.accounts.length === 0
  ) {
    fail(
      "The invitation account was not created with the expected unverified, non-admin Better Auth credential state.",
    );
  }

  let resetRequestSucceeded = true;
  try {
    await callAuth(auth, environment, "/request-password-reset", {
      email: input.email,
      redirectTo: `${environment.APP_URL}/reset-password`,
    });
  } catch {
    resetRequestSucceeded = false;
  }

  const evidence = await waitForBootstrapEmails(prisma, createdUser.id, startedAt);
  const invitationComplete =
    resetRequestSucceeded &&
    evidence.deliveredTemplates.includes(emailVerificationTemplate) &&
    evidence.deliveredTemplates.includes(passwordResetTemplate);

  await prisma.auditLog.create({
    data: {
      actorType: "system",
      action: "admin.bootstrap_account_created",
      targetType: "user",
      targetId: createdUser.id,
      metadata: {
        environment: environment.NODE_ENV,
        forced: input.force,
        initialPlatformRole: "user",
        initialCredential: "generated-not-disclosed",
        emailVerificationRequired: true,
        secondFactorRequired: true,
        invitationComplete,
        deliveredTemplates: evidence.deliveredTemplates,
        failedTemplates: evidence.failedTemplates,
      },
    },
  });

  printResult({
    status: invitationComplete ? "invitation_sent" : "account_created_delivery_incomplete",
    email: createdUser.email,
    userId: createdUser.id,
    platformRole: "user",
    emailVerified: false,
    secondFactorRequired: true,
    superAdminPromoted: false,
    invitationComplete,
    deliveredTemplates: evidence.deliveredTemplates,
    failedTemplates: evidence.failedTemplates,
    nextSteps: [
      "Open the verification email and the password-reset email for this address.",
      "Set a strong password through the one-time reset link.",
      "Sign in, open /admin/2fa/enroll, and verify a TOTP authenticator.",
      "Re-run this command with --force to promote the fully verified account to super_admin.",
    ],
  });

  if (!invitationComplete) {
    process.exitCode = 2;
  }
}

async function promoteExisting(
  environment: Environment,
  prisma: PrismaClient,
  input: { email: string; force: boolean },
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    platformRole: string;
    status: string;
    deletedAt: Date | null;
    twoFactors: Array<{
      id: string;
      secret: string;
      backupCodes: string;
      verified: boolean;
      lockedUntil: Date | null;
    }>;
  },
): Promise<void> {
  if (user.deletedAt !== null || user.status !== "active" || !user.emailVerified) {
    fail("The target account must be active and have a verified email address");
  }

  assertBootstrapTwoFactorReady(user);

  if (user.platformRole === "super_admin") {
    printResult({
      status: "already_bootstrapped",
      email: user.email,
      userId: user.id,
      platformRole: "super_admin",
      secondFactorRequired: true,
      passwordChanged: false,
    });
    return;
  }

  const now = new Date();
  const outcome = await prisma.$transaction(async (transaction) => {
    const freshUser = await transaction.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        twoFactorEnabled: true,
        platformRole: true,
        status: true,
        deletedAt: true,
        twoFactors: {
          select: {
            id: true,
            secret: true,
            backupCodes: true,
            verified: true,
            lockedUntil: true,
          },
        },
      },
    });

    if (!freshUser) {
      fail("The target account no longer exists");
    }
    if (freshUser.deletedAt !== null || freshUser.status !== "active" || !freshUser.emailVerified) {
      fail("The target account must be active and have a verified email address");
    }

    assertBootstrapTwoFactorReady(freshUser, now);

    if (freshUser.platformRole === "super_admin") {
      return {
        status: "already_bootstrapped" as const,
        email: freshUser.email,
        userId: freshUser.id,
      };
    }

    const promoted = await transaction.user.updateMany({
      where: {
        id: freshUser.id,
        emailVerified: true,
        platformRole: freshUser.platformRole,
        status: "active",
        deletedAt: null,
        twoFactorEnabled: true,
        twoFactors: {
          some: {
            verified: true,
            secret: { not: "" },
            backupCodes: { not: "" },
            OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
          },
        },
      },
      data: {
        platformRole: "super_admin",
      },
    });

    if (promoted.count !== 1) {
      const currentUser = await transaction.user.findUnique({
        where: { id: freshUser.id },
        select: {
          id: true,
          email: true,
          emailVerified: true,
          twoFactorEnabled: true,
          platformRole: true,
          status: true,
          deletedAt: true,
          twoFactors: {
            select: {
              id: true,
              secret: true,
              backupCodes: true,
              verified: true,
              lockedUntil: true,
            },
          },
        },
      });

      if (!currentUser) {
        fail("The target account no longer exists");
      }
      if (
        currentUser.deletedAt !== null ||
        currentUser.status !== "active" ||
        !currentUser.emailVerified
      ) {
        fail("The target account must be active and have a verified email address");
      }

      assertBootstrapTwoFactorReady(currentUser, now);

      if (currentUser.platformRole === "super_admin") {
        return {
          status: "already_bootstrapped" as const,
          email: currentUser.email,
          userId: currentUser.id,
        };
      }

      fail("The target account changed during promotion; verify it and retry");
    }

    await transaction.auditLog.create({
      data: {
        actorType: "system",
        action: "admin.bootstrap_super_admin",
        targetType: "user",
        targetId: freshUser.id,
        metadata: {
          previousRole: freshUser.platformRole,
          forced2fa: true,
          environment: environment.NODE_ENV,
          forced: input.force,
        },
      },
    });

    return {
      status: "promoted" as const,
      email: freshUser.email,
      userId: freshUser.id,
    };
  });

  printResult({
    status: outcome.status,
    email: outcome.email,
    userId: outcome.userId,
    platformRole: "super_admin",
    secondFactorRequired: true,
    passwordChanged: false,
  });
}

async function main(): Promise<void> {
  const args = readArguments();
  if (args.help) {
    printHelp();
    return;
  }

  loadEnvironmentFiles();
  const environment = validateEnvironment(process.env);
  const rawEmail =
    args.email ??
    environment.BOOTSTRAP_SUPER_ADMIN_EMAIL ??
    process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;

  if (!rawEmail) {
    fail("Set BOOTSTRAP_SUPER_ADMIN_EMAIL or pass --email <address>");
  }

  const emailResult = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!emailResult.success) {
    fail("The bootstrap admin email address is invalid");
  }
  const email = emailResult.data;

  const rawName =
    args.name ?? process.env.BOOTSTRAP_SUPER_ADMIN_NAME ?? "Roamlog Platform Administrator";
  const nameResult = nameSchema.safeParse(rawName);
  if (!nameResult.success) {
    fail("The bootstrap administrator display name must contain 2 to 80 characters");
  }
  const name = nameResult.data;

  if (args.dryRun) {
    assertEmailProviderConfigured(environment);
    printResult({
      status: "dry_run",
      targetEmail: email,
      existingAccountPolicy: "verified email + verified TOTP required before promotion",
      missingAccountPolicy:
        "create unverified user with generated non-disclosed credential, send verification/reset emails, and do not grant admin roles",
      force: args.force,
      networkOrDatabaseMutation: false,
      emailsSent: false,
    });
    return;
  }

  if (environment.NODE_ENV === "production" && !args.force) {
    fail("Production bootstrap requires --force");
  }

  const config = createConfigView(environment);
  const prisma = createPrismaClient({
    connectionString: environment.DATABASE_URL,
  });
  const logger = {
    warn: () => undefined,
    error: () => undefined,
  } as never;
  const emailService = new EmailDeliveryService(
    config,
    { client: prisma } as unknown as PrismaService,
    logger,
  );

  try {
    const totalUsers = await prisma.user.count();
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        twoFactorEnabled: true,
        platformRole: true,
        status: true,
        deletedAt: true,
        twoFactors: {
          select: {
            id: true,
            secret: true,
            backupCodes: true,
            verified: true,
            lockedUntil: true,
          },
        },
      },
    });

    if (totalUsers > 0 && !args.force) {
      fail("The database already has users; re-run with --force after verifying the target");
    }

    if (!user) {
      assertEmailProviderConfigured(environment);
      await createInvitation(environment, config, prisma, emailService, {
        email,
        name,
        force: args.force,
      });
      return;
    }

    await promoteExisting(environment, prisma, { email, force: args.force }, user);
  } finally {
    await prisma.$disconnect();
  }
}

function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, "postgresql://[redacted]@")
    .replace(/([?&](?:secret|password|token)=)[^&\s]+/giu, "$1[redacted]")
    .slice(0, 500);
}

void main().catch((error: unknown) => {
  console.error(`Roamlog admin bootstrap failed: ${redactError(error)}`);
  process.exitCode = 1;
});
