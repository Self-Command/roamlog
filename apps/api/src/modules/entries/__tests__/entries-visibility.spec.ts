/**
 * `GET /v1/workspaces/{workspaceId}/entries` is a list surface over trips, so it
 * must use the same access rule as the trip list and the detail read.
 *
 * Before this spec the service carried its own `visibility in [...]` OR plus an
 * owner/admin bypass: an admin listed a peer's `private` entries and 404ed on
 * open, while an invited participant — who can open the trip — listed nothing.
 * These pin the `where` the service actually hands to the repository, evaluated
 * row by row and cross-checked with `resolveTripAccess`.
 */

import { describe, expect, it } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import { resolveTripAccess } from "../../trips/trip-access.js";
import { EntriesService } from "../entries.service.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "01942f30-1200-7000-8000-0000000000ff";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const OTHER_USER_ID = "01942f30-1200-7000-8000-000000000003";
const TRIP_ID = "01942f30-1200-7000-8000-000000000004";
const NOW = new Date("2026-11-11T00:00:00.000Z");

type Row = Record<string, unknown>;

/** The builders record every call; assert instead of indexing blindly. */
function first<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("expected at least one recorded call");
  }
  return row;
}

interface TripFixture extends Row {
  id: string;
  workspaceId: string;
  createdById: string;
  visibility: string;
  deletedAt: Date | null;
  participants: Array<{ userId: string; status: string }>;
  accessGrants: Array<{ userId: string | null; workspaceId: string | null }>;
}

function tripFixture(overrides: Partial<TripFixture> = {}): TripFixture {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    createdById: OTHER_USER_ID,
    visibility: "workspace",
    deletedAt: null,
    participants: [],
    accessGrants: [],
    ...overrides,
  };
}

/**
 * Minimal evaluator for the subset of Prisma `where` syntax the visibility
 * fragment uses (`OR`/`AND`, scalar equality, `in`, and a relation `some`).
 */
function matchesWhere(where: unknown, row: Row): boolean {
  if (!where || typeof where !== "object") {
    return true;
  }
  const entries = Object.entries(where as Row);
  if (entries.length === 0) {
    return true;
  }
  return entries.every(([key, condition]) => {
    if (key === "OR") {
      return (condition as unknown[]).some((branch) => matchesWhere(branch, row));
    }
    if (key === "AND") {
      return (condition as unknown[]).every((branch) => matchesWhere(branch, row));
    }
    return matchesField(condition, row[key]);
  });
}

function matchesField(condition: unknown, value: unknown): boolean {
  if (condition === null || typeof condition !== "object" || condition instanceof Date) {
    return condition === value;
  }
  const object = condition as Row;
  if ("some" in object) {
    return (
      Array.isArray(value) &&
      value.some((item) => matchesWhere(object.some, item as Row))
    );
  }
  if ("in" in object) {
    return Array.isArray(object.in) && object.in.includes(value);
  }
  if ("equals" in object) {
    return object.equals === value;
  }
  throw new Error(`unsupported condition: ${JSON.stringify(condition)}`);
}

/** The decision a detail read makes for the same trip (`assertTripVisible`). */
function accessFor(trip: TripFixture): boolean {
  return resolveTripAccess({
    actor: { userId: USER_ID, workspaceId: WORKSPACE_ID, platformRole: "user" },
    trip: {
      id: trip.id,
      workspaceId: trip.workspaceId,
      createdById: trip.createdById,
      visibility: trip.visibility,
    },
    participation: trip.participants.find((row) => row.userId === USER_ID) ?? null,
    grants: trip.accessGrants,
  });
}

function membership(
  role: WorkspaceMembershipAccess["role"] = "viewer",
  workspaceId: string = WORKSPACE_ID,
): WorkspaceMembershipAccess {
  return {
    id: "01942f30-1200-7000-8000-0000000000aa",
    workspaceId,
    userId: USER_ID,
    role,
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    workspaceName: "Test Workspace",
  };
}

