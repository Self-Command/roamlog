/**
 * Search is a list of trips the actor may read, so it has to ask the same
 * question the trip list and the detail page ask.
 *
 * The spec records the `where` the repository hands to Prisma, evaluates the
 * visibility fragment against fixture rows, and compares every answer with
 * `resolveTripAccess` — the decision `assertTripVisible` uses on a detail read.
 * A drift is therefore caught in both directions: a `private` trip an admin
 * cannot open must not appear in their search, and a trip an invited
 * participant can open must.
 */

import { describe, expect, it } from "vitest";

import { resolveTripAccess } from "../../trips/trip-access.js";
import { SearchRepository, type SearchQueryArgs } from "../search.repository.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "01942f30-1200-7000-8000-0000000000ff";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const OTHER_USER_ID = "01942f30-1200-7000-8000-000000000003";
const TRIP_ID = "01942f30-1200-7000-8000-000000000004";

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

/** The decision a detail read makes for the same row (`assertTripVisible`). */
function accessFor(trip: TripFixture, platformRole = "user"): boolean {
  return resolveTripAccess({
    actor: {
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      platformRole,
    },
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

function args(overrides: Partial<SearchQueryArgs> = {}): SearchQueryArgs {
  return {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    platformRole: "user",
    q: "seoul",
    limit: 20,
    ...overrides,
  };
}

function build() {
  const calls: Array<{ entity: string; where: Row }> = [];
  const model = (entity: string) => ({
    findMany: async (query: { where: Row }) => {
      calls.push({ entity, where: query.where });
      return [];
    },
  });
  const prisma = {
    client: {
      trip: model("trip"),
      journalEntry: model("journalEntry"),
      comment: model("comment"),
      workspaceMember: model("workspaceMember"),
    },
  };
  return { repository: new SearchRepository(prisma as never), calls };
}

/** `searchTrips` nests the fragment under `AND` so the text `OR` survives. */
function tripVisibilityOf(where: Row): Row {
  const and = where.AND;
  return Array.isArray(and) && and.length > 0 ? (and[0] as Row) : {};
}

describe("search trip visibility", () => {
  it("lets an invited participant find a private trip they can open", async () => {
    const { repository, calls } = build();
    await repository.searchTrips(args());

    const trip = tripFixture({
      visibility: "private",
      participants: [{ userId: USER_ID, status: "invited" }],
    });

    expect(matchesWhere(tripVisibilityOf(first(calls).where), trip)).toBe(true);
    expect(accessFor(trip)).toBe(true);
  });

  it("hides a peer's private trip from every workspace role", async () => {
    const { repository, calls } = build();
    // The repository never receives `membership.role` any more, so an owner or
    // admin now searches with the same rule as an editor or viewer.
    await repository.searchTrips(args({ platformRole: "user" }));

    const trip = tripFixture({ visibility: "private" });

    expect(matchesWhere(tripVisibilityOf(first(calls).where), trip)).toBe(false);
    expect(accessFor(trip)).toBe(false);
  });

  it("lets a custom grantee find the trip and keeps a private grant shut", async () => {
    const { repository, calls } = build();
    await repository.searchTrips(args());
    const visibility = tripVisibilityOf(first(calls).where);

    const granted = tripFixture({
      visibility: "custom",
      accessGrants: [{ userId: USER_ID, workspaceId: null }],
    });
    // A grant recorded on a `private` trip is not a back door, in either half.
    const backDoor = tripFixture({
      visibility: "private",
      accessGrants: [{ userId: USER_ID, workspaceId: null }],
    });

    expect(matchesWhere(visibility, granted)).toBe(true);
    expect(matchesWhere(visibility, backDoor)).toBe(false);
    expect(matchesWhere(visibility, granted)).toBe(accessFor(granted));
    expect(matchesWhere(visibility, backDoor)).toBe(accessFor(backDoor));
  });

  it("matches resolveTripAccess on every visibility and grant shape", async () => {
    const { repository, calls } = build();
    await repository.searchTrips(args());
    const visibility = tripVisibilityOf(first(calls).where);

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
      expect(matchesWhere(visibility, trip)).toBe(accessFor(trip));
    }
  });

  it("keeps the text filter while narrowing by visibility", async () => {
    const { repository, calls } = build();
    await repository.searchTrips(args());
    const where = first(calls).where;

    expect(where.workspaceId).toBe(WORKSPACE_ID);
    expect(where.deletedAt).toBeNull();
    expect(where.AND).toHaveLength(1);
    expect(where.OR).toEqual(
      expect.arrayContaining([{ title: { contains: "seoul", mode: "insensitive" } }]),
    );
  });

  it("does not restrict a super_admin", async () => {
    const { repository, calls } = build();
    await repository.searchTrips(args({ platformRole: "super_admin" }));

    // `tripVisibilityWhere` answers `{}` for staff break-glass; the workspace
    // and text conditions must still be there.
    expect(first(calls).where.AND).toBeUndefined();
    expect(first(calls).where.workspaceId).toBe(WORKSPACE_ID);
    expect(first(calls).where.OR).toBeDefined();
  });

  it("applies the same fragment to entries and comments", async () => {
    const { repository, calls } = build();
    await repository.searchEntries(args());
    await repository.searchComments(args());

    expect(calls.map((call) => call.entity)).toEqual(["journalEntry", "comment"]);
    for (const call of calls) {
      const trip = call.where.trip as Row;

      expect(trip.deletedAt).toBeNull();
      expect(matchesWhere(trip, tripFixture({ visibility: "workspace" }))).toBe(true);
      expect(matchesWhere(trip, tripFixture({ visibility: "private" }))).toBe(false);
    }
  });
});