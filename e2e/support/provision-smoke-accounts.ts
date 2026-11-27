/**
 * Provisions the accounts the smoke suite needs beyond the seeded demo users:
 * a real `super_admin` and a member of a seeded workspace, both with passwords
 * the tests know.
 *
 * The repository's live fixture (`tooling/scripts/e2e-auth-fixture.ts`) only
 * creates `user`/`admin` accounts and truncates the whole `User` table, so it
 * cannot be pointed at the shared local development database. This script is
 * deliberately scoped to the requested `@roamlog.test` address: re-running a
 * create action replaces that one account, and `delete` removes only that one.
 *
 * Run through `e2e/support/accounts.ts` or directly from CI (Playwright specs
 * never import this file directly, because `@roamlog/db` resolves from the API
 * workspace).
 *
 * Usage:
 *   pnpm --filter @roamlog/api exec tsx ../../e2e/support/provision-smoke-accounts.ts \
 *     --action=create-super --email=smoke-...@roamlog.test --password=...
 *   ... --action=create-member --email=... --password=... \
 *     --workspace-slug=roamlog-crew [--role=admin]
 *   ... --action=delete --email=...
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { hashPassword } from "better-auth/crypto";
import { createPrismaClient } from "@roamlog/db";

export const CREATE_MEMBER_ROLES = ["owner", "admin", "editor", "viewer"] as const;

export type CreateMemberRole = (typeof CREATE_MEMBER_ROLES)[number];

export function parseCreateMemberRole(value: string | undefined): CreateMemberRole {
  const role = value ?? "admin";
  if (!CREATE_MEMBER_ROLES.includes(role as CreateMemberRole)) {
    throw new Error("--role must be owner, admin, editor, or viewer");
  }
  return role as CreateMemberRole;
}

export interface MemberUserCreateDataInput {
  id: string;
  accountId: string;
  email: string;
  name: string;
  passwordHash: string;
  workspaceId: string;
  role: CreateMemberRole;
}

export function buildMemberUserCreateData(input: MemberUserCreateDataInput) {
  return {
    id: input.id,
    email: input.email,
    emailVerified: true,
    name: input.name,
    platformRole: "user" as const,
    status: "active" as const,
    accounts: {
      create: {
        id: input.accountId,
        accountId: input.id,
        providerId: "credential",
        password: input.passwordHash,
      },
    },
    memberships: {
      create: {
        workspaceId: input.workspaceId,
        role: input.role,
        status: "active" as const,
      },
    },
  };
}

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
      "workspace-slug": { type: "string" },
      role: { type: "string", default: "admin" },
    },
    strict: true,
  });

  const action = values.action;
  const email = values.email?.trim().toLowerCase();
  if (action !== "create-super" && action !== "create-member" && action !== "delete") {
    throw new Error("--action must be create-super, create-member, or delete");
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
      // The app creates a personal workspace on first login. Remove those
      // run-owned aggregates before the user row so the owner FK cannot block
      // cleanup; sessions and credential accounts still cascade.
      await prisma.$transaction([
        prisma.workspace.deleteMany({ where: { ownerId: user.id } }),
        prisma.user.delete({ where: { id: user.id } }),
      ]);
      console.log(JSON.stringify({ deleted: true, email, userId: user.id }));
      return;
    }

    if (!values.password || values.password.length < 12) {
      throw new Error("--password must be at least 12 characters");
    }

    if (action === "create-member") {
      const workspaceSlug = values["workspace-slug"]?.trim();
      if (!workspaceSlug) {
        throw new Error("--workspace-slug is required for create-member");
      }
      const role = parseCreateMemberRole(values.role);
      const workspace = await prisma.workspace.findUnique({
        where: { slug: workspaceSlug },
        select: { id: true },
      });
      if (!workspace) {
        throw new Error(`Workspace not found for --workspace-slug=${workspaceSlug}`);
      }

      const passwordHash = await hashPassword(values.password);
      const id = uuidV7();
      const accountId = uuidV7();
      const user = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
        if (existing) {
          await tx.user.delete({ where: { id: existing.id } });
        }

        return tx.user.create({
          data: buildMemberUserCreateData({
            id,
            accountId,
            email,
            name: values.name,
            passwordHash,
            workspaceId: workspace.id,
            role,
          }),
          select: {
            id: true,
            email: true,
            memberships: {
              where: { workspaceId: workspace.id },
              select: { role: true },
            },
          },
        });
      });
      const membership = user.memberships[0];
      if (!membership) {
        throw new Error(`Workspace member was not created for ${email} in ${workspaceSlug}`);
      }

      console.log(
        JSON.stringify({
          created: true,
          email: user.email,
          userId: user.id,
          workspaceId: workspace.id,
          role: membership.role,
        }),
      );
      return;
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
