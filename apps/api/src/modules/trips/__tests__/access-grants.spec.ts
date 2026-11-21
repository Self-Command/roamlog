/**
 * Integration tests for the wired-up "指定可见" API (VIS_GRANTS_API).
 *
 * The contract (`SetTripAccessGrantsRequestSchema` /
 * `UpdateParticipantRequestSchema`) and the Prisma models already existed; this
 * spec proves the three new endpoints actually read and write them:
 *
 *   GET  /v1/trips/{tripId}/access-grants
 *   PUT  /v1/trips/{tripId}/access-grants
 *   PATCH /v1/trips/{tripId}/participants/{userId}
 *
 * It builds a disposable PostgreSQL schema from the real migrations (same
 * harness as `visibility-parity.spec.ts`) so the assertions are made against
 * `TripAccessGrant` / `TripParticipant` rows, not mocks. The final end-to-end
 * case feeds those rows back into `resolveTripAccess`, which is the rule every
 * read surface uses: a granted user becomes readable and an ungranted user does
 * not.
 *
 * Without `ROAMLOG_TEST_DATABASE_URL` the suite skips with a note, keeping the
 * regular unit run database-free.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createPrismaClient } from "@roamlog/db";
import type { User } from "@roamlog/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { ActivitiesService } from "../../activities/activities.service.js";
import { CommentsRepository } from "../../comments/comments.repository.js";
import { ExportsRepository } from "../../exports/exports.repository.js";
import { ItineraryRepository } from "../../itinerary/itinerary.repository.js";
import { ItineraryService } from "../../itinerary/itinerary.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { StopsRepository } from "../stops.repository.js";
import { StopsService } from "../stops.service.js";
import { assertTripVisible } from "../content-values.js";
import { resolveTripAccess } from "../trip-access.js";
import { TripsRepository } from "../trips.repository.js";
import { TripsService } from "../trips.service.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const databaseUrl = testDatabaseUrl ?? "";

const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED access-grants integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Point it at a disposable PostgreSQL database; this spec creates and " +
      "drops its own schema on every run.\n",
  );
}

/** `apps/api/src/modules/trips/__tests__` -> repository root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../");
const databaseRoot = resolve(repoRoot, "packages/db");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const prismaSchema = resolve(databaseRoot, "prisma/schema.prisma");

/** Random schema so concurrent runs cannot share DDL state. */
const schemaName = `access_grants_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;

function fixtureId(ordinal: number): string {
  return `0197c0de-0000-7000-8000-${String(ordinal).padStart(12, "0")}`;
}

const WORKSPACE = {
  home: fixtureId(1),
  shared: fixtureId(2),
  other: fixtureId(3),
  foreign: fixtureId(4),
} as const;

const TRIP = {
  custom: fixtureId(101),
  workspace: fixtureId(102),
  editorCreated: fixtureId(103),
} as const;

const ITINERARY = {
  custom: fixtureId(301),
} as const;

const STOP = {
  custom: fixtureId(401),
} as const;

const USER = {
  owner: fixtureId(201),
  admin: fixtureId(202),
  editor: fixtureId(203),
  viewer: fixtureId(204),
  grantee: fixtureId(205),
  ungranted: fixtureId(206),
  outsider: fixtureId(207),
  foreign: fixtureId(208),
} as const;

type WorkspaceRoleName = WorkspaceMembershipAccess["role"];

const MEMBERSHIPS: ReadonlyArray<{
  userId: string;
  workspaceId: string;
  role: WorkspaceRoleName;
}> = [
  { userId: USER.owner, workspaceId: WORKSPACE.home, role: "owner" },
  { userId: USER.owner, workspaceId: WORKSPACE.shared, role: "owner" },
  { userId: USER.admin, workspaceId: WORKSPACE.home, role: "admin" },
  { userId: USER.editor, workspaceId: WORKSPACE.home, role: "editor" },
  { userId: USER.viewer, workspaceId: WORKSPACE.home, role: "viewer" },
  { userId: USER.grantee, workspaceId: WORKSPACE.home, role: "viewer" },
  { userId: USER.ungranted, workspaceId: WORKSPACE.home, role: "viewer" },
  { userId: USER.outsider, workspaceId: WORKSPACE.other, role: "owner" },
  { userId: USER.foreign, workspaceId: WORKSPACE.foreign, role: "owner" },
];

let adminClient: ReturnType<typeof createPrismaClient> | undefined;
let prisma: ReturnType<typeof createPrismaClient> | undefined;
let service: TripsService;
let itineraryService: ItineraryService;
let stopsService: StopsService;
let commentsRepository: CommentsRepository;
let exportsRepository: ExportsRepository;

function requiredClient(): ReturnType<typeof createPrismaClient> {
  if (!prisma) {
    throw new Error("The scoped Prisma client is not connected.");
  }
  return prisma;
}

function membershipFor(
  userId: string,
  workspaceId: string = WORKSPACE.home,
  role: WorkspaceRoleName = "owner",
): WorkspaceMembershipAccess {
  const now = new Date();
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
    workspaceName: "Access-grants fixture workspace",
  };
}

function actorFor(userId: string): AuthenticatedActor {
  return {
    user: { id: userId, platformRole: "user" } as unknown as User,
    ip: null,
    userAgent: null,
  };
}

async function seedFixtures(client: ReturnType<typeof createPrismaClient>): Promise<void> {
  await client.user.createMany({
    data: [
      { id: USER.owner, email: "owner@grants.test", name: "Owner User" },
      { id: USER.admin, email: "admin@grants.test", name: "Admin User" },
      { id: USER.editor, email: "editor@grants.test", name: "Editor User" },
      { id: USER.viewer, email: "viewer@grants.test", name: "Viewer User" },
      { id: USER.grantee, email: "grantee@shared.test", name: "Grantee User" },
      { id: USER.ungranted, email: "ungranted@grants.test", name: "Ungranted User" },
      { id: USER.outsider, email: "outsider@other.test", name: "Outsider User" },
      { id: USER.foreign, email: "foreign@foreign.test", name: "Foreign User" },
    ],
  });

  await client.workspace.createMany({
    data: [
      {
        id: WORKSPACE.home,
        name: "Home Workspace",
        slug: "grants-home",
        ownerId: USER.owner,
      },
      {
        id: WORKSPACE.shared,
        name: "Shared Workspace",
        slug: "grants-shared",
        ownerId: USER.owner,
      },
      {
        id: WORKSPACE.other,
        name: "Other Workspace",
        slug: "grants-other",
        ownerId: USER.outsider,
      },
      {
        id: WORKSPACE.foreign,
        name: "Foreign Workspace",
        slug: "grants-foreign",
        ownerId: USER.foreign,
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
        id: TRIP.custom,
        workspaceId: WORKSPACE.home,
        title: "Custom audience trip",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-05T00:00:00.000Z"),
        origin: "Shanghai",
        visibility: "custom",
        createdById: USER.owner,
        updatedById: USER.owner,
      },
      {
        id: TRIP.workspace,
        workspaceId: WORKSPACE.home,
        title: "Workspace trip",
        startDate: new Date("2026-05-01T00:00:00.000Z"),
        endDate: new Date("2026-05-05T00:00:00.000Z"),
        origin: "Shanghai",
        visibility: "workspace",
        createdById: USER.owner,
        updatedById: USER.owner,
      },
      {
        id: TRIP.editorCreated,
        workspaceId: WORKSPACE.home,
        title: "Editor-created custom trip",
        startDate: new Date("2026-06-01T00:00:00.000Z"),
        endDate: new Date("2026-06-05T00:00:00.000Z"),
        origin: "Shanghai",
        visibility: "custom",
        createdById: USER.editor,
        updatedById: USER.editor,
      },
    ],
  });

  // Participants make the `custom` trip readable to the roles whose write
  // attempt must be rejected with 403 rather than 404.
  await client.tripParticipant.createMany({
    data: [
      {
        workspaceId: WORKSPACE.home,
        tripId: TRIP.custom,
        userId: USER.admin,
        status: "joined",
        role: "viewer",
      },
      {
        workspaceId: WORKSPACE.home,
        tripId: TRIP.custom,
        userId: USER.editor,
        status: "joined",
        role: "editor",
      },
      {
        workspaceId: WORKSPACE.home,
        tripId: TRIP.custom,
        userId: USER.viewer,
        status: "joined",
        role: "viewer",
      },
    ],
  });

  // Child rows the read-path tests below assert on. They belong to the custom
  // trip, so reaching them proves the trip loader carried the grant context.
  await client.itineraryItem.create({
    data: {
      id: ITINERARY.custom,
      tripId: TRIP.custom,
      workspaceId: WORKSPACE.home,
      date: new Date("2026-04-02T00:00:00.000Z"),
      title: "Grant-visible breakfast",
      type: "food",
      location: "Shanghai",
      notes: "",
      createdById: USER.owner,
      updatedById: USER.owner,
    },
  });
  await client.stop.create({
    data: {
      id: STOP.custom,
      tripId: TRIP.custom,
      workspaceId: WORKSPACE.home,
      city: "Shanghai",
      country: "China",
      countryCode: "CN",
      startDate: new Date("2026-04-02T00:00:00.000Z"),
      endDate: new Date("2026-04-03T00:00:00.000Z"),
      notes: "",
      createdById: USER.owner,
      updatedById: USER.owner,
    },
  });
}

async function storedGrants(tripId: string) {
  return requiredClient().tripAccessGrant.findMany({
    where: { tripId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Reads a trip/participation/grants back from PostgreSQL and asks the shared
 * access rule — the same function every read surface uses — whether `userId`
 * can read it. This is the end-to-end semantics of a grant.
 */
async function canRead(userId: string, workspaceId: string, tripId: string): Promise<boolean> {
  const client = requiredClient();
  const [trip, participation, grants] = await Promise.all([
    client.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { id: true, workspaceId: true, createdById: true, visibility: true },
    }),
    client.tripParticipant.findFirst({
      where: { tripId, userId },
      select: { status: true },
    }),
    client.tripAccessGrant.findMany({
      where: { tripId },
      select: { workspaceId: true, userId: true },
    }),
  ]);

  return resolveTripAccess({
    actor: { userId, workspaceId, platformRole: "user" },
    trip,
    participation: participation ?? null,
    grants,
  });
}

integration("trip access grants on real PostgreSQL", () => {
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

    const prismaService = { client: requiredClient() } as unknown as PrismaService;
    const repository = new TripsRepository(prismaService);
    const activities = {
      record: async () => ({ id: "activity-record" }),
    } as unknown as ActivitiesService;
    service = new TripsService(
      repository,
      new PermissionService(),
      activities,
      undefined,
      undefined,
      prismaService,
    );
    itineraryService = new ItineraryService(
      new ItineraryRepository(prismaService),
      repository,
      new PermissionService(),
      activities,
    );
    stopsService = new StopsService(
      new StopsRepository(prismaService),
      new PermissionService(),
      activities,
    );
    commentsRepository = new CommentsRepository(prismaService);
    exportsRepository = new ExportsRepository(prismaService);
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
    await requiredClient().tripAccessGrant.deleteMany({});
    await requiredClient().tripParticipant.updateMany({
      where: { tripId: TRIP.custom, userId: USER.viewer },
      data: { role: "viewer", status: "joined" },
    });
  });

  // -------------------------------------------------------------------------
  // GET: readers only; non-readers get the same 404 as every trip surface.
  // -------------------------------------------------------------------------

  it("GET returns 404 (TRIP_NOT_FOUND) to a user outside the trip's Workspace", async () => {
    await expect(
      service.listAccessGrants(
        actorFor(USER.outsider),
        membershipFor(USER.outsider, WORKSPACE.other, "owner"),
        TRIP.custom,
      ),
    ).rejects.toMatchObject({ status: 404, response: { code: "TRIP_NOT_FOUND" } });
  });

  it("GET returns 404 to a Workspace member who cannot read a custom trip", async () => {
    await expect(
      service.listAccessGrants(
        actorFor(USER.ungranted),
        membershipFor(USER.ungranted, WORKSPACE.home, "viewer"),
        TRIP.custom,
      ),
    ).rejects.toMatchObject({ status: 404, response: { code: "TRIP_NOT_FOUND" } });
  });

  it("GET returns the contract shape with resolved workspace and user labels", async () => {
    await service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
      workspaces: [WORKSPACE.shared],
      users: [USER.grantee],
    });

    const response = await service.listAccessGrants(
      actorFor(USER.owner),
      membershipFor(USER.owner),
      TRIP.custom,
    );

    expect(response.grants).toHaveLength(2);
    expect(response.resolved.workspaces).toEqual([
      {
        targetType: "workspace",
        targetId: WORKSPACE.shared,
        label: "Shared Workspace",
        sublabel: null,
      },
    ]);
    expect(response.resolved.users).toEqual([
      {
        targetType: "user",
        targetId: USER.grantee,
        label: "Grantee User",
        sublabel: "shared.test",
      },
    ]);
  });

  // -------------------------------------------------------------------------
  // PUT: authorization and tenancy.
  // -------------------------------------------------------------------------

  it("PUT returns 404 (not 403) to a non-member, without revealing existence", async () => {
    await expect(
      service.setAccessGrants(
        actorFor(USER.outsider),
        membershipFor(USER.outsider, WORKSPACE.other, "owner"),
        TRIP.custom,
        { workspaces: [], users: [] },
      ),
    ).rejects.toMatchObject({ status: 404, response: { code: "TRIP_NOT_FOUND" } });
  });

  it("PUT rejects a Viewer of the trip with 403 WORKSPACE_ROLE_FORBIDDEN", async () => {
    await expect(
      service.setAccessGrants(
        actorFor(USER.viewer),
        membershipFor(USER.viewer, WORKSPACE.home, "viewer"),
        TRIP.custom,
        { workspaces: [], users: [] },
      ),
    ).rejects.toMatchObject({ status: 403, response: { code: "WORKSPACE_ROLE_FORBIDDEN" } });
  });

  it("PUT rejects a participant Editor with 403 (only owner/admin may re-share)", async () => {
    await expect(
      service.setAccessGrants(
        actorFor(USER.editor),
        membershipFor(USER.editor, WORKSPACE.home, "editor"),
        TRIP.custom,
        { workspaces: [], users: [] },
      ),
    ).rejects.toMatchObject({ status: 403, response: { code: "WORKSPACE_ROLE_FORBIDDEN" } });
  });

  it("PUT lets the owner replace the whole set and records the actor as grantedById", async () => {
    const response = await service.setAccessGrants(
      actorFor(USER.owner),
      membershipFor(USER.owner),
      TRIP.custom,
      { workspaces: [WORKSPACE.shared], users: [USER.grantee] },
    );

    expect(response.grants).toHaveLength(2);
    const rows = await storedGrants(TRIP.custom);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.grantedById === USER.owner)).toBe(true);
    expect(rows.map((row) => row.workspaceId).filter(Boolean)).toEqual([WORKSPACE.shared]);
    expect(rows.map((row) => row.userId).filter(Boolean)).toEqual([USER.grantee]);
  });

  it("PUT allows a Workspace admin who is not the trip creator", async () => {
    const response = await service.setAccessGrants(
      actorFor(USER.admin),
      membershipFor(USER.admin, WORKSPACE.home, "admin"),
      TRIP.custom,
      { workspaces: [], users: [USER.grantee] },
    );

    expect(response.grants).toHaveLength(1);
    expect(await storedGrants(TRIP.custom)).toHaveLength(1);
  });

  it("PUT allows a trip creator whose Workspace role is only Editor", async () => {
    const response = await service.setAccessGrants(
      actorFor(USER.editor),
      membershipFor(USER.editor, WORKSPACE.home, "editor"),
      TRIP.editorCreated,
      { workspaces: [], users: [USER.grantee] },
    );

    expect(response.grants).toHaveLength(1);
    expect(await storedGrants(TRIP.editorCreated)).toHaveLength(1);
  });

  it("PUT refuses a body that tries to supply grantedById", async () => {
    await expect(
      service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
        workspaces: [],
        users: [],
        grantedById: USER.foreign,
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: "VALIDATION_ERROR" } });
    expect(await storedGrants(TRIP.custom)).toHaveLength(0);
  });

  it("PUT rejects cross-tenant workspace and user ids with 400 and writes nothing", async () => {
    await expect(
      service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
        workspaces: [WORKSPACE.foreign],
        users: [],
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: "VALIDATION_ERROR" } });

    await expect(
      service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
        workspaces: [],
        users: [USER.foreign],
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: "VALIDATION_ERROR" } });

    expect(await storedGrants(TRIP.custom)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // PUT: full-set replacement and clearing.
  // -------------------------------------------------------------------------

  it("PUT replaces rather than appends: 2 workspaces + 1 user, then 1 workspace", async () => {
    await service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
      workspaces: [WORKSPACE.home, WORKSPACE.shared],
      users: [USER.grantee],
    });
    expect(await storedGrants(TRIP.custom)).toHaveLength(3);

    await service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
      workspaces: [WORKSPACE.shared],
      users: [],
    });

    const rows = await storedGrants(TRIP.custom);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workspaceId: WORKSPACE.shared, userId: null });
  });

  it("PUT with two empty arrays clears every grant", async () => {
    await service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
      workspaces: [WORKSPACE.shared],
      users: [USER.grantee],
    });
    expect(await storedGrants(TRIP.custom)).toHaveLength(2);

    const response = await service.setAccessGrants(
      actorFor(USER.owner),
      membershipFor(USER.owner),
      TRIP.custom,
      { workspaces: [], users: [] },
    );

    expect(response.grants).toEqual([]);
    expect(await storedGrants(TRIP.custom)).toHaveLength(0);
  });

  it("PUT on a non-custom trip is accepted and the response reflects the stored rows", async () => {
    const response = await service.setAccessGrants(
      actorFor(USER.owner),
      membershipFor(USER.owner),
      TRIP.workspace,
      { workspaces: [WORKSPACE.shared], users: [USER.grantee] },
    );

    expect(response.grants).toHaveLength(2);
    expect(await storedGrants(TRIP.workspace)).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // End-to-end: the written rows change `resolveTripAccess` outcomes.
  // -------------------------------------------------------------------------

  it("grants make the custom trip readable for the grantee and not for an ungranted member", async () => {
    await service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
      workspaces: [],
      users: [USER.grantee],
    });

    expect(await canRead(USER.grantee, WORKSPACE.home, TRIP.custom)).toBe(true);
    expect(await canRead(USER.ungranted, WORKSPACE.home, TRIP.custom)).toBe(false);

    // The granted user can also use the read endpoint itself.
    const response = await service.listAccessGrants(
      actorFor(USER.grantee),
      membershipFor(USER.grantee, WORKSPACE.home, "viewer"),
      TRIP.custom,
    );
    expect(response.grants).toHaveLength(1);
  });

  it("a workspace grant makes the custom trip readable to another member of that Workspace", async () => {
    await service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
      workspaces: [WORKSPACE.home],
      users: [],
    });

    expect(await canRead(USER.ungranted, WORKSPACE.home, TRIP.custom)).toBe(true);
    expect(await canRead(USER.outsider, WORKSPACE.other, TRIP.custom)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // PATCH participant role.
  // -------------------------------------------------------------------------

  it("PATCH promotes a viewer participant to editor for the trip owner", async () => {
    const updated = await service.updateParticipant(
      actorFor(USER.owner),
      membershipFor(USER.owner),
      TRIP.custom,
      USER.viewer,
      { role: "editor" },
    );

    expect(updated.role).toBe("editor");
    const row = await requiredClient().tripParticipant.findFirst({
      where: { tripId: TRIP.custom, userId: USER.viewer },
    });
    expect(row?.role).toBe("editor");
  });

  it("PATCH accepts an invitation-status change as well as a role", async () => {
    const updated = await service.updateParticipant(
      actorFor(USER.owner),
      membershipFor(USER.owner),
      TRIP.custom,
      USER.viewer,
      { status: "invited" },
    );

    expect(updated.status).toBe("invited");
    const row = await requiredClient().tripParticipant.findFirst({
      where: { tripId: TRIP.custom, userId: USER.viewer },
    });
    expect(row?.status).toBe("invited");
  });

  it("PATCH is forbidden to a non-owner (viewer and participant editor both get 403)", async () => {
    await expect(
      service.updateParticipant(
        actorFor(USER.viewer),
        membershipFor(USER.viewer, WORKSPACE.home, "viewer"),
        TRIP.custom,
        USER.editor,
        { role: "viewer" },
      ),
    ).rejects.toMatchObject({ status: 403, response: { code: "WORKSPACE_ROLE_FORBIDDEN" } });

    await expect(
      service.updateParticipant(
        actorFor(USER.editor),
        membershipFor(USER.editor, WORKSPACE.home, "editor"),
        TRIP.custom,
        USER.viewer,
        { role: "viewer" },
      ),
    ).rejects.toMatchObject({ status: 403, response: { code: "WORKSPACE_ROLE_FORBIDDEN" } });
  });

  it("PATCH returns 404 when the user is not a participant", async () => {
    await expect(
      service.updateParticipant(
        actorFor(USER.owner),
        membershipFor(USER.owner),
        TRIP.custom,
        USER.grantee,
        { role: "editor" },
      ),
    ).rejects.toMatchObject({ status: 404, response: { code: "PARTICIPANT_NOT_FOUND" } });
  });

  it("PATCH rejects an empty change set with 400 VALIDATION_ERROR", async () => {
    await expect(
      service.updateParticipant(
        actorFor(USER.owner),
        membershipFor(USER.owner),
        TRIP.custom,
        USER.viewer,
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // Read-path loaders: every trip loader must hand `assertTripVisible` the
  // same participant + grant context, otherwise a custom grant works on the
  // detail page but 404s on the sub-resources.
  // -------------------------------------------------------------------------

  it("serves the itinerary list to a Viewer holding a matching user grant", async () => {
    await service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
      workspaces: [],
      users: [USER.grantee],
    });

    const items = await itineraryService.list(
      actorFor(USER.grantee),
      membershipFor(USER.grantee, WORKSPACE.home, "viewer"),
      TRIP.custom,
    );

    expect(items.map((item) => item.title)).toEqual(["Grant-visible breakfast"]);
  });

  it("still 404s the itinerary list for an ungranted Workspace Viewer", async () => {
    await expect(
      itineraryService.list(
        actorFor(USER.ungranted),
        membershipFor(USER.ungranted, WORKSPACE.home, "viewer"),
        TRIP.custom,
      ),
    ).rejects.toMatchObject({ status: 404, response: { code: "TRIP_NOT_FOUND" } });
  });

  it("serves the stops list to a Viewer holding a matching user grant", async () => {
    await service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
      workspaces: [],
      users: [USER.grantee],
    });

    const stops = await stopsService.list(
      actorFor(USER.grantee),
      membershipFor(USER.grantee, WORKSPACE.home, "viewer"),
      TRIP.custom,
    );

    expect(stops.map((stop) => stop.city)).toEqual(["Shanghai"]);
  });

  it("still 404s the stops list for an ungranted Workspace Viewer", async () => {
    await expect(
      stopsService.list(
        actorFor(USER.ungranted),
        membershipFor(USER.ungranted, WORKSPACE.home, "viewer"),
        TRIP.custom,
      ),
    ).rejects.toMatchObject({ status: 404, response: { code: "TRIP_NOT_FOUND" } });
  });

  it("select-based trip loaders return the participants and grants the rule reads", async () => {
    await service.setAccessGrants(actorFor(USER.owner), membershipFor(USER.owner), TRIP.custom, {
      workspaces: [],
      users: [USER.grantee],
    });

    const [commentTrip, exportTrip] = await Promise.all([
      commentsRepository.findTrip(WORKSPACE.home, TRIP.custom),
      exportsRepository.findTrip(TRIP.custom),
    ]);

    expect(commentTrip?.accessGrants).toEqual([
      { workspaceId: null, userId: USER.grantee },
    ]);
    expect(commentTrip?.participants).toEqual(
      expect.arrayContaining([{ userId: USER.viewer, status: "joined" }]),
    );
    expect(exportTrip?.accessGrants).toEqual([
      { workspaceId: null, userId: USER.grantee },
    ]);
    expect(exportTrip?.participants).toEqual(
      expect.arrayContaining([{ userId: USER.viewer, status: "joined" }]),
    );

    const membership = membershipFor(USER.grantee, WORKSPACE.home, "viewer");
    expect(() => assertTripVisible(membership, commentTrip!)).not.toThrow();
    expect(() => assertTripVisible(membership, exportTrip!)).not.toThrow();
  });

  // Keep the named exception imports honest: the assertions above use their
  // shape, but TypeScript should also pin that the class hierarchy is the one
  // the Nest filter maps to 403/404.
  it("uses the Nest exception classes that map to 403 and 404", async () => {
    const forbidden = service
      .setAccessGrants(
        actorFor(USER.viewer),
        membershipFor(USER.viewer, WORKSPACE.home, "viewer"),
        TRIP.custom,
        { workspaces: [], users: [] },
      )
      .catch((error: unknown) => error);
    const notFound = service
      .listAccessGrants(
        actorFor(USER.outsider),
        membershipFor(USER.outsider, WORKSPACE.other, "owner"),
        TRIP.custom,
      )
      .catch((error: unknown) => error);

    expect(await forbidden).toBeInstanceOf(ForbiddenException);
    expect(await notFound).toBeInstanceOf(NotFoundException);
  });
});
