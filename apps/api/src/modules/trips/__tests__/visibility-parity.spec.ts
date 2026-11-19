/**
 * Parity test for the single trip-access rule.
 *
 * `resolveTripAccess` answers "may this actor read this trip?" one row at a
 * time; `tripVisibilityWhere` expresses the same rule as a Prisma `where` for
 * list surfaces. Both are hand-written, so they can drift — and a drift means
 * either a list that shows a trip the detail page 404s, or a detail page that
 * shows a trip the list hides. This spec pins them against each other.
 *
 * It builds a disposable PostgreSQL schema (`vis_parity_<timestamp>`) from the
 * real migrations with `prisma migrate deploy`, writes the matrix through the
 * real `Trip` / `TripParticipant` / `TripAccessGrant` tables, and then:
 *
 *   - evaluates `resolveTripAccess` for every (actor, trip) pair;
 *   - runs `prisma.trip.findMany({ where: tripVisibilityWhere(actor) })`;
 *   - asserts the two result sets are identical and prints the diff on failure.
 *
 * The matrix crosses the four visibility tiers with the nine actor shapes
 * (plus a peer in the granted workspace), for 40 pairs — above the 30-pair
 * floor. Separate cases pin the semantics that are easy to get wrong: declined
 * participants, grant scope (`custom` only), workspace-wide grants, the
 * super_admin override, and `public_link`.
 *
 * The spec is self-cleaning: it owns a random schema and drops it in
 * `afterAll`. Without `ROAMLOG_TEST_DATABASE_URL` it skips with a note, so the
 * regular unit run stays database-free.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPrismaClient } from "@roamlog/db";
import type { Prisma } from "@roamlog/db";
import type { User } from "@roamlog/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { ActivitiesService } from "../../activities/activities.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import {
  explainTripAccess,
  resolveTripAccess,
  tripVisibilityWhere,
  type TripAccessActor,
  type TripAccessInput,
} from "../trip-access.js";
import { TripsRepository } from "../trips.repository.js";
import { TripsService } from "../trips.service.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const databaseUrl = testDatabaseUrl ?? "";

const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED visibility parity test: ROAMLOG_TEST_DATABASE_URL is not set. " +
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
const schemaName = `vis_parity_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;

const VISIBILITIES = ["workspace", "private", "public_link", "custom"] as const;
type TripVisibility = (typeof VISIBILITIES)[number];

function fixtureId(ordinal: number): string {
  return `0197c0de-0000-7000-8000-${String(ordinal).padStart(12, "0")}`;
}

const WORKSPACE = {
  home: fixtureId(1),
  other: fixtureId(2),
  granted: fixtureId(3),
  unrelated: fixtureId(4),
} as const;

const TRIP_ID: Record<TripVisibility, string> = {
  workspace: fixtureId(101),
  private: fixtureId(102),
  public_link: fixtureId(103),
  custom: fixtureId(104),
};

interface ActorSeed {
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceRole: "owner" | "admin" | "editor" | "viewer";
  platformRole?: "user" | "super_admin";
}

const ACTOR_SEEDS = {
  // The nine shapes the matrix must cover.
  creator: {
    userId: fixtureId(201),
    email: "creator@vis-parity.test",
    name: "Creator",
    workspaceId: WORKSPACE.home,
    workspaceRole: "owner",
  },
  workspace_member: {
    userId: fixtureId(202),
    email: "workspace-admin@vis-parity.test",
    name: "Workspace Admin",
    workspaceId: WORKSPACE.home,
    workspaceRole: "admin",
  },
  participant_invited: {
    userId: fixtureId(203),
    email: "participant-invited@vis-parity.test",
    name: "Invited Participant",
    workspaceId: WORKSPACE.other,
    workspaceRole: "editor",
  },
  participant_joined: {
    userId: fixtureId(204),
    email: "participant-joined@vis-parity.test",
    name: "Joined Participant",
    workspaceId: WORKSPACE.other,
    workspaceRole: "viewer",
  },
  participant_declined: {
    userId: fixtureId(205),
    email: "participant-declined@vis-parity.test",
    name: "Declined Participant",
    workspaceId: WORKSPACE.other,
    workspaceRole: "viewer",
  },
  grant_user: {
    userId: fixtureId(206),
    email: "user-grant@vis-parity.test",
    name: "User Grantee",
    workspaceId: WORKSPACE.other,
    workspaceRole: "viewer",
  },
  grant_workspace: {
    userId: fixtureId(207),
    email: "workspace-grant-owner@vis-parity.test",
    name: "Granted Workspace Owner",
    workspaceId: WORKSPACE.granted,
    workspaceRole: "owner",
  },
  grant_workspace_peer: {
    userId: fixtureId(208),
    email: "workspace-grant-peer@vis-parity.test",
    name: "Granted Workspace Peer",
    workspaceId: WORKSPACE.granted,
    workspaceRole: "viewer",
  },
  outsider: {
    userId: fixtureId(209),
    email: "outsider@vis-parity.test",
    name: "Outsider",
    workspaceId: WORKSPACE.unrelated,
    workspaceRole: "owner",
  },
  super_admin: {
    userId: fixtureId(210),
    email: "super-admin@vis-parity.test",
    name: "Super Admin",
    workspaceId: WORKSPACE.unrelated,
    workspaceRole: "viewer",
    platformRole: "super_admin",
  },
  // Not part of the cross-product: both live in the trip's workspace, so they
  // prove the list endpoints no longer hide a participant/private or a
  // grant/custom trip from the people the function already lets in.
  home_participant: {
    userId: fixtureId(211),
    email: "home-participant@vis-parity.test",
    name: "Home Participant",
    workspaceId: WORKSPACE.home,
    workspaceRole: "viewer",
  },
  home_custom_grantee: {
    userId: fixtureId(212),
    email: "home-custom-grantee@vis-parity.test",
    name: "Home Custom Grantee",
    workspaceId: WORKSPACE.home,
    workspaceRole: "viewer",
  },
} as const satisfies Record<string, ActorSeed>;

type ActorKey = keyof typeof ACTOR_SEEDS;

/**
 * The 4 × 10 cross-product the task requires. The remaining seed actors are
 * fixtures for the list-endpoint assertions, not extra matrix shapes.
 */
