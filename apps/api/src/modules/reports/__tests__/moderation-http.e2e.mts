/**
 * B4 moderation HTTP harness.
 *
 * Boots a real Nest HTTP server on 127.0.0.1:4220 with the production Reports,
 * Trips, Audit, Prisma and storage wiring against the isolated `b4_e2e`
 * PostgreSQL schema, then drives the whole report → triage → remove → restore
 * loop with `fetch`. Authentication is injected through the same SessionGuard
 * seam the other API E2E specs use (`x-test-user`), because the harness focuses
 * on moderation semantics rather than better-auth enrollment.
 *
 * Not part of the unit suite (`*.mts`, not `*.test.ts`). Run:
 *   ROAMLOG_TEST_DATABASE_URL=... node --import tsx \
 *     src/modules/reports/__tests__/moderation-http.e2e.mts
 */
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { createPrismaClient } from "@roamlog/db";

import { AppConfigModule } from "../../../config/app-config.module.js";
import { configureApp } from "../../../bootstrap/configure-app.js";
import { SessionGuard } from "../../../common/guards/session.guard.js";
import { SanitizeModule } from "../../../common/services/sanitize.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { EmailModule } from "../../email/mail.module.js";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { RedisModule } from "../../redis/redis.module.js";
import { RedisService } from "../../redis/redis.service.js";
import { StorageModule } from "../../storage/storage.module.js";
import { StorageService } from "../../storage/storage.service.js";
import { TripsModule } from "../../trips/trips.module.js";
import { AdminReportsService } from "../admin-reports.service.js";
import { ReportsModule } from "../reports.module.js";

const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.error("ROAMLOG_TEST_DATABASE_URL is required");
  process.exit(2);
}

const prisma = createPrismaClient({ connectionString: databaseUrl });
const API = "http://127.0.0.1:4220";
const TEST_NOW = new Date("2026-11-19T08:00:00.000Z");
const ids = {
  alice: "01942f30-1200-7000-8000-00000000a001",
  bob: "01942f30-1200-7000-8000-00000000a002",
  ops: "01942f30-1200-7000-8000-00000000a003",
  workspace: "01942f30-1200-7000-8000-00000000b001",
  aliceMember: "01942f30-1200-7000-8000-00000000b002",
  bobMember: "01942f30-1200-7000-8000-00000000b003",
  trip: "01942f30-1200-7000-8000-00000000c001",
};

function headerSessionGuard() {
  const actors: Record<string, unknown> = {
    alice: {
      id: ids.alice,
      email: "alice@b4.roamlog.test",
      emailVerified: true,
      name: "Alice",
      image: null,
      platformRole: "user",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      lastActiveAt: TEST_NOW.toISOString(),
      createdAt: TEST_NOW.toISOString(),
      updatedAt: TEST_NOW.toISOString(),
      deletedAt: null,
    },
    bob: {
      id: ids.bob,
      email: "bob@b4.roamlog.test",
      emailVerified: true,
      name: "Bob",
      image: null,
      platformRole: "user",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      lastActiveAt: TEST_NOW.toISOString(),
      createdAt: TEST_NOW.toISOString(),
      updatedAt: TEST_NOW.toISOString(),
      deletedAt: null,
    },
    ops: {
      id: ids.ops,
      email: "ops@b4.roamlog.test",
      emailVerified: true,
      name: "Ops",
      image: null,
      platformRole: "admin",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      lastActiveAt: TEST_NOW.toISOString(),
      createdAt: TEST_NOW.toISOString(),
      updatedAt: TEST_NOW.toISOString(),
      deletedAt: null,
    },
  };
  return {
    canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
      const request = context.switchToHttp().getRequest() as {
        headers?: Record<string, string | undefined>;
        user?: unknown;
      };
      const actor = request.headers?.["x-test-user"]
        ? actors[request.headers["x-test-user"] as keyof typeof actors]
        : undefined;
      if (!actor) {
        throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
      }
      request.user = actor;
      return true;
    },
  };
}

interface Json {
  [key: string]: unknown;
}

let reportOne = "";
let reportTwo = "";

function log(step: string, status: number, body: unknown): void {
  const printable = typeof body === "string" ? body.slice(0, 400) : JSON.stringify(body);
  console.log(`\n## ${step}\nHTTP ${status}\n${printable}`);
}

