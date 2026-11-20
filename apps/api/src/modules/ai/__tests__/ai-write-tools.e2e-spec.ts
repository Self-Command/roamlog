/**
 * AI write tools against a real PostgreSQL database.
 *
 * These tests prove the new AI write surface is not a mock: `stops.reorder`
 * actually changes `Stop.order`, `entries.create` inserts a `JournalEntry`, and
 * `expenses.add` inserts an `Expense` plus its participant shares. The suite
 * creates a disposable schema and applies the real Prisma migrations, matching
 * `conversation.spec.ts` / `trip-participant-role.spec.ts`.
 *
 * Without ROAMLOG_TEST_DATABASE_URL the suite skips.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPrismaClient } from "@roamlog/db";
import type { User } from "@roamlog/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import { SanitizeService } from "../../../common/services/sanitize.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { ActivitiesService } from "../../activities/activities.service.js";
import { EntriesRepository } from "../../entries/entries.repository.js";
import { EntriesService } from "../../entries/entries.service.js";
import { ExpensesRepository } from "../../expenses/expenses.repository.js";
import { ExpensesService } from "../../expenses/expenses.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { StopsRepository } from "../../trips/stops.repository.js";
import { StopsService } from "../../trips/stops.service.js";
import { TripsRepository } from "../../trips/trips.repository.js";
import { AiToolbox, type AiToolContext } from "../ai-tools.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const databaseUrl = testDatabaseUrl ?? "";
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED AI write-tools e2e test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Point it at a disposable PostgreSQL database; this spec creates and drops its own schema.\n",
  );
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../");
const databaseRoot = resolve(repoRoot, "packages/db");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const prismaSchema = resolve(databaseRoot, "prisma/schema.prisma");
const schemaName = `ai_write_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;

function fixtureId(ordinal: number): string {
  return `0197e00d-0000-7000-8000-${String(ordinal).padStart(12, "0")}`;
}

const USER = {
  owner: fixtureId(201),
  editor: fixtureId(202),
} as const;

const WORKSPACE_ID = fixtureId(1);
const TRIP_ID = fixtureId(101);

const STOP = {
  first: fixtureId(301),
  second: fixtureId(302),
  third: fixtureId(303),
} as const;

const TRIP_START = new Date("2026-12-01T00:00:00.000Z");
const TRIP_END = new Date("2026-12-07T00:00:00.000Z");
const TRIP_DAY = new Date("2026-12-01T00:00:00.000Z");

let adminClient: ReturnType<typeof createPrismaClient> | undefined;
let prisma: ReturnType<typeof createPrismaClient> | undefined;
let toolbox: AiToolbox;

function requiredClient(): ReturnType<typeof createPrismaClient> {
  if (!prisma) {
    throw new Error("The scoped Prisma client is not connected.");
  }
  return prisma;
}

function userFor(userId: string): User {
  return {
    id: userId,
    email: `${userId.slice(-4)}@ai-write.test`,
    emailVerified: true,
    name: "AI write fixture user",
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

function ownerMembership(): WorkspaceMembershipAccess {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "membership-ai-write-owner",
    workspaceId: WORKSPACE_ID,
    userId: USER.owner,
    role: "owner",
    status: "active",
    joinedAt: now,
    invitedById: null,
    createdAt: now,
    updatedAt: now,
    workspaceName: "AI write fixture workspace",
  };
}

function context(): AiToolContext {
  return {
    actor: actorFor(USER.owner),
    membership: ownerMembership(),
    runId: "f".repeat(32),
    candidates: new Map(),
    createdTripIds: [],
    today: "2026-12-01",
  };
}

async function seedFixtures(client: ReturnType<typeof createPrismaClient>): Promise<void> {
  await client.user.createMany({
    data: [
      { id: USER.owner, email: "ai-write-owner@test.local", name: "AI Write Owner" },
      { id: USER.editor, email: "ai-write-editor@test.local", name: "AI Write Editor" },
    ],
  });
  // The owner-consistency trigger checks the member row on commit, so the
  // workspace and its owner membership must be written in one transaction.
  await client.$transaction(async (tx) => {
    await tx.workspace.create({
      data: {
        id: WORKSPACE_ID,
        name: "AI Write Workspace",
        slug: `ai-write-${randomBytes(3).toString("hex")}`,
        ownerId: USER.owner,
      },
    });
    await tx.workspaceMember.createMany({
      data: [
        { workspaceId: WORKSPACE_ID, userId: USER.owner, role: "owner" },
        { workspaceId: WORKSPACE_ID, userId: USER.editor, role: "editor" },
      ],
    });
  });
  await client.trip.create({
    data: {
      id: TRIP_ID,
      workspaceId: WORKSPACE_ID,
      title: "Kyoto in December",
      startDate: TRIP_START,
      endDate: TRIP_END,
      origin: "Shanghai",
      visibility: "workspace",
      createdById: USER.owner,
      updatedById: USER.owner,
    },
  });
}

async function seedStops(): Promise<void> {
  await requiredClient().stop.createMany({
    data: [
      {
        id: STOP.first,
        tripId: TRIP_ID,
        workspaceId: WORKSPACE_ID,
        city: "Kyoto",
        country: "Japan",
        countryCode: "JP",
        startDate: TRIP_DAY,
        endDate: TRIP_DAY,
        notes: "",
        order: 0,
        createdById: USER.owner,
        updatedById: USER.owner,
      },
      {
        id: STOP.second,
        tripId: TRIP_ID,
        workspaceId: WORKSPACE_ID,
        city: "Osaka",
        country: "Japan",
        countryCode: "JP",
        startDate: TRIP_DAY,
        endDate: TRIP_DAY,
        notes: "",
        order: 1,
        createdById: USER.owner,
        updatedById: USER.owner,
      },
      {
        id: STOP.third,
        tripId: TRIP_ID,
        workspaceId: WORKSPACE_ID,
        city: "Nara",
        country: "Japan",
        countryCode: "JP",
        startDate: TRIP_DAY,
        endDate: TRIP_DAY,
        notes: "",
        order: 2,
        createdById: USER.owner,
        updatedById: USER.owner,
      },
    ],
  });
}

integration("AI write tools on real PostgreSQL", () => {
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
    scoped.searchParams.set("options", `-c search_path=${schemaName}`);
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
    const activities = {
      record: async () => ({ id: "activity-record" }),
    } as unknown as ActivitiesService;
    const tripsRepository = new TripsRepository(prismaService);
    const stopsService = new StopsService(
      new StopsRepository(prismaService),
      new PermissionService(),
      activities,
    );
    const entriesService = new EntriesService(
      new EntriesRepository(prismaService),
      tripsRepository,
      new PermissionService(),
      activities,
      new SanitizeService(),
    );
    const expensesService = new ExpensesService(
      new ExpensesRepository(prismaService),
      tripsRepository,
      new PermissionService(),
      activities,
    );
    toolbox = new AiToolbox(
      {} as never,
      {} as never,
      stopsService,
      {} as never,
      {} as never,
      expensesService,
      entriesService,
    );
  }, 240_000);

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
    await client.expense.deleteMany({ where: { tripId: TRIP_ID } });
    await client.journalEntry.deleteMany({ where: { tripId: TRIP_ID } });
    await client.stop.deleteMany({ where: { tripId: TRIP_ID } });
    await seedStops();
  });

  it("stops.reorder really changes the rows' order", async () => {
    const before = await requiredClient().stop.findMany({
      where: { tripId: TRIP_ID, deletedAt: null },
      orderBy: { order: "asc" },
      select: { id: true, order: true },
    });
    expect(before.map((stop) => stop.id)).toEqual([STOP.first, STOP.second, STOP.third]);

    const outcome = await toolbox.execute(
      {
        tool: "stops.reorder",
        args: {
          tripId: TRIP_ID,
          items: [
            { id: STOP.third, order: 0 },
            { id: STOP.first, order: 1 },
            { id: STOP.second, order: 2 },
          ],
        },
      },
      context(),
    );
    expect(outcome.ok).toBe(true);

    const after = await requiredClient().stop.findMany({
      where: { tripId: TRIP_ID, deletedAt: null },
      orderBy: { order: "asc" },
      select: { id: true, order: true },
    });
    expect(after.map((stop) => stop.id)).toEqual([STOP.third, STOP.first, STOP.second]);
    expect(after.map((stop) => stop.order)).toEqual([0, 1, 2]);
  });

  it("entries.create inserts a JournalEntry row", async () => {
    const before = await requiredClient().journalEntry.count({ where: { tripId: TRIP_ID } });

    const outcome = await toolbox.execute(
      {
        tool: "entries.create",
        args: {
          tripId: TRIP_ID,
          title: "First evening",
          date: "2026-12-01",
          location: "Kyoto",
          content: "We walked along the river and found a tiny noodle shop.",
        },
      },
      context(),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.entityId).toBeTruthy();

    const after = await requiredClient().journalEntry.count({ where: { tripId: TRIP_ID } });
    expect(after).toBe(before + 1);

    const row = await requiredClient().journalEntry.findUniqueOrThrow({
      where: { id: outcome.entityId as string },
    });
    expect(row.tripId).toBe(TRIP_ID);
    expect(row.title).toBe("First evening");
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(row.contentHtml).toContain("tiny noodle shop");
    expect(row.contentJson).toMatchObject({ type: "doc" });
  });

  it("expenses.add inserts an Expense row with participant shares", async () => {
    const before = await requiredClient().expense.count({ where: { tripId: TRIP_ID } });

    const outcome = await toolbox.execute(
      {
        tool: "expenses.add",
        args: {
          tripId: TRIP_ID,
          date: "2026-12-01",
          category: "food",
          note: "Noodles",
          amountMinor: 1200,
          currency: "CNY",
          paidByMemberId: USER.owner,
          splitMode: "equal",
          participants: [{ memberId: USER.owner }, { memberId: USER.editor }],
        },
      },
      context(),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.entityId).toBeTruthy();

    const after = await requiredClient().expense.count({ where: { tripId: TRIP_ID } });
    expect(after).toBe(before + 1);

    const row = await requiredClient().expense.findUniqueOrThrow({
      where: { id: outcome.entityId as string },
      include: { participants: true },
    });
    expect(row.tripId).toBe(TRIP_ID);
    expect(row.amountMinor).toBe(1200);
    expect(row.currency).toBe("CNY");
    expect(row.participants).toHaveLength(2);
    expect(row.participants.map((participant) => participant.shareAmountMinor).sort()).toEqual([
      600, 600,
    ]);
  });
});