function actor(platformRole = "user") {
  return { user: { id: USER_ID, platformRole } } as never;
}

function build() {
  const calls: Row[] = [];
  const repository = {
    listEntries: async (query: { where: Row }) => {
      calls.push(query.where);
      return [];
    },
  };
  const service = new EntriesService(
    repository as never,
    {} as never,
    new PermissionService(),
    {} as never,
  );
  return { service, calls };
}

describe("workspace entries visibility", () => {
  it("lets an invited participant read the entries of a private trip", async () => {
    const { service, calls } = build();
    await service.listWorkspace(actor(), membership(), {});

    const trip = tripFixture({
      visibility: "private",
      participants: [{ userId: USER_ID, status: "invited" }],
    });

    expect(matchesWhere(first(calls).trip, trip)).toBe(true);
    expect(accessFor(trip)).toBe(true);
  });

  it("no longer lets an owner or admin read a peer's private entries", async () => {
    const trip = tripFixture({ visibility: "private" });

    for (const role of ["owner", "admin", "editor", "viewer"] as const) {
      const { service, calls } = build();
      await service.listWorkspace(actor(), membership(role), {});

      expect(matchesWhere(first(calls).trip, trip)).toBe(false);
    }

    expect(accessFor(trip)).toBe(false);
  });

  it("matches resolveTripAccess on every visibility and grant shape", async () => {
    const { service, calls } = build();
    await service.listWorkspace(actor(), membership("admin"), {});
    const tripWhere = first(calls).trip;

    const fixtures = [
      tripFixture(),
      tripFixture({ visibility: "public_link" }),
      tripFixture({ visibility: "private" }),
      tripFixture({ visibility: "private", createdById: USER_ID }),
      tripFixture({
        visibility: "private",
        participants: [{ userId: USER_ID, status: "joined" }],
      }),
      tripFixture({
        visibility: "private",
        participants: [{ userId: USER_ID, status: "declined" }],
      }),
      tripFixture({ visibility: "custom" }),
      tripFixture({
        visibility: "custom",
        accessGrants: [{ userId: USER_ID, workspaceId: null }],
      }),
      tripFixture({
        visibility: "custom",
        accessGrants: [{ userId: null, workspaceId: WORKSPACE_ID }],
      }),
      tripFixture({ workspaceId: OTHER_WORKSPACE_ID }),
    ];

    for (const trip of fixtures) {
      expect(matchesWhere(tripWhere, trip)).toBe(accessFor(trip));
    }
  });

  it("keeps the soft-delete and workspace conditions it already had", async () => {
    const { service, calls } = build();
    await service.listWorkspace(actor(), membership(), {});
    const where = first(calls);

    expect(where.workspaceId).toBe(WORKSPACE_ID);
    expect(where.deletedAt).toBeNull();
    expect((where.trip as Row).deletedAt).toBeNull();
    // The fragment is merged into `trip`, not over the other conditions.
    expect((where.trip as Row).OR).toBeDefined();
  });

  it("keeps the text filter while narrowing by visibility", async () => {
    const { service, calls } = build();
    await service.listWorkspace(actor(), membership(), { q: "euljiro" });
    const where = first(calls);

    expect(where.OR).toEqual(
      expect.arrayContaining([{ title: { contains: "euljiro", mode: "insensitive" } }]),
    );
    expect(matchesWhere((where.trip as Row), tripFixture({ visibility: "private" }))).toBe(false);
    expect(matchesWhere((where.trip as Row), tripFixture({ visibility: "workspace" }))).toBe(true);
  });

  it("does not restrict a super_admin", async () => {
    const { service, calls } = build();
    await service.listWorkspace(actor("super_admin"), membership(), {});

    const tripWhere = first(calls).trip as Row;
    expect(tripWhere.OR).toBeUndefined();
    expect(tripWhere.deletedAt).toBeNull();
  });
});