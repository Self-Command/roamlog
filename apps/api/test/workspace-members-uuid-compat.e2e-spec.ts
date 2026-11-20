import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  UpdateMemberResponseSchema,
  WorkspaceMemberPageSchema,
} from "@roamlog/contracts";
import {
  createPrismaClient,
  deterministicId,
  makeMember,
  makeUser,
  makeWorkspace,
} from "@roamlog/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureApp } from "../src/bootstrap/configure-app.js";
import { SessionGuard } from "../src/common/guards/session.guard.js";
import { AppConfigModule } from "../src/config/app-config.module.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { ObservabilityModule } from "../src/modules/observability/observability.module.js";
import { PrismaModule } from "../src/modules/prisma/prisma.module.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { RedisModule } from "../src/modules/redis/redis.module.js";
import { RedisService } from "../src/modules/redis/redis.service.js";
import { StorageModule } from "../src/modules/storage/storage.module.js";
import { StorageService } from "../src/modules/storage/storage.service.js";
import { WorkspacesModule } from "../src/modules/workspaces/workspaces.module.js";
import { makeActor } from "./identity-fixtures.js";

/**
 * Regression coverage for the membership UUID contract (`MEMBER_UUID_CONTRACT`,
 * following `MEMBERS_500`).
 *
 * The seeded `roamlog-crew` Workspace holds two `WorkspaceMember` rows whose id
 * was written by a fixture script as a v4 UUID. PostgreSQL stores either version
 * in a `uuid` column and returns it in canonical 8-4-4-4-12 form, so those rows
 * are ordinary rows — but the contract pinned every membership uuid to
 * `UuidV7Schema`, which broke the API twice:
 *
 *   GET    /v1/workspaces/:id/members           -> 500 (ZodError in presentMember)
 *   PATCH  /v1/workspaces/:id/members/:memberId -> 400 (params rejected the id)
 *   DELETE /v1/workspaces/:id/members/:memberId -> 400
 *
 * The contract now encodes PostgreSQL's `uuid` rule for membership rows, and
 * both the response and the route params use it. This spec proves the real
 * behaviour on a real database and through real HTTP:
 *
 *   - the page lists v4 rows and still satisfies the contract schema;
 *   - PATCH changes the role of a v4 row, and the change is in PostgreSQL;
 *   - DELETE removes a v4 row;
 *   - a non-admin actor still gets 403 (the widening is format-only);
 *   - a non-uuid member id still gets 400, an unknown one 404.
 *
 * Fixtures are built the honest way: every row is created with a deterministic
 * UUIDv7 (Prisma factories + `deterministicId`) and only the two rows that must
 * emulate historical dirty data are rewritten to a v4 id with one explicit
 * `UPDATE`, so the intent is visible instead of hidden in a `randomUUID()`.
 *
 * Skipped unless ROAMLOG_TEST_DATABASE_URL points at a reachable PostgreSQL.
 */
const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  process.stderr.write(
    "SKIPPED workspace members UUID compatibility test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise a real PostgreSQL database.\n",
  );
}

/** The two v4 ids that actually broke `GET /members` in `roamlog-crew`. */
const LEGACY_PATCH_MEMBER_ID = "83a7562c-4032-4de0-a33b-5ddc63b292ab";
const LEGACY_REMOVE_MEMBER_ID = "e7aa8557-6e54-45f8-b8cf-b2735314cdce";
/** A well-formed v4 uuid that is not stored in this database. */
const ABSENT_LEGACY_MEMBER_ID = "0f0c5a9e-6a53-4b52-9b3c-2a0f0d5e1c77";

const workspaceId = deterministicId("member-uuid-contract", "workspace");
const ownerUserId = deterministicId("member-uuid-contract", "user:owner");
const editorUserId = deterministicId("member-uuid-contract", "user:editor");
const patchUserId = deterministicId("member-uuid-contract", "user:patch");
const removeUserId = deterministicId("member-uuid-contract", "user:remove");
const ownerMemberId = deterministicId("member-uuid-contract", "member:owner");
const editorMemberId = deterministicId("member-uuid-contract", "member:editor");
const patchMemberId = deterministicId("member-uuid-contract", "member:patch");
const removeMemberId = deterministicId("member-uuid-contract", "member:remove");
const slug = `members-uuid-${workspaceId.slice(0, 8)}`;
const auditId = deterministicId("member-uuid-contract", "audit");

