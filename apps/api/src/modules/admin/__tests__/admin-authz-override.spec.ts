import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PlatformRole } from "@roamlog/contracts";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor, AuthenticatedRequest } from "../../../common/guards/actor-context.js";
import { SessionGuard } from "../../../common/guards/session.guard.js";
import { AppConfigService } from "../../../config/app-config.service.js";
import { makeActor, USER_ADMIN_ID, USER_OWNER_ID } from "../../../../test/identity-fixtures.js";
import { AdminContentController } from "../admin-content.controller.js";
import { AdminContentService } from "../admin-content.service.js";
import { AdminMediaService } from "../admin-media.service.js";
import { AdminPermissionsController } from "../admin-permissions.controller.js";
import { AdminPermissionsService } from "../admin-permissions.service.js";
import { assertAdminAction } from "../admin-access.js";
import { ADMIN_AUTHZ_PORT, AdminAuthzService } from "../admin-authz.service.js";
import { AdminGuard } from "../admin.guard.js";
import { PlatformTwoFactorGuard } from "../platform-two-factor.guard.js";
import { AuditService } from "../../audit/audit.service.js";
import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";

interface OverrideRow {
  role: string;
  action: string;
  granted: boolean;
  updatedAt: Date;
}

interface UpsertArgs {
  where: { role_action: { role: string; action: string } };
  create: { role: string; action: string; granted: boolean; updatedById: string };
  update: { granted: boolean; updatedById: string };
}

interface DeleteManyArgs {
  where: { role: string; action: string };
}

/**
 * Minimal in-memory stand-in for the two Prisma calls the override layer uses.
 * The unique (role, action) key mirrors `PlatformRoleOverride`'s compound id.
 */
function createFakePrisma() {
  const rows = new Map<string, OverrideRow>();
  const key = (role: string, action: string): string => `${role}:${action}`;

  const client = {
    platformRoleOverride: {
      findMany: vi.fn(async () =>
        [...rows.values()]
          .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
          .map(({ role, action, granted }) => ({ role, action, granted })),
      ),
      upsert: vi.fn(async (args: UpsertArgs) => {
        const { role, action } = args.where.role_action;
        rows.set(key(role, action), {
          ...rows.get(key(role, action)),
          ...args.create,
          ...args.update,
          role,
          action,
          updatedAt: new Date(),
        });
        return null;
      }),
      deleteMany: vi.fn(async (args: DeleteManyArgs) => {
        const removed = rows.delete(key(args.where.role, args.where.action));
        return { count: removed ? 1 : 0 };
      }),
    },
    $transaction: vi.fn(
      async (callback: (transaction: typeof client) => unknown) => callback(client),
    ),
  };

  return { client, rows, key };
}

const apps: INestApplication[] = [];

async function createApp() {
  const prisma = createFakePrisma();
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  };
  const audit = { record: vi.fn(async () => ({ id: "audit-id" })) };
  const content = {
    // Real services re-assert the action; the double does the same so the test
    // covers the guard + actor + inner assertion together.
    listTrips: vi.fn(async (actor: AuthenticatedActor) => {
      assertAdminAction(actor, "admin:content:read");
      return { items: [], nextCursor: null };
    }),
    listEntries: vi.fn(),
    listComments: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
  };
  const media = { list: vi.fn(), remove: vi.fn() };

  const builder = Test.createTestingModule({
    controllers: [AdminContentController, AdminPermissionsController],
    providers: [
      AdminAuthzService,
      { provide: ADMIN_AUTHZ_PORT, useExisting: AdminAuthzService },
      AdminGuard,
      AdminPermissionsService,
      PlatformTwoFactorGuard,
      { provide: PrismaService, useValue: prisma },
      { provide: PinoLoggerService, useValue: logger },
      { provide: AuditService, useValue: audit },
      { provide: AppConfigService, useValue: { adminTwoFactorEnforced: false } },
      { provide: AdminContentService, useValue: content },
      { provide: AdminMediaService, useValue: media },
    ],
  });

  builder.overrideGuard(SessionGuard).useValue({
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
      const role = req.headers["x-test-role"];
      if (typeof role !== "string" || !role) {
        throw new UnauthorizedException({
          code: "UNAUTHENTICATED",
          message: "A valid session is required.",
        });
      }
      req.user = makeActor(role === "super_admin" ? USER_ADMIN_ID : USER_OWNER_ID, {
        platformRole: role as PlatformRole,
      }).user;
      return true;
    },
  });

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("v1");
  await app.init();
  apps.push(app);
  return { app, prisma, content, logger };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function header(role: PlatformRole) {
  return { "x-test-role": role };
}

describe("permission-matrix override runtime effect", () => {
  it("turns a 403 into a 200 after a grant and back into a 403 after revocation", async () => {
    const { app, content } = await createApp();
    const server = app.getHttpServer();

    const denied = await request(server)
      .get("/v1/admin/trips")
      .set(header("analyst"));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("ADMIN_ACCESS_DENIED");
    expect(content.listTrips).not.toHaveBeenCalled();

    const granted = await request(server)
      .patch("/v1/admin/permissions")
      .set(header("super_admin"))
      .send({ changes: [{ role: "analyst", action: "admin:content:read", granted: true }] })
      .expect(200);
    const analystActions = (
      granted.body as { roles: Array<{ role: string; actions: string[] }> }
    ).roles.find((entry) => entry.role === "analyst");
    expect(analystActions?.actions).toContain("admin:content:read");

    const allowed = await request(server)
      .get("/v1/admin/trips")
      .set(header("analyst"));
    expect(allowed.status).toBe(200);
    expect(content.listTrips).toHaveBeenCalledTimes(1);

    await request(server)
      .patch("/v1/admin/permissions")
      .set(header("super_admin"))
      .send({ changes: [{ role: "analyst", action: "admin:content:read", granted: false }] })
      .expect(200);

    const deniedAgain = await request(server)
      .get("/v1/admin/trips")
      .set(header("analyst"));
    expect(deniedAgain.status).toBe(403);
    expect(deniedAgain.body.code).toBe("ADMIN_ACCESS_DENIED");
    expect(content.listTrips).toHaveBeenCalledTimes(1);
  });

  it("keeps super_admin access when an override tries to revoke it", async () => {
    const { app, prisma, content } = await createApp();
    const server = app.getHttpServer();

    // Simulate a corrupt row written directly to the table.
    prisma.rows.set(prisma.key("super_admin", "admin:content:read"), {
      role: "super_admin",
      action: "admin:content:read",
      granted: false,
      updatedAt: new Date(),
    });

    await request(server)
      .get("/v1/admin/trips")
      .set(header("super_admin"))
      .expect(200);
    expect(content.listTrips).toHaveBeenCalledTimes(1);
  });
});