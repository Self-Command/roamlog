import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@roamlog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuditService } from "../src/modules/audit/audit.service.js";
import type { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { ensureDefaultWorkspace } from "../src/modules/workspaces/workspace-onboarding.js";
import { makeActor } from "./identity-fixtures.js";

const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  process.stderr.write(
    "SKIPPED workspace onboarding integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise a real PostgreSQL database.\n",
  );
}

function uuidV7(): string {
  const hex = randomUUID().replaceAll("-", "");
  const timestamp = Date.now().toString(16).padStart(12, "0").slice(-12);
  const variant = (8 + (Number.parseInt(hex[16] ?? "0", 16) % 4)).toString(16);
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

integrationDescribe("ensureDefaultWorkspace against PostgreSQL", () => {
  const prisma = createPrismaClient({ connectionString: databaseUrl });
  const database = { client: prisma } as unknown as PrismaService;
  const actor = makeActor(uuidV7(), {
    email: `onboarding-${randomUUID()}@roamlog.test`,
  });
  const audit = new AuditService(database, {} as never);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: actor.user.id,
        email: actor.user.email,
        emailVerified: true,
        name: actor.user.name,
        timezone: actor.user.timezone,
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { actorId: actor.user.id } });
      await prisma.workspace.deleteMany({ where: { ownerId: actor.user.id } });
      await prisma.user.deleteMany({ where: { id: actor.user.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("creates the first default Workspace without a P2010 void deserialization failure", async () => {
    const created = await ensureDefaultWorkspace({ prisma: database, audit }, actor);

    expect(created).not.toBeNull();
    if (!created) {
      throw new Error("Expected the first onboarding call to create a Workspace");
    }
    expect(created).toMatchObject({
      ownerId: actor.user.id,
      plan: "free",
      status: "active",
    });

    const [workspace, membership, auditLog] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: created.id },
        select: { ownerId: true, status: true },
      }),
      prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: created.id,
            userId: actor.user.id,
          },
        },
        select: { role: true, status: true },
      }),
      prisma.auditLog.findFirst({
        where: {
          workspaceId: created.id,
          action: "workspace.onboarded",
        },
        select: { id: true },
      }),
    ]);

    expect(workspace).toEqual({ ownerId: actor.user.id, status: "active" });
    expect(membership).toEqual({ role: "owner", status: "active" });
    expect(auditLog).not.toBeNull();

    const repeated = await ensureDefaultWorkspace({ prisma: database, audit }, actor);
    expect(repeated).toBeNull();
    await expect(prisma.workspace.count({ where: { ownerId: actor.user.id } })).resolves.toBe(1);
  });
});