const MATRIX_ACTOR_KEYS = [
  "creator",
  "workspace_member",
  "participant_invited",
  "participant_joined",
  "participant_declined",
  "grant_user",
  "grant_workspace",
  "grant_workspace_peer",
  "outsider",
  "super_admin",
] as const satisfies readonly ActorKey[];

const LIST_ACTOR_KEYS = [
  "creator",
  "workspace_member",
  "home_participant",
  "home_custom_grantee",
] as const satisfies readonly ActorKey[];

interface ActorState {
  key: ActorKey;
  userId: string;
  workspaceId: string;
  workspaceRole: ActorSeed["workspaceRole"];
  platformRole: string;
}

interface LoadedTrip {
  id: string;
  workspaceId: string;
  createdById: string;
  visibility: TripVisibility;
  participants: Array<{ userId: string; status: string }>;
  accessGrants: Array<{ workspaceId: string | null; userId: string | null }>;
}

interface ParticipantSeed {
  workspaceId: string;
  tripId: string;
  userId: string;
  status: "invited" | "joined" | "declined";
}

interface GrantSeed {
  tripId: string;
  workspaceId: string | null;
  userId: string | null;
  grantedById: string;
}

let adminClient: ReturnType<typeof createPrismaClient> | undefined;
let prisma: ReturnType<typeof createPrismaClient> | undefined;
let actors: ActorState[] = [];
let trips: LoadedTrip[] = [];

function requiredClient(): ReturnType<typeof createPrismaClient> {
  if (!prisma) {
    throw new Error("The scoped Prisma client is not connected.");
  }
  return prisma;
}

