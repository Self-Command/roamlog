/**
 * Provisions the one account the smoke suite needs beyond the seeded demo
 * users: a real `super_admin` whose password the test knows.
 *
 * The repository's live fixture (`tooling/scripts/e2e-auth-fixture.ts`) only
 * creates `user`/`admin` accounts and truncates the whole `User` table, so it
 * cannot be pointed at the shared local development database. This script is
 * deliberately *additive and non-destructive*: it creates exactly one uniquely
 * named account and can delete that same account again.
 *
 * Run through `e2e/support/provision.ts` (Playwright specs never import this
 * file directly, because `@roamlog/db` resolves from the API workspace).
 *
 * Usage:
 *   pnpm --filter @roamlog/api exec tsx ../../e2e/support/provision-smoke-accounts.ts \
 *     --action=create-super --email=smoke-...@roamlog.test --password=...
 *   ... --action=delete --email=...
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { hashPassword } from "better-auth/crypto";
import { createPrismaClient } from "@roamlog/db";

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

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      action: { type: "string" },
      email: { type: "string" },
      password: { type: "string" },
      name: { type: "string", default: "E2E Smoke Super Admin" },
    },
    strict: true,
  });

  const action = values.action;
  const email = values.email?.trim().toLowerCase();
  if (action !== "create-super" && action !== "delete") {
    throw new Error("--action must be create-super or delete");
  }
  if (!email || !email.endsWith("@roamlog.test")) {
    throw new Error("--email must be a @roamlog.test address");
  }

  const prisma = createPrismaClient();

  try {
    if (action === "delete") {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) {
        console.log(JSON.stringify({ deleted: false, email }));
        return;
      }
      // Sessions and credential accounts cascade; audit rows keep a null actor.
      await prisma.user.delete({ where: { id: user.id } });
      console.log(JSON.stringify({ deleted: true, email, userId: user.id }));
      return;
    }

    if (!values.password || values.password.length < 12) {
      throw new Error("--password must be at least 12 characters");
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await prisma.user.delete({ where: { id: existing.id } });
    }

    const passwordHash = await hashPassword(values.password);
    const id = uuidV7();
    const user = await prisma.user.create({
      data: {
        id,
        email,
        emailVerified: true,
        name: values.name,
        platformRole: "super_admin",
        status: "active",
        accounts: {
          create: {
            id: uuidV7(),
            accountId: id,
            providerId: "credential",
            password: passwordHash,
          },
        },
      },
      select: { id: true, email: true, platformRole: true },
    });

    console.log(JSON.stringify({ created: true, ...user }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});