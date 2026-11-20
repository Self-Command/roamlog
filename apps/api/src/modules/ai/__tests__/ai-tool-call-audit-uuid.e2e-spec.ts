/**
 * Write-side regression for the illegal UUID that used to be stored in
 * `AuditLog.targetId`, executed against a real PostgreSQL database.
 *
 * `newRunId()` used to return 32 hyphenless hex digits. `AiExecuteService`
 * wrote that string into `AuditLog.targetId` (a PostgreSQL `uuid` column), which
 * accepted it and canonicalised it to 8-4-4-4-12 **without** fixing the
 * version/variant nibbles. `AuditLogSchema`'s `z.uuid()` then rejected the row
 * and `GET /v1/admin/audit` returned 500.
 *
 * This suite proves both halves of the fix on a real `uuid` column:
 *  - a tool call through `AiExecuteService` now stores a genuine RFC 4122 UUID
 *    whose read-back passes `AuditLogSchema` and `AiRunIdSchema`;
 *  - a historical non-RFC row (the exact variant-`f` value) is still readable
 *    through the widened contract, and only the widened rule accepts it.
 *
 * Skipped unless `ROAMLOG_TEST_DATABASE_URL` points at a migrated PostgreSQL.
 */

import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@roamlog/db";
import { AiRunIdSchema, AuditLogSchema, type AiToolCall } from "@roamlog/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import { AuditService } from "../../audit/audit.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { AiExecuteService } from "../ai-execute.service.js";
import { newRunId } from "../ai-run.store.js";
import type { AiToolbox } from "../ai-tools.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED AI tool-call audit UUID e2e test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise a real PostgreSQL database.\n",
  );
}

/** `newRunId()` returned this shape before the fix (32 hyphenless hex digits). */
const LEGACY_HYPHENLESS_RUN_ID = "726d652afcfc877cf34f593a6ec94c59";
/** What PostgreSQL stored for it: canonical groups, variant nibble `f`. */
const LEGACY_PG_NORMALISED = "726d652a-fcfc-877c-f34f-593a6ec94c59";

const CALL: AiToolCall = { tool: "trips.create", args: { title: "Kyoto" } };

