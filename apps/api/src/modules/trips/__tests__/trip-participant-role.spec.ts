/**
 * Integration tests for VIS_PARTICIPANT_ROLE_AUTH.
 *
 * The product rule: a Workspace `viewer` may be promoted to `editor` on one
 * trip through `TripParticipant.role`. Before this task the request layer only
 * ever saw the Workspace role, so the promotion was a fake feature: the UI
 * said "editor" but every `PermissionService.assertCan(membership.role, ...)`
 * call still used `viewer`.
 *
 * These tests build the real guard chain (`ContentTenantGuard` → `TenantGuard`
 * → `TripParticipantRoleGuard` → `RolesGuard`) over a real disposable
 * PostgreSQL schema, then hand the resolved membership to the real services.
 * That covers the request layer *and* the 72 `assertCan(membership.role, ...)`
 * call sites without mocking the permission decision.
 *
 * Without `ROAMLOG_TEST_DATABASE_URL` the suite skips, matching the existing
 * `access-grants.spec.ts` / `visibility-parity.spec.ts` harness.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExecutionContext } from "@nestjs/common";
import { createPrismaClient } from "@roamlog/db";
import type { ResourceKind, User, WorkspaceAction } from "@roamlog/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import { RolesGuard } from "../../../common/guards/roles.guard.js";
import { SessionGuard } from "../../../common/guards/session.guard.js";
import { TenantGuard } from "../../../common/guards/tenant.guard.js";
import { TripParticipantRoleGuard } from "../../../common/guards/trip-participant-role.guard.js";
import { VerifiedEmailGuard } from "../../../common/guards/verified-email.guard.js";
import { PERMISSION_METADATA } from "../../../common/guards/require-permission.decorator.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import { WorkspaceAccessService } from "../../../common/services/workspace-access.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { ActivitiesService } from "../../activities/activities.service.js";
import { PackingRepository } from "../../packing/packing.repository.js";
import { PackingService } from "../../packing/packing.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { WorkspacesService } from "../../workspaces/workspaces.service.js";
import { ContentTenantGuard } from "../content-tenant.guard.js";
import { CONTENT_TENANT_RESOURCE } from "../content-tenant.decorator.js";
import { StopsRepository } from "../stops.repository.js";
import { StopsService } from "../stops.service.js";
import { TripsRepository } from "../trips.repository.js";
import { TripsService } from "../trips.service.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const databaseUrl = testDatabaseUrl ?? "";
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED trip participant role integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Point it at a disposable PostgreSQL database; this spec creates and drops its own schema on every run.\n",
  );
}

/** `apps/api/src/modules/trips/__tests__` -> repository root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../");
const databaseRoot = resolve(repoRoot, "packages/db");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const prismaSchema = resolve(databaseRoot, "prisma/schema.prisma");

const schemaName = `trip_role_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;

function fixtureId(ordinal: number): string {
  return `0197d00d-0000-7000-8000-${String(ordinal).padStart(12, "0")}`;
}

const WORKSPACE = {
  home: fixtureId(1),
  other: fixtureId(2),
} as const;

const TRIP = {
  main: fixtureId(101),
  other: fixtureId(102),
  foreign: fixtureId(103),
} as const;

const USER = {
  owner: fixtureId(201),
  admin: fixtureId(202),
  editor: fixtureId(203),
  viewerEditor: fixtureId(204),
  viewerViewer: fixtureId(205),
  viewerOutsider: fixtureId(206),
  otherTripEditor: fixtureId(207),
  otherOwner: fixtureId(208),
} as const;

type WorkspaceRoleName = WorkspaceMembershipAccess["role"];

const MEMBERSHIPS: ReadonlyArray<{
  userId: string;
  workspaceId: string;
  role: WorkspaceRoleName;
}> = [
  { userId: USER.owner, workspaceId: WORKSPACE.home, role: "owner" },
  { userId: USER.admin, workspaceId: WORKSPACE.home, role: "admin" },
  { userId: USER.editor, workspaceId: WORKSPACE.home, role: "editor" },
  { userId: USER.viewerEditor, workspaceId: WORKSPACE.home, role: "viewer" },
  { userId: USER.viewerViewer, workspaceId: WORKSPACE.home, role: "viewer" },
  { userId: USER.viewerOutsider, workspaceId: WORKSPACE.home, role: "viewer" },
  { userId: USER.otherTripEditor, workspaceId: WORKSPACE.home, role: "viewer" },
  { userId: USER.otherOwner, workspaceId: WORKSPACE.other, role: "owner" },
];

const TRIP_DATES = {
  start: new Date("2026-05-01T00:00:00.000Z"),
  end: new Date("2026-05-10T00:00:00.000Z"),
} as const;

function userFor(userId: string): User {
  return {
    id: userId,
    email: `${userId.slice(-4)}@trip-role.test`,
    emailVerified: true,
    name: "Trip role fixture user",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "en",
    timezone: "UTC",
    lastActiveAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  } as unknown as User;
}

function actorFor(userId: string): AuthenticatedActor {
  return { user: userFor(userId), ip: null, userAgent: null };
}

function membershipFor(
  userId: string,
  workspaceId: string,
  role: WorkspaceRoleName,
): WorkspaceMembershipAccess {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `membership-${userId}-${workspaceId}`,
    workspaceId,
    userId,
    role,
    status: "active",
    joinedAt: now,
    invitedById: null,
    createdAt: now,
    updatedAt: now,
    workspaceName: "Trip role fixture workspace",
  };
}

interface TestRequest {
  params: Record<string, string | undefined>;
  headers: Record<string, string>;
  ip: string;
  user?: User;
  workspaceMembership?: WorkspaceMembershipAccess;
}

function contextFor(
  request: TestRequest,
  permission?: { action: WorkspaceAction; resource: ResourceKind },
): ExecutionContext {
  const handler = function protectedHandler(): void {};
  // Every trip-content controller declares `@ContentTenant("trip")` on the
  // handler; this reproduces the metadata the real guard reads at runtime.
  Reflect.defineMetadata(CONTENT_TENANT_RESOURCE, "trip", handler);
  if (permission) {
    Reflect.defineMetadata(PERMISSION_METADATA, permission, handler);
  }
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => handler,
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

let adminClient: ReturnType<typeof createPrismaClient> | undefined;
let prisma: ReturnType<typeof createPrismaClient> | undefined;
let prismaService: PrismaService;
let accessService: WorkspaceAccessService;
let contentGuard: ContentTenantGuard;
let rolesGuard: RolesGuard;
let tripParticipantRoleGuard: TripParticipantRoleGuard;
let tripsService: TripsService;
let stopsService: StopsService;
let packingService: PackingService;
let workspacesService: WorkspacesService;

function requiredClient(): ReturnType<typeof createPrismaClient> {
  if (!prisma) {
    throw new Error("The scoped Prisma client is not connected.");
  }
  return prisma;
}

async function seedFixtures(client: ReturnType<typeof createPrismaClient>): Promise<void> {
  await client.user.createMany({
    data: [
      { id: USER.owner, email: "owner@trip-role.test", name: "Owner User" },
      { id: USER.admin, email: "admin@trip-role.test", name: "Admin User" },
      { id: USER.editor, email: "editor@trip-role.test", name: "Editor User" },
      { id: USER.viewerEditor, email: "viewer-editor@trip-role.test", name: "Promoted Viewer" },
      { id: USER.viewerViewer, email: "viewer-viewer@trip-role.test", name: "Viewer Participant" },
      { id: USER.viewerOutsider, email: "viewer-outsider@trip-role.test", name: "Non Participant" },
      { id: USER.otherTripEditor, email: "other-trip@trip-role.test", name: "Other Trip Editor" },
      { id: USER.otherOwner, email: "other-owner@trip-role.test", name: "Other Workspace Owner" },
    ],
  });

  await client.workspace.createMany({
    data: [
      { id: WORKSPACE.home, name: "Home Workspace", slug: "trip-role-home", ownerId: USER.owner },
      {
        id: WORKSPACE.other,
        name: "Other Workspace",
        slug: "trip-role-other",
        ownerId: USER.otherOwner,
      },
    ],
  });

  await client.workspaceMember.createMany({
    data: MEMBERSHIPS.map((membership) => ({
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      role: membership.role,
    })),
  });

  await client.trip.createMany({
    data: [
      {
        id: TRIP.main,
        workspaceId: WORKSPACE.home,
        title: "Main trip",
        startDate: TRIP_DATES.start,
        endDate: TRIP_DATES.end,
        origin: "Shanghai",
        visibility: "workspace",
        createdById: USER.owner,
        updatedById: USER.owner,
      },
      {
        id: TRIP.other,
        workspaceId: WORKSPACE.home,
        title: "Other trip",
        startDate: TRIP_DATES.start,
        endDate: TRIP_DATES.end,
        origin: "Shanghai",
        visibility: "workspace",
        createdById: USER.owner,
        updatedById: USER.owner,
      },
      {
        id: TRIP.foreign,
        workspaceId: WORKSPACE.other,
        title: "Foreign trip",
        startDate: TRIP_DATES.start,
        endDate: TRIP_DATES.end,
        origin: "Osaka",
        visibility: "workspace",
        createdById: USER.otherOwner,
        updatedById: USER.otherOwner,
      },
    ],
  });

  await client.tripParticipant.createMany({
    data: [
      {
        workspaceId: WORKSPACE.home,
        tripId: TRIP.main,
        userId: USER.viewerEditor,
        role: "editor",
        status: "joined",
      },
      {
        workspaceId: WORKSPACE.home,
        tripId: TRIP.main,
        userId: USER.viewerViewer,
        role: "viewer",
        status: "joined",
      },
      {
        workspaceId: WORKSPACE.home,
        tripId: TRIP.other,
        userId: USER.otherTripEditor,
        role: "editor",
        status: "joined",
      },
    ],
  });
}

/**
 * Runs the real guard chain exactly as Nest does for
 * `@UseGuards(ContentTenantGuard, RolesGuard)` on `/v1/trips/:tripId`:
 * ContentTenantGuard resolves the trip workspace, delegates to TenantGuard for
 * the Workspace membership, then invokes TripParticipantRoleGuard.
 */