async function call(
  who: "alice" | "bob" | "ops",
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "x-test-user": who,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: Json = {};
  try {
    parsed = text ? (JSON.parse(text) as Json) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function main(): Promise<void> {
  await prisma.$connect();
  const now = new Date("2026-11-19T08:00:00.000Z");

  // --- Isolated fixture: users, one workspace with two members, one trip. ---
  await prisma.$executeRawUnsafe(`DELETE FROM "Report" WHERE "workspaceId" = '${ids.workspace}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "Trip" WHERE "workspaceId" = '${ids.workspace}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "WorkspaceMember" WHERE "workspaceId" = '${ids.workspace}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "Workspace" WHERE "id" = '${ids.workspace}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" IN ('${ids.alice}','${ids.bob}','${ids.ops}')`);

  await prisma.$transaction(async (tx) => {
    for (const [id, email, name, role] of [
      [ids.alice, "alice@b4.roamlog.test", "Alice", "user"],
      [ids.bob, "bob@b4.roamlog.test", "Bob", "user"],
      [ids.ops, "ops@b4.roamlog.test", "Ops", "admin"],
    ] as const) {
      await tx.user.create({
        data: {
          id,
          email,
          name,
          emailVerified: true,
          platformRole: role,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    await tx.workspace.create({
      data: {
        id: ids.workspace,
        name: "B4 Studio",
        slug: "b4-studio",
        ownerId: ids.alice,
        createdAt: now,
        updatedAt: now,
      },
    });
    await tx.workspaceMember.create({
      data: {
        id: ids.aliceMember,
        workspaceId: ids.workspace,
        userId: ids.alice,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      },
    });
    await tx.workspaceMember.create({
      data: {
        id: ids.bobMember,
        workspaceId: ids.workspace,
        userId: ids.bob,
        role: "viewer",
        createdAt: now,
        updatedAt: now,
      },
    });
    await tx.trip.create({
      data: {
        id: ids.trip,
        workspaceId: ids.workspace,
        title: "B4 Kyoto Trip",
        summary: "moderation e2e",
        startDate: new Date("2026-11-20T00:00:00.000Z"),
        endDate: new Date("2026-11-22T00:00:00.000Z"),
        origin: "Shanghai",
        destinations: ["Kyoto"],
        createdById: ids.alice,
        updatedById: ids.alice,
        createdAt: now,
        updatedAt: now,
      },
    });
  });

  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, SanitizeModule, PrismaModule, RedisModule, StorageModule, EmailModule, AuditModule, TripsModule, ReportsModule],
  })
    .overrideProvider(SessionGuard)
    .useValue(headerSessionGuard())
    .overrideProvider(RedisService)
    .useValue({ ping: async () => undefined, get: async () => null, set: async () => "OK" })
    .overrideProvider(StorageService)
    .useValue({
      checkHealth: async () => undefined,
      presignGet: async () => null,
      presignDownload: async () => null,
    })
    .overrideGuard(SessionGuard)
    .useValue(headerSessionGuard())
    .compile();

  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  await app.listen(4220);

  try {
    // 0. The fixture is visible before moderation.
    const before = await call("alice", "GET", `/v1/trips/${ids.trip}`);
    log("member A GET trip before reports", before.status, before.body);

    // 1. Member A reports the trip.
    const created = await call("alice", "POST", `/v1/workspaces/${ids.workspace}/reports`, {
      targetType: "trip",
      targetId: ids.trip,
      reason: "spam",
      detail: "重复广告",
    });
    reportOne = String(created.body.id ?? "");
    log("member A POST report (201)", created.status, created.body);

    // 2. Same member, same target → duplicate.
    const duplicate = await call("alice", "POST", `/v1/workspaces/${ids.workspace}/reports`, {
      targetType: "trip",
      targetId: ids.trip,
      reason: "spam",
    });
    log("member A duplicate report (409 REPORT_DUPLICATE)", duplicate.status, duplicate.body);

    // 2b. Viewer B reports the same target → second open report.
    const second = await call("bob", "POST", `/v1/workspaces/${ids.workspace}/reports`, {
      targetType: "trip",
      targetId: ids.trip,
      reason: "harassment",
      detail: "人身攻击",
    });
    reportTwo = String(second.body.id ?? "");
    log("viewer B POST report (201)", second.status, second.body);

    // 3. Admin queue contains the report with a target snapshot + aggregate.
    const queue = await call("ops", "GET", `/v1/admin/reports?status=open&targetType=trip&limit=20`);
    log("admin GET /v1/admin/reports (200)", queue.status, queue.body);

    // 4. Remove: target becomes invisible to the normal trip read.
    const remove = await call("ops", "POST", `/v1/admin/reports/${reportOne}/resolve`, {
      action: "remove",
      note: "广告刷屏，下架",
    });
    log("admin resolve report 1 remove (200)", remove.status, remove.body);

    const hidden = await call("alice", "GET", `/v1/trips/${ids.trip}`);
    log("member A GET trip after remove (404)", hidden.status, hidden.body);

    // 4b. A closed report cannot be resolved again.
    const again = await call("ops", "POST", `/v1/admin/reports/${reportOne}/resolve`, {
      action: "dismiss",
    });
    log("admin re-resolve closed report (409 REPORT_ALREADY_RESOLVED)", again.status, again.body);

    // 5. Restore through the second, still-open report.
    const restore = await call("ops", "POST", `/v1/admin/reports/${reportTwo}/resolve`, {
      action: "restore",
      note: "误判，恢复",
    });
    log("admin resolve report 2 restore (200)", restore.status, restore.body);

    const visible = await call("alice", "GET", `/v1/trips/${ids.trip}`);
    log("member A GET trip after restore (200)", visible.status, visible.body);

    // 6. Audit trail: two decisions, metadata only, no content body.
    const audit = await prisma.auditLog.findMany({
      where: { action: "admin.report.resolved", targetId: { in: [reportOne, reportTwo] } },
      orderBy: { createdAt: "asc" },
      select: { action: true, targetType: true, targetId: true, metadata: true },
    });
    log("audit rows admin.report.resolved", 200, audit);

    const detail = await call("ops", "GET", `/v1/admin/reports/${reportOne}`);
    log("admin GET report detail (200)", detail.status, detail.body);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error("B4 harness failed:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});