function findActor(key: ActorKey): ActorState {
  const actor = actors.find((candidate) => candidate.key === key);
  if (!actor) {
    throw new Error(`Fixture actor is missing: ${key}`);
  }
  return actor;
}

function findTrip(visibility: TripVisibility): LoadedTrip {
  const trip = trips.find((candidate) => candidate.visibility === visibility);
  if (!trip) {
    throw new Error(`Fixture trip is missing: ${visibility}`);
  }
  return trip;
}

function accessActor(actor: ActorState): TripAccessActor {
  return {
    userId: actor.userId,
    workspaceId: actor.workspaceId,
    platformRole: actor.platformRole,
  };
}

function accessInput(actor: ActorState, trip: LoadedTrip): TripAccessInput {
  return {
    actor: accessActor(actor),
    trip: {
      id: trip.id,
      workspaceId: trip.workspaceId,
      createdById: trip.createdById,
      visibility: trip.visibility,
    },
    participation:
      trip.participants.find((participant) => participant.userId === actor.userId) ?? null,
    grants: trip.accessGrants,
  };
}

function labelOfTripId(tripId: string): string {
  return trips.find((trip) => trip.id === tripId)?.visibility ?? tripId;
}

function labelsOf(tripIds: Iterable<string>): string[] {
  return [...tripIds].map(labelOfTripId).sort();
}

async function sqlVisibleTripIds(actor: ActorState): Promise<Set<string>> {
  const where = tripVisibilityWhere(accessActor(actor)) as unknown as Prisma.TripWhereInput;
  const rows = await requiredClient().trip.findMany({ where, select: { id: true } });
  return new Set(rows.map((row) => row.id));
}

