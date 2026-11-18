/**
 * Local verification seed: one verified owner account + one workspace.
 * Not part of the product — lives under .audit/ and is used only for manual QA.
 */
import { randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { createPrismaClient } from "@roamlog/db";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const EMAIL = process.env.VERIFY_EMAIL ?? "verify@roamlog.test";
const PASSWORD = process.env.VERIFY_PASSWORD ?? "Roamlog-Verify-Aa1!";
const NAME = process.env.VERIFY_NAME ?? "验收账号";
const WORKSPACE_NAME = process.env.VERIFY_WORKSPACE ?? "验收工作区";
const WORKSPACE_SLUG = process.env.VERIFY_SLUG ?? "verify-crew";

function uuidV7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient(DATABASE_URL as string);
  const passwordHash = await hashPassword(PASSWORD);

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
    console.log("removed previous verification account");
  }

  const userId = uuidV7();
  const user = await prisma.user.create({
    data: {
      id: userId,
      email: EMAIL,
      emailVerified: true,
      name: NAME,
      platformRole: "user",
      accounts: {
        create: {
          id: uuidV7(),
          accountId: userId,
          providerId: "credential",
          password: passwordHash,
        },
      },
    },
  });

  if (process.env.VERIFY_NO_WORKSPACE === "1") {
    console.log(
      JSON.stringify({ email: user.email, password: PASSWORD, workspace: null }, null, 2),
    );
    await prisma.$disconnect();
    return;
  }

  const existingWorkspace = await prisma.workspace.findUnique({ where: { slug: WORKSPACE_SLUG } });
  if (existingWorkspace) {
    await prisma.workspace.delete({ where: { id: existingWorkspace.id } });
    console.log("removed previous workspace");
  }

  const workspaceId = uuidV7();
  await prisma.$transaction(async (tx) => {
    await tx.workspace.create({
      data: { id: workspaceId, name: WORKSPACE_NAME, slug: WORKSPACE_SLUG, ownerId: user.id },
    });
    await tx.workspaceMember.create({
      data: { id: uuidV7(), workspaceId, userId: user.id, role: "owner" },
    });
  });

  console.log(
    JSON.stringify(
      {
        email: user.email,
        password: PASSWORD,
        workspaceSlug: WORKSPACE_SLUG,
        workspaceName: WORKSPACE_NAME,
        webUrl: "http://localhost:3000",
        workspaceUrl: `http://localhost:3000/w/${WORKSPACE_SLUG}`,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});