integrationDescribe("workspace members against PostgreSQL", () => {
  let app: INestApplication;
  const prisma = createPrismaClient({ connectionString: databaseUrl });
  const database = {
    client: prisma,
    healthCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  } as unknown as PrismaService;

  const userIds = [ownerUserId, editorUserId, patchUserId, removeUserId];

  beforeAll(async () => {
    await prisma.$connect();

    // Idempotent reruns: clear anything a previous (possibly interrupted) run
    // left behind, including rows already rewritten to the legacy ids.
    await prisma.auditLog.deleteMany({ where: { workspaceId } });
    await prisma.$transaction(async (tx) => {
      await tx.workspaceMember.deleteMany({
        where: { OR: [{ workspaceId }, { id: { in: [LEGACY_PATCH_MEMBER_ID, LEGACY_REMOVE_MEMBER_ID] } }] },
      });
      await tx.workspace.deleteMany({ where: { id: workspaceId } });
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });

    await prisma.user.createMany({
      data: [
        makeUser({ id: ownerUserId, email: `uuid-contract-owner-${ownerUserId.slice(0, 8)}@roamlog.test`, name: "UUID Contract Owner" }),
        makeUser({ id: editorUserId, email: `uuid-contract-editor-${editorUserId.slice(0, 8)}@roamlog.test`, name: "UUID Contract Editor" }),
        makeUser({ id: patchUserId, email: `uuid-contract-patch-${patchUserId.slice(0, 8)}@roamlog.test`, name: "UUID Contract Patch" }),
        makeUser({ id: removeUserId, email: `uuid-contract-remove-${removeUserId.slice(0, 8)}@roamlog.test`, name: "UUID Contract Remove" }),
      ],
    });

    // The `Workspace_owner_membership_check` trigger is DEFERRABLE INITIALLY
    // DEFERRED, so the workspace and its owner membership share a transaction.
    await prisma.$transaction(async (tx) => {
      await tx.workspace.create({
        data: {
          ...makeWorkspace({
            id: workspaceId,
            name: "UUID Contract Workspace",
            slug,
            ownerId: ownerUserId,
          }),
          // `makeWorkspace` types `settings` as the read-side `JsonValue`; the
          // create input needs the writable `InputJsonValue`.
          settings: {},
        },
      });
      await tx.workspaceMember.create({
        data: makeMember({
          id: ownerMemberId,
          workspaceId,
          userId: ownerUserId,
          role: "owner",
          joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      });
    });

    await prisma.workspaceMember.create({
      data: makeMember({
        id: editorMemberId,
        workspaceId,
        userId: editorUserId,
        role: "editor",
        joinedAt: new Date("2026-01-02T00:00:00.000Z"),
        invitedById: ownerUserId,
      }),
    });
    await prisma.workspaceMember.create({
      data: makeMember({
        id: patchMemberId,
        workspaceId,
        userId: patchUserId,
        role: "viewer",
        joinedAt: new Date("2026-01-03T00:00:00.000Z"),
        invitedById: ownerUserId,
      }),
    });
    await prisma.workspaceMember.create({
      data: makeMember({
        id: removeMemberId,
        workspaceId,
        userId: removeUserId,
        role: "viewer",
        joinedAt: new Date("2026-01-04T00:00:00.000Z"),
        invitedById: ownerUserId,
      }),
    });

    // The only step that produces a non-v7 id: one explicit rewrite of the two
    // rows that stand in for the historical `randomUUID()` fixture rows. No
    // application code mints this shape; the contract must still serve it.
    await prisma.$executeRaw`
      UPDATE "WorkspaceMember" SET "id" = ${LEGACY_PATCH_MEMBER_ID}::uuid
       WHERE "id" = ${patchMemberId}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE "WorkspaceMember" SET "id" = ${LEGACY_REMOVE_MEMBER_ID}::uuid
       WHERE "id" = ${removeMemberId}::uuid
    `;

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        ObservabilityModule,
        PrismaModule,
        RedisModule,
        StorageModule,
        WorkspacesModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(database)
      .overrideProvider(RedisService)
      .useValue({ ping: async () => undefined })
      .overrideProvider(StorageService)
      .useValue({ checkHealth: async () => undefined })
      .overrideProvider(AuditService)
      .useValue({ record: async () => ({ id: auditId }) })
      // `TenantGuard` injects `SessionGuard` through DI, so the stub must be a
      // provider override rather than `overrideGuard` (which only rebinds the
      // `@UseGuards(SessionGuard)` token on the controller). The header picks
      // the acting user so permission denials can be exercised per role.
      .overrideProvider(SessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const incoming = context.switchToHttp().getRequest() as {
            headers?: Record<string, string>;
            user?: unknown;
          };
          const actingUserId = incoming.headers?.["x-test-user"];
          if (!actingUserId) {
            throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
          }
          incoming.user = makeActor(actingUserId).user;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await prisma.auditLog.deleteMany({ where: { workspaceId } });
        // Both workspace triggers are deferred, so membership and workspace
        // deletion share one transaction and each sees the final state.
        await prisma.$transaction(async (tx) => {
          await tx.workspaceMember.deleteMany({ where: { workspaceId } });
          await tx.workspace.deleteMany({ where: { id: workspaceId } });
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  function membersUrl(memberId?: string): string {
    const base = `/v1/workspaces/${workspaceId}/members`;
    return memberId ? `${base}/${memberId}` : base;
  }

  it("GET /members returns 200 and lists both legacy (v4) membership rows", async () => {
    const response = await request(app.getHttpServer())
      .get(membersUrl())
      .set("x-test-user", ownerUserId);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.hasMore).toBe(false);
    expect(response.body.items).toHaveLength(4);

    // The whole page must satisfy the contract schema it is served as.
    expect(() => WorkspaceMemberPageSchema.parse(response.body)).not.toThrow();

    const items = response.body.items as Array<{ id: string; role: string; userId: string }>;
    expect(items.map((item) => item.id)).toEqual([
      ownerMemberId,
      editorMemberId,
      LEGACY_PATCH_MEMBER_ID,
      LEGACY_REMOVE_MEMBER_ID,
    ]);
    expect(items.map((item) => item.role)).toEqual(["owner", "editor", "viewer", "viewer"]);
  });

  it("keeps 403 for a non-admin actor on a v4 member row (permissions unchanged)", async () => {
    const patchAttempt = await request(app.getHttpServer())
      .patch(membersUrl(LEGACY_REMOVE_MEMBER_ID))
      .set("x-test-user", editorUserId)
      .send({ role: "editor" });

    expect(patchAttempt.status, JSON.stringify(patchAttempt.body)).toBe(403);
    expect(patchAttempt.body.code).toBe("WORKSPACE_ROLE_FORBIDDEN");

    const removeAttempt = await request(app.getHttpServer())
      .delete(membersUrl(LEGACY_REMOVE_MEMBER_ID))
      .set("x-test-user", editorUserId);

    expect(removeAttempt.status, JSON.stringify(removeAttempt.body)).toBe(403);
    expect(removeAttempt.body.code).toBe("WORKSPACE_ROLE_FORBIDDEN");

    // Neither rejected call touched the row.
    const untouched = await prisma.workspaceMember.findUnique({
      where: { id: LEGACY_REMOVE_MEMBER_ID },
    });
    expect(untouched?.role).toBe("viewer");
    expect(untouched?.status).toBe("active");
  });

  it("still rejects a non-uuid memberId with 400 (format validation kept)", async () => {
    const hyphenless = LEGACY_PATCH_MEMBER_ID.replaceAll("-", "");
    const response = await request(app.getHttpServer())
      .patch(membersUrl(hyphenless))
      .set("x-test-user", ownerUserId)
      .send({ role: "editor" });

    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a well-formed v4 member id that is not in this Workspace", async () => {
    const response = await request(app.getHttpServer())
      .patch(membersUrl(ABSENT_LEGACY_MEMBER_ID))
      .set("x-test-user", ownerUserId)
      .send({ role: "editor" });

    expect(response.status, JSON.stringify(response.body)).toBe(404);
    expect(response.body.code).toBe("MEMBER_NOT_FOUND");
  });

  it("PATCH /members/:memberId changes the role of a v4 row (200, persisted)", async () => {
    const response = await request(app.getHttpServer())
      .patch(membersUrl(LEGACY_PATCH_MEMBER_ID))
      .set("x-test-user", ownerUserId)
      .send({ role: "editor" });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.id).toBe(LEGACY_PATCH_MEMBER_ID);
    expect(response.body.role).toBe("editor");
    // The response itself must satisfy the widened contract.
    expect(() => UpdateMemberResponseSchema.parse(response.body)).not.toThrow();

    const stored = await prisma.workspaceMember.findUnique({
      where: { id: LEGACY_PATCH_MEMBER_ID },
    });
    expect(stored?.role).toBe("editor");

    // And the read path serves the new role for that v4 row.
    const page = await request(app.getHttpServer())
      .get(membersUrl())
      .set("x-test-user", ownerUserId);
    const row = (page.body.items as Array<{ id: string; role: string }>).find(
      (item) => item.id === LEGACY_PATCH_MEMBER_ID,
    );
    expect(row?.role).toBe("editor");
  });

  it("DELETE /members/:memberId removes a v4 row (200, gone from PostgreSQL)", async () => {
    const response = await request(app.getHttpServer())
      .delete(membersUrl(LEGACY_REMOVE_MEMBER_ID))
      .set("x-test-user", ownerUserId);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.message).toBe("Member removed.");

    expect(
      await prisma.workspaceMember.findUnique({ where: { id: LEGACY_REMOVE_MEMBER_ID } }),
    ).toBeNull();

    const page = await request(app.getHttpServer())
      .get(membersUrl())
      .set("x-test-user", ownerUserId);
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body.items).toHaveLength(3);
    expect(
      (page.body.items as Array<{ id: string }>).some((item) => item.id === LEGACY_REMOVE_MEMBER_ID),
    ).toBe(false);
  });
});