async function seedFixtures(client: ReturnType<typeof createPrismaClient>): Promise<void> {
  const actorKeys = Object.keys(ACTOR_SEEDS) as ActorKey[];

  await client.user.createMany({
    data: actorKeys.map((key) => {
      const seed: ActorSeed = ACTOR_SEEDS[key];
      return {
        id: seed.userId,
        email: seed.email,
        name: seed.name,
        platformRole: seed.platformRole ?? "user",
      };
    }),
  });

  await client.workspace.createMany({
    data: [
      {
        id: WORKSPACE.home,
        name: "Visibility Home",
        slug: "vis-parity-home",
        ownerId: ACTOR_SEEDS.creator.userId,
      },
      {
        id: WORKSPACE.other,
        name: "Visibility Other",
        slug: "vis-parity-other",
        ownerId: ACTOR_SEEDS.participant_invited.userId,
      },
      {
        id: WORKSPACE.granted,
        name: "Visibility Granted",
        slug: "vis-parity-granted",
        ownerId: ACTOR_SEEDS.grant_workspace.userId,
      },
      {
        id: WORKSPACE.unrelated,
        name: "Visibility Unrelated",
        slug: "vis-parity-unrelated",
        ownerId: ACTOR_SEEDS.outsider.userId,
      },
    ],
  });

  await client.workspaceMember.createMany({
    data: actorKeys.map((key) => {
      const seed = ACTOR_SEEDS[key];
      return {
        workspaceId: seed.workspaceId,
        userId: seed.userId,
        role: seed.workspaceRole,
      };
    }),
  });

  await client.trip.createMany({
    data: VISIBILITIES.map((visibility) => ({
      id: TRIP_ID[visibility],
      workspaceId: WORKSPACE.home,
      title: `Visibility ${visibility}`,
      startDate: new Date("2026-03-01T00:00:00.000Z"),
      endDate: new Date("2026-03-05T00:00:00.000Z"),
      origin: "Shanghai",
      visibility,
      createdById: ACTOR_SEEDS.creator.userId,
      updatedById: ACTOR_SEEDS.creator.userId,
    })),
  });

  const participantSeeds: ParticipantSeed[] = [];
  for (const visibility of VISIBILITIES) {
    participantSeeds.push(
      {
        workspaceId: WORKSPACE.home,
        tripId: TRIP_ID[visibility],
        userId: ACTOR_SEEDS.participant_invited.userId,
        status: "invited",
      },
      {
        workspaceId: WORKSPACE.home,
        tripId: TRIP_ID[visibility],
        userId: ACTOR_SEEDS.participant_joined.userId,
        status: "joined",
      },
      {
        workspaceId: WORKSPACE.home,
        tripId: TRIP_ID[visibility],
        userId: ACTOR_SEEDS.participant_declined.userId,
        status: "declined",
      },
    );
  }
  participantSeeds.push({
    workspaceId: WORKSPACE.home,
    tripId: TRIP_ID.private,
    userId: ACTOR_SEEDS.home_participant.userId,
    status: "joined",
  });
  await client.tripParticipant.createMany({ data: participantSeeds });

  const grantSeeds: GrantSeed[] = [];
  for (const visibility of VISIBILITIES) {
    // The user grant deliberately exists on *every* tier: only `custom` may
    // consult it, so the other tiers prove the `visibility: "custom"` guard.
    grantSeeds.push(
      {
        tripId: TRIP_ID[visibility],
        workspaceId: null,
        userId: ACTOR_SEEDS.grant_user.userId,
        grantedById: ACTOR_SEEDS.creator.userId,
      },
      {
        tripId: TRIP_ID[visibility],
        workspaceId: WORKSPACE.granted,
        userId: null,
        grantedById: ACTOR_SEEDS.creator.userId,
      },
    );
  }
  grantSeeds.push({
    tripId: TRIP_ID.custom,
    workspaceId: null,
    userId: ACTOR_SEEDS.home_custom_grantee.userId,
    grantedById: ACTOR_SEEDS.creator.userId,
  });
  await client.tripAccessGrant.createMany({ data: grantSeeds });

  // Read the fixtures back so the function side is fed by the real tables, not
  // by the seed literals above.
  const membershipRows = await client.workspaceMember.findMany({
    select: {
      userId: true,
      workspaceId: true,
      role: true,
      user: { select: { platformRole: true } },
    },
  });
  const membershipByUserId = new Map(membershipRows.map((row) => [row.userId, row]));

  actors = actorKeys.map((key) => {
    const seed = ACTOR_SEEDS[key];
    const row = membershipByUserId.get(seed.userId);
    if (!row) {
      throw new Error(`Fixture membership is missing for ${key}`);
    }
    return {
      key,
      userId: row.userId,
      workspaceId: row.workspaceId,
      workspaceRole: row.role,
      platformRole: row.user.platformRole,
    };
  });

  const tripRows = await client.trip.findMany({
    where: { workspaceId: WORKSPACE.home },
    include: {
      participants: { select: { userId: true, status: true } },
      accessGrants: { select: { workspaceId: true, userId: true } },
    },
  });
  trips = tripRows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    createdById: row.createdById,
    visibility: row.visibility,
    participants: row.participants.map((participant) => ({
      userId: participant.userId,
      status: participant.status,
    })),
    accessGrants: row.accessGrants.map((grant) => ({
      workspaceId: grant.workspaceId,
      userId: grant.userId,
    })),
  }));

  if (trips.length !== VISIBILITIES.length) {
    throw new Error(`Expected ${VISIBILITIES.length} fixture trips, found ${trips.length}`);
  }
}

function authenticatedActor(actor: ActorState): AuthenticatedActor {
  return {
    user: {
      id: actor.userId,
      platformRole: actor.platformRole,
    } as unknown as User,
    ip: null,
    userAgent: null,
  };
}

function membershipFor(actor: ActorState): WorkspaceMembershipAccess {
  const now = new Date();
  return {
    id: `membership-${actor.userId}`,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    role: actor.workspaceRole,
    status: "active",
    joinedAt: now,
    invitedById: null,
    createdAt: now,
    updatedAt: now,
    workspaceName: "Visibility fixture workspace",
  };
}