integration("AI tool call audit targetId against PostgreSQL", () => {
  const prisma = createPrismaClient({ connectionString: testDatabaseUrl });
  const suffix = randomUUID();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const runId = newRunId();
  /** `AiExecuteService` audits every tool call with this literal action. */
  const toolCallAction = "ai.tool_call";
  const legacyAction = `test.ai.tool_call.legacy.${suffix}`;

  const database = {
    client: prisma,
    healthCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  } as unknown as PrismaService;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: userId,
        email: `ai-runid-${suffix}@roamlog.test`,
        name: "AI RunId Regression",
        emailVerified: true,
      },
    });
    // The `Workspace_owner_membership_check` trigger is DEFERRABLE INITIALLY
    // DEFERRED, so workspace + owner membership must share one transaction.
    await prisma.$transaction(async (tx) => {
      await tx.workspace.create({
        data: {
          id: workspaceId,
          name: "AI RunId Workspace",
          slug: `ai-runid-${suffix}`,
          ownerId: userId,
        },
      });
      await tx.workspaceMember.create({
        data: { workspaceId, userId, role: "owner", status: "active" },
      });
    });
  });

  afterAll(async () => {
    // The deferred `Workspace_owner_membership_check` trigger passes once the
    // Workspace row is gone, so the workspace goes first (members cascade).
    await prisma.auditLog.deleteMany({
      where: { OR: [{ targetId: runId }, { action: legacyAction }] },
    });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  function actor(): AuthenticatedActor {
    return {
      user: { id: userId, email: `ai-runid-${suffix}@roamlog.test`, name: "AI RunId Regression" },
      ip: "127.0.0.1",
      userAgent: "vitest-postgres",
    } as unknown as AuthenticatedActor;
  }

  function membership(): WorkspaceMembershipAccess {
    return {
      id: randomUUID(),
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      invitedById: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      workspaceName: "AI RunId Workspace",
    } as unknown as WorkspaceMembershipAccess;
  }

  /** Exactly how the admin read path hands a Prisma row to the contract. */
  function toTransport(row: {
    id: string;
    actorId: string | null;
    actorType: string;
    action: string;
    targetType: string;
    targetId: string;
    workspaceId: string | null;
    ip: string | null;
    userAgent: string | null;
    metadata: unknown;
    createdAt: Date;
  }): Record<string, unknown> {
    return { ...row, createdAt: row.createdAt.toISOString() };
  }

  it("stores an RFC 4122 UUID and reads it back through AuditLogSchema", async () => {
    // The tool execution itself is stubbed (toolbox); everything from
    // AiExecuteService's audit write through PostgreSQL is real.
    const toolbox = {
      execute: async () => ({ ok: true, entityId: "01942f30-1200-7000-8000-000000000201" }),
    } as unknown as AiToolbox;
    const runs = {
      load: async () => ({
        runId,
        workspaceId,
        userId,
        message: "Plan ready.",
        plannedCalls: [CALL],
        candidates: [],
        createdAt: new Date().toISOString(),
      }),
      isConsumed: async () => false,
      consume: async () => undefined,
    };
    const idempotency = {
      run: async (_scope: string, _key: string, operation: () => Promise<unknown>) => operation(),
    };
    const audit = new AuditService(database, {} as never);
    const service = new AiExecuteService(
      toolbox,
      runs as never,
      idempotency as never,
      audit,
    );

    const response = await service.execute(actor(), membership(), runId, {
      calls: [CALL],
      idempotencyKey: `runid-fix-${runId}`,
    });
    expect(response.partialFailure).toBe(false);

    const stored = await prisma.auditLog.findFirst({ where: { targetId: runId } });
    expect(stored).not.toBeNull();
    expect(stored?.action).toBe(toolCallAction);
    // PostgreSQL did not need to repair the value: it was already canonical.
    expect(stored?.targetId).toBe(runId);
    expect(stored?.targetId).toBe(stored?.targetId?.toLowerCase());
    expect(z.uuid().safeParse(stored?.targetId).success).toBe(true);

    // The single value travels through both contracts the bug touched.
    expect(AiRunIdSchema.safeParse(runId).success).toBe(true);
    expect(() => AuditLogSchema.parse(toTransport(stored!))).not.toThrow();
    expect(AuditLogSchema.parse(toTransport(stored!)).targetId).toBe(runId);
    console.info(
      "[evidence] ai.tool_call targetId",
      JSON.stringify({
        runId,
        storedTargetId: stored?.targetId,
        auditLogSchema: AuditLogSchema.safeParse(toTransport(stored!)).success,
        aiRunIdSchema: AiRunIdSchema.safeParse(runId).success,
      }),
    );
  });

  it("keeps the historical non-RFC row readable, and only via the widened rule", async () => {
    // Written exactly like the ten immutable `ai.tool_call` rows were: the
    // hyphenless form goes into the uuid column and PostgreSQL canonicalises
    // it without rewriting the variant nibble.
    await prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "actorType", "action", "targetType", "targetId", "metadata")
      VALUES (${randomUUID()}::uuid, 'system'::"ActorType", ${legacyAction}, 'ai_tool', ${LEGACY_HYPHENLESS_RUN_ID}::uuid, '{}'::jsonb)
    `;

    const stored = await prisma.auditLog.findFirst({ where: { action: legacyAction } });
    expect(stored).not.toBeNull();
    expect(stored?.targetId).toBe(LEGACY_PG_NORMALISED);

    const transport = toTransport(stored!);
    expect(AuditLogSchema.safeParse(transport).success).toBe(true);
    // ...and this is precisely why it used to 500: RFC 4122 rejects the variant.
    expect(z.uuid().safeParse(LEGACY_PG_NORMALISED).success).toBe(false);
  });
});