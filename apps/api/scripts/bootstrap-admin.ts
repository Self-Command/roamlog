import { createPrismaClient } from "@roamlog/db";
import { z } from "zod";

import { loadEnvironmentFiles } from "../src/config/load-environment.js";
import { validateEnvironment } from "../src/config/environment.js";

const emailSchema = z.email();

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const environment = validateEnvironment(process.env);
  const force = process.argv.includes("--force");
  const rawEmail = argumentValue("--email") ?? environment.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? undefined;

  if (!rawEmail) {
    fail("Set BOOTSTRAP_SUPER_ADMIN_EMAIL or pass --email <address>");
  }

  const emailResult = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!emailResult.success) {
    fail("The bootstrap admin email address is invalid");
  }
  const email = emailResult.data;

  if (environment.NODE_ENV === "production" && !force) {
    fail("Production bootstrap requires --force");
  }

  const prisma = createPrismaClient({
    connectionString: environment.DATABASE_URL,
  });

  try {
    const [totalUsers, user] = await Promise.all([
      prisma.user.count(),
      prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          emailVerified: true,
          platformRole: true,
          status: true,
          deletedAt: true,
          twoFactors: {
            select: {
              id: true,
              secret: true,
              backupCodes: true,
            },
          },
        },
      }),
    ]);

    if (totalUsers > 0 && !force) {
      fail("The database already has users; re-run with --force after verifying the target");
    }

    if (!user) {
      fail(
        "No matching user exists. Create the account through Better Auth and enroll TOTP 2FA before bootstrapping.",
      );
    }

    if (user.deletedAt !== null || user.status !== "active" || !user.emailVerified) {
      fail("The target account must be active and have a verified email address");
    }

    const hasCompleteSecondFactor = user.twoFactors.some(
      (twoFactor) => twoFactor.secret.trim() && twoFactor.backupCodes.trim(),
    );
    if (!hasCompleteSecondFactor) {
      fail("The target account must complete TOTP 2FA enrollment before promotion");
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: {
          platformRole: "super_admin",
        },
      });

      await transaction.auditLog.create({
        data: {
          actorType: "system",
          action: "admin.bootstrap_super_admin",
          targetType: "user",
          targetId: user.id,
          metadata: {
            previousRole: user.platformRole,
            forced2fa: true,
            environment: environment.NODE_ENV,
            forced: force,
          },
        },
      });
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          email,
          userId: user.id,
          platformRole: "super_admin",
          secondFactorRequired: true,
          passwordChanged: false,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(`Roamlog admin bootstrap failed: ${message}`);
  process.exitCode = 1;
});