integration("trip visibility parity on real PostgreSQL", () => {
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

  it("crosses every visibility tier with every actor shape (>= 30 pairs)", () => {
    const matrixActors = MATRIX_ACTOR_KEYS.map((key) => findActor(key));

    expect(trips.map((trip) => trip.visibility).sort()).toEqual([...VISIBILITIES].sort());
    expect(matrixActors.map((actor) => actor.key).sort()).toEqual([...MATRIX_ACTOR_KEYS].sort());
    expect(matrixActors.length * trips.length).toBeGreaterThanOrEqual(30);
  });

  it("agrees with the SQL filter on every (actor, trip) pair", async () => {
    const mismatches: string[] = [];
    let pairCount = 0;

    for (const key of MATRIX_ACTOR_KEYS) {
      const actor = findActor(key);
      const visible = await sqlVisibleTripIds(actor);
      for (const trip of trips) {
        pairCount += 1;
        const fromFunction = resolveTripAccess(accessInput(actor, trip));
        const fromSql = visible.has(trip.id);
        if (fromFunction !== fromSql) {
          mismatches.push(
            `${key} x ${trip.visibility}: resolveTripAccess=${fromFunction}, SQL=${fromSql}`,
          );
        }
      }
    }

    expect(pairCount).toBeGreaterThanOrEqual(30);
    expect(
      mismatches,
      mismatches.length > 0 ? `Function / SQL difference:\n${mismatches.join("\n")}` : "",
    ).toEqual([]);
  });

  it("returns exactly the same visible set for every actor", async () => {
    for (const key of MATRIX_ACTOR_KEYS) {
      const actor = findActor(key);
      const visible = await sqlVisibleTripIds(actor);
      const allowed = new Set(
        trips
          .filter((trip) => resolveTripAccess(accessInput(actor, trip)))
          .map((trip) => trip.id),
      );

      const sqlLabels = labelsOf(visible);
      const functionLabels = labelsOf(allowed);
      expect(
        sqlLabels,
        `${key}: SQL returns [${sqlLabels.join(", ")}], function allows ` +
          `[${functionLabels.join(", ")}]`,
      ).toEqual(functionLabels);
    }
  });

  it("keeps a declined participant out of every visibility tier", async () => {
    const actor = findActor("participant_declined");
    const visible = await sqlVisibleTripIds(actor);

    for (const trip of trips) {
      const explanation = explainTripAccess(accessInput(actor, trip));
      expect(
        explanation.allowed,
        `a declined participant must not read the ${trip.visibility} trip`,
      ).toBe(false);
      expect(explanation.reason).toBe(
        trip.visibility === "private" ? "visibility_private" : "no_grant",
      );
      expect(
        visible.has(trip.id),
        `the ${trip.visibility} trip leaked through the SQL filter for a declined participant`,
      ).toBe(false);
    }

    expect([...visible]).toEqual([]);
  });

  it("lets the userId grant read a custom trip and keeps the ungranted admin out", async () => {
    const customTrip = findTrip("custom");
    const granted = findActor("grant_user");

    expect(explainTripAccess(accessInput(granted, customTrip))).toEqual({
      allowed: true,
      reason: "grant_user",
    });
    expect(await sqlVisibleTripIds(granted)).toEqual(new Set([customTrip.id]));

    const workspaceAdmin = findActor("workspace_member");
    expect(explainTripAccess(accessInput(workspaceAdmin, customTrip))).toEqual({
      allowed: false,
      reason: "no_grant",
    });
    expect((await sqlVisibleTripIds(workspaceAdmin)).has(customTrip.id)).toBe(false);
  });

  it("does not let a grant widen any non-custom trip", async () => {
    const granted = findActor("grant_user");
    const privateTrip = findTrip("private");
    const visible = await sqlVisibleTripIds(granted);

    const explanation = explainTripAccess(accessInput(granted, privateTrip));
    expect(explanation.allowed).toBe(false);
    expect(explanation.reason).toBe("visibility_private");

    for (const trip of trips) {
      if (trip.visibility === "custom") {
        continue;
      }
      expect(resolveTripAccess(accessInput(granted, trip)), trip.visibility).toBe(false);
      expect(visible.has(trip.id), trip.visibility).toBe(false);
    }
  });

  it("spreads a workspace grant across every member of that workspace", async () => {
    const customTrip = findTrip("custom");

    for (const key of ["grant_workspace", "grant_workspace_peer"] as const) {
      const actor = findActor(key);
      for (const trip of trips) {
        const shouldBeVisible = trip.visibility === "custom";
        const explanation = explainTripAccess(accessInput(actor, trip));
        expect(explanation.allowed, `${key} x ${trip.visibility}`).toBe(shouldBeVisible);
        if (shouldBeVisible) {
          expect(explanation.reason).toBe("grant_workspace");
        }
      }
      expect(await sqlVisibleTripIds(actor)).toEqual(new Set([customTrip.id]));
    }
  });

  it("gives super_admin every trip through both halves", async () => {
    const actor = findActor("super_admin");

    for (const trip of trips) {
      expect(explainTripAccess(accessInput(actor, trip))).toEqual({
        allowed: true,
        reason: "platform_override",
      });
    }

    expect(await sqlVisibleTripIds(actor)).toEqual(new Set(trips.map((trip) => trip.id)));
  });

  it("keeps public_link closed to signed-in outsiders without a share token", async () => {
    const publicTrip = findTrip("public_link");
    const outsider = findActor("outsider");

    expect(explainTripAccess(accessInput(outsider, publicTrip))).toEqual({
      allowed: false,
      reason: "no_grant",
    });
    expect((await sqlVisibleTripIds(outsider)).has(publicTrip.id)).toBe(false);

    // Deliberate implementation semantics (0012 leaves sharing untouched, see
    // design §7): the owning workspace keeps reading public_link trips; the
    // share token is the only route for people outside that workspace.
    const workspaceMember = findActor("workspace_member");
    expect(explainTripAccess(accessInput(workspaceMember, publicTrip))).toEqual({
      allowed: true,
      reason: "workspace_member",
    });
    expect((await sqlVisibleTripIds(workspaceMember)).has(publicTrip.id)).toBe(true);
  });

  it("applies the same rule to the list endpoint as to a single trip", async () => {
    const repository = new TripsRepository({
      client: requiredClient(),
    } as unknown as PrismaService);
    const service = new TripsService(repository, new PermissionService(), {} as ActivitiesService);

    const listedByActor = new Map<ActorKey, Set<string>>();
    for (const key of LIST_ACTOR_KEYS) {
      const actor = findActor(key);
      const page = await service.list(authenticatedActor(actor), membershipFor(actor), {
        limit: 50,
      });
      const listed = new Set(page.items.map((trip) => trip.id));
      listedByActor.set(actor.key, listed);

      const allowed = new Set(
        trips
          .filter((trip) => resolveTripAccess(accessInput(actor, trip)))
          .map((trip) => trip.id),
      );
      const listLabels = labelsOf(listed);
      const functionLabels = labelsOf(allowed);
      expect(
        listLabels,
        `${key}: list returns [${listLabels.join(", ")}], function allows ` +
          `[${functionLabels.join(", ")}]`,
      ).toEqual(functionLabels);
    }

    const privateTrip = findTrip("private");
    const customTrip = findTrip("custom");

    // The creator sees their own private trip; a non-creator admin of the same
    // workspace must not — this is the owner/admin bypass the unified rule drops.
    expect(listedByActor.get("creator")?.has(privateTrip.id)).toBe(true);
    expect(listedByActor.get("workspace_member")?.has(privateTrip.id)).toBe(false);
    // The old list filter also hid these from the very people single-get admits.
    expect(listedByActor.get("home_participant")?.has(privateTrip.id)).toBe(true);
    expect(listedByActor.get("home_custom_grantee")?.has(customTrip.id)).toBe(true);
    expect(listedByActor.get("workspace_member")?.has(customTrip.id)).toBe(false);
  });
});