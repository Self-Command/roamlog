/**
 * Visibility audit: every read path that returns trip-scoped data must answer
 * "may this actor read this trip?" through the single rule in `trip-access.ts`
 * (`resolveTripAccess` / `tripVisibilityWhere`).
 *
 * Background: `.audit/visibility-audit.md` proved four readers still answered
 * that question with their own, drifting predicate:
 *
 *   1. `reports/report-targets.ts::isVisibleReportTarget`
 *   2. `share-links/share-links.service.ts::create` / `list` / `revoke`
 *   3. the export job in `apps/worker/src/jobs/export.ts`
 *   4. the reminder job in `apps/worker/src/jobs/reminders.ts`
 *
 * This spec is the regression gate for those four fixes. Every assertion below
 * is **behavioural against real PostgreSQL**: it seeds rows, calls the real
 * product code, and checks what the actor can actually obtain. There is no
 * source-string assertion and no hand-written `where` matcher — a bug in the
 * predicate shows up as a row that should have been invisible being returned,
 * not as a missing identifier in a file.
 *
 * Method:
 *   - a disposable schema is created through `prisma migrate deploy`, exactly
 *     like `visibility-parity.spec.ts`;
 *   - the API paths run against the real `PrismaClient`;
 *   - the worker jobs are loaded through a **runtime dynamic import** of their
 *     source file. A static import would drag `bullmq` into `@roamlog/api`'s
 *     program and change what `tsc -p apps/api` compiles; the dynamic import
 *     keeps the API type-check identical to production while still executing
 *     the real job code.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NotFoundException } from "@nestjs/common";
import { createPrismaClient } from "@roamlog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import { SanitizeService } from "../../../common/services/sanitize.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { isVisibleReportTarget } from "../../reports/report-targets.js";
import { ShareLinksRepository } from "../../share-links/share-links.repository.js";
import { ShareLinksService } from "../../share-links/share-links.service.js";

/** `apps/api/src/modules/trips/__tests__` -> repository root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../");
const databaseRoot = resolve(repoRoot, "packages/db");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const prismaSchema = resolve(databaseRoot, "prisma/schema.prisma");

const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const schemaName = `vis_audit_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;

/** Fixed clocks so the reminder window is deterministic. */
const NOW = new Date("2026-11-19T00:00:00.000Z");
const TARGET_DAY = "2026-11-20";

function fixtureId(ordinal: number): string {
  return `0197c0de-0000-7000-8000-${String(ordinal).padStart(12, "0")}`;
}

const WORKSPACE = fixtureId(1);
const CREATOR = fixtureId(2);
const EDITOR = fixtureId(3);
const PARTICIPANT = fixtureId(4);

const TRIP_PRIVATE = fixtureId(10);
const TRIP_CUSTOM = fixtureId(11);
const TRIP_WORKSPACE = fixtureId(12);

const ENTRY_PRIVATE = fixtureId(20);
const ENTRY_CUSTOM = fixtureId(21);
const COMMENT_PRIVATE = fixtureId(22);
const MEDIA_PRIVATE = fixtureId(23);
const MEDIA_WORKSPACE = fixtureId(24);

const EXPORT_EDITOR_WORKSPACE = fixtureId(30);
const EXPORT_EDITOR_ACCOUNT = fixtureId(31);
const EXPORT_PARTICIPANT = fixtureId(32);
const SHARE_LINK_SEED = fixtureId(40);

const EMAILS: Record<string, string> = {
  [CREATOR]: "creator@vis-audit.test",
  [EDITOR]: "editor@vis-audit.test",
  [PARTICIPANT]: "participant@vis-audit.test",
};

type Client = ReturnType<typeof createPrismaClient>;

let prisma: Client | undefined;

function db(): Client {
  if (!prisma) {
    throw new Error("The scoped Prisma client is not connected.");
  }
  return prisma;
}

function actorFor(userId: string, platformRole = "user"): AuthenticatedActor {
  return {
    user: { id: userId, platformRole } as unknown as AuthenticatedActor["user"],
    ip: null,
    userAgent: null,
  };
}