async function enterTrip(
  userId: string,
  tripId: string,
  action: WorkspaceAction,
  resource: ResourceKind,
): Promise<{
  request: TestRequest;
  membership: WorkspaceMembershipAccess;
  actor: AuthenticatedActor;
}> {
  const request: TestRequest = {
    params: { tripId },
    headers: {},
    ip: "127.0.0.1",
    user: userFor(userId),
  };
  const context = contextFor(request, { action, resource });
  await contentGuard.canActivate(context);
  // RolesGuard is the same gate the controllers run before the handler. If the
  // effective role was not upgraded it throws 403 here, before the service.
  rolesGuard.canActivate(context);

  if (!request.workspaceMembership) {
    throw new Error("The guard chain did not resolve a Workspace membership.");
  }
  return { request, membership: request.workspaceMembership, actor: actorFor(userId) };
}

async function expectForbidden(
  userId: string,
  tripId: string,
  action: WorkspaceAction,
  resource: ResourceKind,
): Promise<void> {
  await expect(enterTrip(userId, tripId, action, resource)).rejects.toMatchObject({
    status: 403,
    response: { code: "WORKSPACE_ROLE_FORBIDDEN" },
  });
}

integration("trip participant role authorization on real PostgreSQL", () => {
  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("ROAMLOG_TEST_DATABASE_URL disappeared while the suite was loading.");
    }
    if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(schemaName)) {
      throw new Error(`Refusing unsafe test schema name: ${schemaName}`);
    }
    if (!existsSync(prismaCli) || !existsSync(prismaSchema)) {
      throw new Error("The Prisma CLI or the database schema path is unavailable.");
    }

    adminClient = createPrismaClient({ connectionString: databaseUrl });
    await adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminClient.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);

    const scoped = new URL(databaseUrl);
    scoped.searchParams.set("schema", schemaName);
    const scopedUrl = scoped.toString();

    const migration = spawnSync(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--schema", prismaSchema],
      {
        cwd: databaseRoot,
        env: { ...process.env, DATABASE_URL: scopedUrl },
        encoding: "utf8",
      },
    );
    if (migration.status !== 0) {
      const diagnostic = `${migration.stdout ?? ""}\n${migration.stderr ?? ""}`.trim();
      throw new Error(
        `prisma migrate deploy failed (exit ${String(migration.status)}): ${diagnostic.slice(-2000)}`,
      );
    }

    prisma = createPrismaClient({ connectionString: scopedUrl });
    await prisma.$queryRaw`SELECT 1`;
    await seedFixtures(prisma);

    prismaService = { client: requiredClient() } as unknown as PrismaService;
    accessService = new WorkspaceAccessService(prismaService);
    const sessionGuard = new SessionGuard({} as never, prismaService);
    const verifiedEmailGuard = new VerifiedEmailGuard();
    tripParticipantRoleGuard = new TripParticipantRoleGuard(prismaService);
    const tenantGuard = new TenantGuard(sessionGuard, verifiedEmailGuard, accessService);
    contentGuard = new ContentTenantGuard(
      prismaService,
      sessionGuard,
      verifiedEmailGuard,
      tenantGuard,
      tripParticipantRoleGuard,
    );
    rolesGuard = new RolesGuard();

    const activities = { record: async () => ({ id: "activity-record" }) } as unknown as ActivitiesService;
    const tripsRepository = new TripsRepository(prismaService);
    tripsService = new TripsService(
      tripsRepository,
      new PermissionService(),
      activities,
      undefined,
      undefined,
      prismaService,
    );
    stopsService = new StopsService(new StopsRepository(prismaService), new PermissionService(), activities);
    packingService = new PackingService(
      new PackingRepository(prismaService),
      tripsRepository,
      new PermissionService(),
      activities,
    );
    workspacesService = new WorkspacesService(
      prismaService,
      accessService,
      {} as never,
      new PermissionService(),
    );
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminClient) {
      try {
        await adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } catch (error) {
        process.stderr.write(`WARN: could not drop ${schemaName}: ${String(error)}\n`);
      }
      await adminClient.$disconnect();
    }
  }, 60_000);

  beforeEach(async () => {
    const client = requiredClient();
    await client.stop.deleteMany({ where: { tripId: { in: [TRIP.main, TRIP.other, TRIP.foreign] } } });
    await client.packingItem.deleteMany({
      where: { tripId: { in: [TRIP.main, TRIP.other, TRIP.foreign] } },
    });
    await client.tripParticipant.deleteMany({
      where: { tripId: { in: [TRIP.main, TRIP.other, TRIP.foreign] } },
    });
    await client.tripParticipant.createMany({
      data: [
        {
          workspaceId: WORKSPACE.home,
          tripId: TRIP.main,
          userId: USER.viewerEditor,
          role: "editor",
          status: "joined",
        },
        {
          workspaceId: WORKSPACE.home,
          tripId: TRIP.main,
          userId: USER.viewerViewer,
          role: "viewer",
          status: "joined",
        },
        {
          workspaceId: WORKSPACE.home,
          tripId: TRIP.other,
          userId: USER.otherTripEditor,
          role: "editor",
          status: "joined",
        },
      ],
    });
    await client.trip.updateMany({
      where: { id: { in: [TRIP.main, TRIP.other, TRIP.foreign] } },
      data: { version: 1, title: "Main trip" },
    });
  });

  // -------------------------------------------------------------------------
  // The promotion actually works for trips.update.
  // -------------------------------------------------------------------------

  it("lets a Workspace viewer who is a trip editor PATCH the trip and bumps Trip.version", async () => {
    const { request, membership, actor } = await enterTrip(
      USER.viewerEditor,
      TRIP.main,
      "trip:update",
      "trip",
    );

    expect(request.workspaceMembership?.role).toBe("editor");
    expect(membership.role).toBe("editor");

    const updated = await tripsService.update(actor, membership, TRIP.main, {
      title: "Promoted viewer edit",
      version: 1,
    });

    expect(updated.title).toBe("Promoted viewer edit");
    expect(updated.version).toBe(2);

    const row = await requiredClient().trip.findUniqueOrThrow({
      where: { id: TRIP.main },
      select: { title: true, version: true, updatedById: true },
    });
    expect(row).toEqual({
      title: "Promoted viewer edit",
      version: 2,
      updatedById: USER.viewerEditor,
    });
  });

  it("keeps a Workspace viewer participant with trip role viewer at 403", async () => {
    await expectForbidden(USER.viewerViewer, TRIP.main, "trip:update", "trip");
    const row = await requiredClient().trip.findUniqueOrThrow({
      where: { id: TRIP.main },
      select: { version: true },
    });
    expect(row.version).toBe(1);
  });

  it("keeps a Workspace viewer who is not a trip participant at 403", async () => {
    await expectForbidden(USER.viewerOutsider, TRIP.main, "trip:update", "trip");
  });

  it("does not upgrade a declined invite that still carries the editor role", async () => {
    await requiredClient().tripParticipant.updateMany({
      where: { tripId: TRIP.main, userId: USER.viewerEditor },
      data: { status: "declined" },
    });

    await expectForbidden(USER.viewerEditor, TRIP.main, "trip:update", "trip");
  });

  it("does not let an editor of another trip edit this trip (no cross-trip escalation)", async () => {
    await expectForbidden(USER.otherTripEditor, TRIP.main, "trip:update", "trip");
  });

  // -------------------------------------------------------------------------
  // Regression: owner/admin/editor keep their base Workspace role.
  // -------------------------------------------------------------------------

  it("keeps owner/admin/editor behaviour unchanged", async () => {
    let version = 1;
    const cases = [
      { userId: USER.owner, role: "owner" },
      { userId: USER.admin, role: "admin" },
      { userId: USER.editor, role: "editor" },
    ] as const;

    for (const entry of cases) {
      const { request, membership, actor } = await enterTrip(
        entry.userId,
        TRIP.main,
        "trip:update",
        "trip",
      );
      expect(request.workspaceMembership?.role).toBe(entry.role);
      expect(membership.role).toBe(entry.role);

      const updated = await tripsService.update(actor, membership, TRIP.main, {
        title: `Edited by ${entry.role}`,
        version,
      });
      expect(updated.version).toBe(version + 1);
      version += 1;
    }
  });

  // -------------------------------------------------------------------------
  // The same request-layer upgrade covers different write surfaces.
  // -------------------------------------------------------------------------

  it("lets the promoted viewer create a stop through stops.create", async () => {
    const { membership, actor } = await enterTrip(USER.viewerEditor, TRIP.main, "stop:create", "stop");

    const stop = await stopsService.create(actor, membership, TRIP.main, {
      city: "Kyoto",
      country: "Japan",
      countryCode: "JP",
      startDate: "2026-05-02",
      endDate: "2026-05-03",
    });

    expect(stop.city).toBe("Kyoto");
    const row = await requiredClient().stop.findUniqueOrThrow({
      where: { id: stop.id },
      select: { tripId: true, workspaceId: true, createdById: true },
    });
    expect(row).toEqual({
      tripId: TRIP.main,
      workspaceId: WORKSPACE.home,
      createdById: USER.viewerEditor,
    });
  });

  it("lets the promoted viewer create a packing item through packing.create", async () => {
    const { membership, actor } = await enterTrip(
      USER.viewerEditor,
      TRIP.main,
      "packing:create",
      "packing",
    );

    const item = await packingService.create(actor, membership, TRIP.main, {
      category: "clothing",
      name: "Rain jacket",
      quantity: 2,
    });

    expect(item.name).toBe("Rain jacket");
    const row = await requiredClient().packingItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { tripId: true, workspaceId: true, createdById: true },
    });
    expect(row).toEqual({
      tripId: TRIP.main,
      workspaceId: WORKSPACE.home,
      createdById: USER.viewerEditor,
    });
  });

  it("still denies stops.create and packing.create to a viewer participant", async () => {
    await expectForbidden(USER.viewerViewer, TRIP.main, "stop:create", "stop");
    await expectForbidden(USER.viewerViewer, TRIP.main, "packing:create", "packing");
  });

  // -------------------------------------------------------------------------
  // Cross-workspace and cross-trip protection.
  // -------------------------------------------------------------------------

  it("does not upgrade a foreign Workspace tripId; the request stays 404", async () => {
    await expect(
      enterTrip(USER.viewerEditor, TRIP.foreign, "trip:update", "trip"),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: "WORKSPACE_NOT_FOUND" },
    });

    await expect(
      enterTrip(USER.otherOwner, TRIP.main, "trip:update", "trip"),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: "WORKSPACE_NOT_FOUND" },
    });
  });

  it("ignores a stray participant row whose trip belongs to another Workspace", async () => {
    // Data-level defence in depth: even if a row links this user to a foreign
    // trip, the guard's `trip.workspaceId` predicate must refuse the upgrade.
    await requiredClient().tripParticipant.create({
      data: {
        workspaceId: WORKSPACE.home,
        tripId: TRIP.foreign,
        userId: USER.viewerEditor,
        role: "editor",
        status: "joined",
      },
    });

    const membership = membershipFor(USER.viewerEditor, WORKSPACE.home, "viewer");
    const request: TestRequest = {
      params: { tripId: TRIP.foreign },
      headers: {},
      ip: "127.0.0.1",
      user: userFor(USER.viewerEditor),
      workspaceMembership: membership,
    };

    await tripParticipantRoleGuard.canActivate(contextFor(request));
    expect(request.workspaceMembership).toBe(membership);
    expect(request.workspaceMembership?.role).toBe("viewer");
  });

  // -------------------------------------------------------------------------
  // Guard-level edge cases.
  // -------------------------------------------------------------------------

  it("passes through routes that do not carry a :tripId param", async () => {
    const findFirst = vi.fn();
    const guard = new TripParticipantRoleGuard({
      client: { tripParticipant: { findFirst } },
    } as never);
    const membership = membershipFor(USER.viewerEditor, WORKSPACE.home, "viewer");
    const request: TestRequest = {
      params: { workspaceId: WORKSPACE.home },
      headers: {},
      ip: "127.0.0.1",
      user: userFor(USER.viewerEditor),
      workspaceMembership: membership,
    };

    await guard.canActivate(contextFor(request));

    expect(findFirst).not.toHaveBeenCalled();
    expect(request.workspaceMembership).toBe(membership);
  });

  it("keeps the base role when the participant lookup fails", async () => {
    const guard = new TripParticipantRoleGuard({
      client: {
        tripParticipant: {
          findFirst: vi.fn().mockRejectedValue(new Error("database unavailable")),
        },
      },
    } as never);
    const membership = membershipFor(USER.viewerEditor, WORKSPACE.home, "viewer");
    const request: TestRequest = {
      params: { tripId: TRIP.main },
      headers: {},
      ip: "127.0.0.1",
      user: userFor(USER.viewerEditor),
      workspaceMembership: membership,
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.workspaceMembership).toBe(membership);
    expect(request.workspaceMembership?.role).toBe("viewer");
  });

  // -------------------------------------------------------------------------
  // Display role: the workspace list must keep reporting the stored base role.
  // -------------------------------------------------------------------------

  it("does not leak the trip editor role into the Workspace display role", async () => {
    const { membership } = await enterTrip(USER.viewerEditor, TRIP.main, "trip:update", "trip");
    expect(membership.role).toBe("editor");

    // `GET /v1/workspaces` reads `WorkspaceMember.role` straight from the
    // database, not the request-scoped membership. The promotion must not
    // rewrite the row or the response.
    const workspaces = await workspacesService.list(actorFor(USER.viewerEditor));
    expect(workspaces.find((workspace) => workspace.id === WORKSPACE.home)?.role).toBe("viewer");

    const stored = await accessService.requireMembership(USER.viewerEditor, WORKSPACE.home);
    expect(stored.role).toBe("viewer");
  });
});