function membershipFor(userId: string, role: "owner" | "editor" | "viewer"): WorkspaceMembershipAccess {
  const now = new Date(0);
  return {
    id: `membership-${userId}`,
    workspaceId: WORKSPACE,
    userId,
    role,
    status: "active",
    joinedAt: now,
    invitedById: null,
    createdAt: now,
    updatedAt: now,
    workspaceName: "Visibility audit workspace",
  };
}

function shareLinksService(): ShareLinksService {
  const repository = new ShareLinksRepository({ client: db() } as unknown as PrismaService);
  const activities = { record: async () => ({ id: fixtureId(90) }) } as never;
  const config = { appUrl: "http://localhost:3000" } as never;
  return new ShareLinksService(repository, new PermissionService(), activities, new SanitizeService(), config);
}

interface PutObjectCall {
  key: string;
  body: Uint8Array;
  contentType: string;
}

interface JobContext {
  queue: string;
  jobId: string;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

type JobHandler = (
  data: Record<string, unknown>,
  context: JobContext,
  deps: unknown,
) => Promise<Record<string, unknown>>;

/** Loads a worker job through Vite's runtime transform, not the API program. */
async function loadWorkerJob(exportName: "handleExportJob" | "handleReminderJob"): Promise<JobHandler> {
  const moduleName = exportName === "handleExportJob" ? "export" : "reminders";
  const file = pathToFileURL(resolve(repoRoot, `apps/worker/src/jobs/${moduleName}.ts`)).href;
  const module = (await import(file)) as Record<string, JobHandler | undefined>;
  const handler = module[exportName];
  if (typeof handler !== "function") {
    throw new Error(`The worker module does not export ${exportName}.`);
  }
  return handler;
}

function jobContext(jobId: string, queue: string): JobContext {
  const noop = (): void => undefined;
  return { queue, jobId, logger: { debug: noop, info: noop, warn: noop, error: noop } };
}

function workerDeps(options: { put?: PutObjectCall[]; mail?: Array<{ to: string; subject: string }> }): unknown {
  return {
    db: db(),
    storage: {
      getObject: async () => {
        throw new Error("The audit tests never read objects back.");
      },
      putObject: async (key: string, body: Uint8Array, contentType: string) => {
        options.put?.push({ key, body, contentType });
      },
      deleteObject: async () => undefined,
    },
    images: {},
    email: {
      send: async (message: { to: string; subject: string }) => {
        options.mail?.push({ to: message.to, subject: message.subject });
        return { providerId: "vis-audit-provider" };
      },
      render: async () => "<p>rendered</p>",
    },
    now: () => NOW,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
}

function decodeExportedJson(calls: PutObjectCall[]): { trips?: Array<{ title?: string }> } {
  const last = calls.at(-1);
  if (!last) {
    throw new Error("The export job did not write an object.");
  }
  return JSON.parse(Buffer.from(last.body).toString("utf8")) as { trips?: Array<{ title?: string }> };
}

function titlesOf(data: { trips?: Array<{ title?: string }> }): string[] {
  return (data.trips ?? []).map((trip) => trip.title ?? "").sort();
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing fixture value: ${label}`);
  }
  return value;
}

async function seedFixtures(client: Client): Promise<void> {
  await client.user.createMany({
    data: [
      { id: CREATOR, email: required(EMAILS[CREATOR], "creator email"), name: "Creator" },
      { id: EDITOR, email: required(EMAILS[EDITOR], "editor email"), name: "Editor" },
      { id: PARTICIPANT, email: required(EMAILS[PARTICIPANT], "participant email"), name: "Participant" },
    ],
  });

  await client.workspace.create({
    data: { id: WORKSPACE, name: "Visibility Audit", slug: "vis-audit-home", ownerId: CREATOR },
  });

  await client.workspaceMember.createMany({
    data: [
      { workspaceId: WORKSPACE, userId: CREATOR, role: "owner" },
      { workspaceId: WORKSPACE, userId: EDITOR, role: "editor" },
      { workspaceId: WORKSPACE, userId: PARTICIPANT, role: "viewer" },
    ],
  });

  await client.trip.createMany({
    data: [
      {
        id: TRIP_PRIVATE,
        workspaceId: WORKSPACE,
        title: "Private island notebook",
        status: "upcoming",
        startDate: new Date(`${TARGET_DAY}T00:00:00.000Z`),
        endDate: new Date("2026-11-24T00:00:00.000Z"),
        origin: "Shanghai",
        destinations: ["Okinawa"],
        visibility: "private",
        createdById: CREATOR,
        updatedById: CREATOR,
      },
      {
        id: TRIP_CUSTOM,
        workspaceId: WORKSPACE,
        title: "Custom grant trip",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-03-05T00:00:00.000Z"),
        origin: "Shanghai",
        destinations: ["Kyoto"],
        visibility: "custom",
        createdById: CREATOR,
        updatedById: CREATOR,
      },
      {
        id: TRIP_WORKSPACE,
        workspaceId: WORKSPACE,
        title: "Workspace trip",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-05T00:00:00.000Z"),
        origin: "Shanghai",
        destinations: ["Seoul"],
        visibility: "workspace",
        createdById: CREATOR,
        updatedById: CREATOR,
      },
    ],
  });

  // The only participant row: the private trip's joined guest. Nobody joins the
  // custom trip, so "custom without a grant" stays unreachable for the editor.
  await client.tripParticipant.create({
    data: { workspaceId: WORKSPACE, tripId: TRIP_PRIVATE, userId: PARTICIPANT, status: "joined" },
  });

  await client.journalEntry.createMany({
    data: [
      {
        id: ENTRY_PRIVATE,
        tripId: TRIP_PRIVATE,
        workspaceId: WORKSPACE,
        title: "Arrival",
        date: new Date("2026-11-20T00:00:00.000Z"),
        location: "Naha",
        contentJson: { blocks: [] },
        contentHtml: "<p>Arrival</p>",
        excerpt: "Arrival",
        createdById: CREATOR,
        updatedById: CREATOR,
      },
      {
        id: ENTRY_CUSTOM,
        tripId: TRIP_CUSTOM,
        workspaceId: WORKSPACE,
        title: "Gion walk",
        date: new Date("2026-03-02T00:00:00.000Z"),
        location: "Kyoto",
        contentJson: { blocks: [] },
        contentHtml: "<p>Gion walk</p>",
        excerpt: "Gion walk",
        createdById: CREATOR,
        updatedById: CREATOR,
      },
    ],
  });

  await client.comment.create({
    data: {
      id: COMMENT_PRIVATE,
      workspaceId: WORKSPACE,
      tripId: TRIP_PRIVATE,
      targetType: "journal_entry",
      targetId: ENTRY_PRIVATE,
      authorId: CREATOR,
      body: "Book the ferry.",
    },
  });

  await client.media.createMany({
    data: [
      {
        id: MEDIA_PRIVATE,
        workspaceId: WORKSPACE,
        tripId: TRIP_PRIVATE,
        uploaderId: CREATOR,
        bucket: "vis-audit",
        key: "private/ferry.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        status: "ready",
      },
      {
        id: MEDIA_WORKSPACE,
        workspaceId: WORKSPACE,
        tripId: null,
        uploaderId: CREATOR,
        bucket: "vis-audit",
        key: "workspace/studio.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        status: "ready",
      },
    ],
  });

  await client.export.createMany({
    data: [
      { id: EXPORT_EDITOR_WORKSPACE, workspaceId: WORKSPACE, requestedById: EDITOR, scope: "workspace", format: "json" },
      { id: EXPORT_EDITOR_ACCOUNT, workspaceId: WORKSPACE, requestedById: EDITOR, scope: "account", format: "json" },
      { id: EXPORT_PARTICIPANT, workspaceId: WORKSPACE, requestedById: PARTICIPANT, scope: "workspace", format: "json" },
    ],
  });
}

describe.skipIf(!databaseUrl)("visibility audit on real PostgreSQL", () => {
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

    const admin = createPrismaClient({ connectionString: databaseUrl });
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    await admin.$disconnect();

    const scoped = new URL(databaseUrl);
    scoped.searchParams.set("schema", schemaName);
    const scopedUrl = scoped.toString();

    const migration = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", prismaSchema], {
      cwd: databaseRoot,
      env: { ...process.env, DATABASE_URL: scopedUrl },
      encoding: "utf8",
    });
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
    if (prisma) {
      await prisma.$disconnect();
      prisma = undefined;
    }
    if (databaseUrl && /^[a-z_][a-z0-9_]{0,62}$/u.test(schemaName)) {
      const admin = createPrismaClient({ connectionString: databaseUrl });
      try {
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        await admin.$disconnect();
      }
    }
  }, 60_000);

  describe("reports — isVisibleReportTarget", () => {
    it("hides another member's custom trip from the report target check", async () => {
      // `custom` is the creator plus the explicit grant list. The editor is a
      // plain workspace member, so neither branch matches.
      await expect(isVisibleReportTarget(db(), "trip", TRIP_CUSTOM, WORKSPACE, EDITOR)).resolves.toBe(false);
      // ...while the creator still reports their own trip.
      await expect(isVisibleReportTarget(db(), "trip", TRIP_CUSTOM, WORKSPACE, CREATOR)).resolves.toBe(true);
    });

    it("lets a joined participant report a private trip they belong to", async () => {
      // The old predicate hid `private` from everyone but the creator, so a
      // participant could not report abuse on a trip they were reading.
      await expect(isVisibleReportTarget(db(), "trip", TRIP_PRIVATE, WORKSPACE, PARTICIPANT)).resolves.toBe(true);
      await expect(isVisibleReportTarget(db(), "trip", TRIP_PRIVATE, WORKSPACE, EDITOR)).resolves.toBe(false);
    });

    it("keeps a custom trip's journal entry unreachable for members without a grant", async () => {
      await expect(isVisibleReportTarget(db(), "entry", ENTRY_CUSTOM, WORKSPACE, EDITOR)).resolves.toBe(false);
      await expect(isVisibleReportTarget(db(), "entry", ENTRY_CUSTOM, WORKSPACE, CREATOR)).resolves.toBe(true);
    });

    it("lets a joined participant report a comment on their private trip", async () => {
      await expect(
        isVisibleReportTarget(db(), "comment", COMMENT_PRIVATE, WORKSPACE, PARTICIPANT),
      ).resolves.toBe(true);
      await expect(isVisibleReportTarget(db(), "comment", COMMENT_PRIVATE, WORKSPACE, EDITOR)).resolves.toBe(false);
    });

    it("does not expose media attached to a private trip to members who cannot read it", async () => {
      // The old media branch never looked at the trip at all.
      await expect(isVisibleReportTarget(db(), "media", MEDIA_PRIVATE, WORKSPACE, EDITOR)).resolves.toBe(false);
      await expect(isVisibleReportTarget(db(), "media", MEDIA_PRIVATE, WORKSPACE, CREATOR)).resolves.toBe(true);
      // Guards the opposite bug: workspace-level media (`tripId: null`) must stay
      // reportable by every member.
      await expect(isVisibleReportTarget(db(), "media", MEDIA_WORKSPACE, WORKSPACE, EDITOR)).resolves.toBe(true);
    });
  });

  describe("share links", () => {
    it("refuses an editor on a private trip they cannot read", async () => {
      // Seeded directly: the editor must not be able to revoke what the creator published.
      const seeded = await db().shareLink.create({
        data: {
          id: SHARE_LINK_SEED,
          workspaceId: WORKSPACE,
          tripId: TRIP_PRIVATE,
          createdById: CREATOR,
          tokenHash: "seeded-hash-for-visibility-audit",
          allowIndex: false,
          showBudget: false,
        },
      });
      expect(seeded.revokedAt).toBeNull();

      const service = shareLinksService();
      await expect(
        service.create(actorFor(EDITOR), membershipFor(EDITOR, "editor"), TRIP_PRIVATE, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.list(actorFor(EDITOR), membershipFor(EDITOR, "editor"), TRIP_PRIVATE),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.revoke(actorFor(EDITOR), membershipFor(EDITOR, "editor"), SHARE_LINK_SEED),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(await db().shareLink.count({ where: { tripId: TRIP_PRIVATE } })).toBe(1);
      const untouched = required(
        await db().shareLink.findUnique({ where: { id: SHARE_LINK_SEED } }),
        "seeded share link",
      );
      expect(untouched.revokedAt).toBeNull();
    });

    it("still lets the creator mint, list and revoke a link for their own private trip", async () => {
      const service = shareLinksService();
      const created = await service.create(actorFor(CREATOR), membershipFor(CREATOR, "owner"), TRIP_PRIVATE, {});
      expect(created.token.length).toBeGreaterThanOrEqual(32);

      const links = await service.list(actorFor(CREATOR), membershipFor(CREATOR, "owner"), TRIP_PRIVATE);
      expect(links.map((link) => link.id)).toContain(created.id);

      await service.revoke(actorFor(CREATOR), membershipFor(CREATOR, "owner"), created.id);
      const revoked = required(await db().shareLink.findUnique({ where: { id: created.id } }), "created share link");
      expect(revoked.revokedAt).not.toBeNull();
    });
  });

  describe("worker jobs", () => {
    it("exports exactly the trips the requester can read", async () => {
      const handleExportJob = await loadWorkerJob("handleExportJob");

      // Editor, workspace scope: only the workspace tier.
      const workspaceObjects: PutObjectCall[] = [];
      const workspaceResult = await handleExportJob(
        { exportId: EXPORT_EDITOR_WORKSPACE, workspaceId: WORKSPACE },
        jobContext("export-editor-workspace", "export"),
        workerDeps({ put: workspaceObjects }),
      );
      expect(workspaceResult.status).toBe("ready");
      expect(titlesOf(decodeExportedJson(workspaceObjects))).toEqual(["Workspace trip"]);

      // Editor, account scope: the union across their memberships, filtered per
      // membership — still only the workspace tier.
      const accountObjects: PutObjectCall[] = [];
      await handleExportJob(
        { exportId: EXPORT_EDITOR_ACCOUNT, workspaceId: WORKSPACE },
        jobContext("export-editor-account", "export"),
        workerDeps({ put: accountObjects }),
      );
      expect(titlesOf(decodeExportedJson(accountObjects))).toEqual(["Workspace trip"]);

      // Participant, workspace scope: gets the joined `private` trip as well as
      // the workspace tier. Proves the fix filters on the rule and does not just
      // drop every non-workspace trip.
      const participantObjects: PutObjectCall[] = [];
      await handleExportJob(
        { exportId: EXPORT_PARTICIPANT, workspaceId: WORKSPACE },
        jobContext("export-participant", "export"),
        workerDeps({ put: participantObjects }),
      );
      expect(titlesOf(decodeExportedJson(participantObjects))).toEqual([
        "Private island notebook",
        "Workspace trip",
      ]);
    });

    it("reminds only the members who can read the trip", async () => {
      const handleReminderJob = await loadWorkerJob("handleReminderJob");
      const mails: Array<{ to: string; subject: string }> = [];

      const result = await handleReminderJob(
        { date: TARGET_DAY },
        jobContext("reminder", "reminders"),
        workerDeps({ mail: mails }),
      );

      // Creator + joined participant. The editor's workspace membership used to
      // be enough to receive the private trip's title and destinations.
      expect(result.sent).toBe(2);
      expect(mails.map((mail) => mail.to).sort()).toEqual(
        [required(EMAILS[CREATOR], "creator email"), required(EMAILS[PARTICIPANT], "participant email")].sort(),
      );
      expect(mails.map((mail) => mail.to)).not.toContain(EMAILS[EDITOR]);

      const notifications = await db().notification.findMany({
        where: { type: "trip_reminder", entityId: TRIP_PRIVATE },
        select: { userId: true },
      });
      expect(notifications.map((row) => row.userId).sort()).toEqual([CREATOR, PARTICIPANT].sort());
    });
  });
});
