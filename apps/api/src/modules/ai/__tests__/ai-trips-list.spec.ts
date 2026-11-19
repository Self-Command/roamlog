import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { TripRecord } from "../../trips/content-records.js";
import { TripsService } from "../../trips/trips.service.js";
import { AiToolbox, AI_TOOL_SPECS, type AiToolContext } from "../ai-tools.js";
import { actorStub, membershipStub, tripRecord, USER_ID, WORKSPACE_ID } from "./ai-fixtures.js";

/**
 * `trips.list` is the discovery read the planner uses when a user names a trip
 * ("the Kyoto 5-day trip") instead of giving a UUID.
 *
 * These tests drive the **real** `TripsService.list` — no prisma query is
 * re-implemented in the tool — over an in-memory repository that evaluates the
 * `where` the service builds. Private trips of other people and trips of other
 * workspaces therefore have to disappear because of the product's own
 * `tripVisibilityWhere`, not because the test filtered them out.
 */
const OTHER_USER_ID = "01942f30-1200-7000-8000-0000000000ee";
const OTHER_WORKSPACE_ID = "01942f30-1200-7000-8000-0000000000ff";

interface TripRow extends TripRecord {
  participants?: Array<{ userId: string; status: string }>;
  accessGrants?: Array<{ workspaceId: string | null; userId: string | null }>;
}

function row(overrides: Record<string, unknown> = {}): TripRow {
  return {
    ...tripRecord(overrides),
    coverMediaId: null,
    origin: "未填写",
    originAddress: null,
    originBbox: null,
    showExactPhotoLocation: true,
    destinationsV2: [],
    participants: [],
    accessGrants: [],
    ...overrides,
  } as unknown as TripRow;
}

function date(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function matches(record: TripRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    switch (key) {
      case "AND":
        return (expected as Array<Record<string, unknown>>).every((part) => matches(record, part));
      case "OR":
        return (expected as Array<Record<string, unknown>>).some((part) => matches(record, part));
      case "workspaceId":
        return record.workspaceId === expected;
      case "deletedAt":
        return record.deletedAt === expected;
      case "createdById":
        return record.createdById === expected;
      case "visibility": {
        if (typeof expected === "string") return record.visibility === expected;
        const options = (expected as { in?: string[] }).in ?? [];
        return options.includes(record.visibility);
      }
      case "title":
      case "summary": {
        const filter = expected as { contains?: string; mode?: string };
        if (!filter.contains) return false;
        const haystack = record[key as "title" | "summary"].toLowerCase();
        return haystack.includes(filter.contains.toLowerCase());
      }
      case "destinations":
        return record.destinations.includes((expected as { has: string }).has);
      case "tags":
        return record.tags.includes((expected as { has: string }).has);
      case "participants": {
        const filter = (expected as { some: { userId: string; status: { in: string[] } } }).some;
        return (record.participants ?? []).some(
          (participant) =>
            participant.userId === filter.userId && filter.status.in.includes(participant.status),
        );
      }
      case "accessGrants": {
        const filter = (expected as {
          some: { userId?: string; workspaceId?: string };
        }).some;
        return (record.accessGrants ?? []).some(
          (grant) =>
            (filter.userId === undefined || grant.userId === filter.userId) &&
            (filter.workspaceId === undefined || grant.workspaceId === filter.workspaceId),
        );
      }
      default:
        throw new Error(`ai-trips-list fixture does not understand where.${key}`);
    }
  });
}

function build(rows: TripRow[]) {
  const repository = {
    listTrips: vi.fn(
      async (args: {
        where: Record<string, unknown>;
        orderBy: Array<Record<string, "asc" | "desc">>;
        take: number;
      }) => {
        const matched = rows.filter((record) => matches(record, args.where));
        const [first = {}] = args.orderBy;
        const field = Object.keys(first)[0] ?? "startDate";
        const direction = first[field] ?? "asc";
        matched.sort((left, right) => {
          const a = (left as unknown as Record<string, unknown>)[field];
          const b = (right as unknown as Record<string, unknown>)[field];
          const result = date(a).localeCompare(date(b));
          return direction === "desc" ? -result : result;
        });
        return matched.slice(0, args.take);
      },
    ),
  };
  const trips = new TripsService(
    repository as never,
    new PermissionService(),
    {} as never,
    undefined,
  );
  const toolbox = new AiToolbox(
    {} as never,
    trips as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { toolbox, repository };
}

function context(): AiToolContext {
  return {
    actor: actorStub(),
    membership: membershipStub(),
    runId: "1".repeat(32),
    candidates: new Map(),
    createdTripIds: [],
  };
}

function payloadTrips(outcome: { payload: unknown }): Array<Record<string, unknown>> {
  return (outcome.payload as { trips: Array<Record<string, unknown>> }).trips;
}

describe("AiToolbox trips.list", () => {
  const visibleOwn = row({
    id: "01942f30-1200-7000-8000-000000000301",
    title: "京都 5 日赏樱计划",
    startDate: "2027-03-01",
    endDate: "2027-03-05",
    destinations: ["京都"],
    visibility: "private",
    createdById: USER_ID,
  });
  const privateColleague = row({
    id: "01942f30-1200-7000-8000-000000000302",
    title: "同事的京都私密行程",
    startDate: "2027-04-01",
    endDate: "2027-04-04",
    visibility: "private",
    createdById: OTHER_USER_ID,
  });
  const workspaceShared = row({
    id: "01942f30-1200-7000-8000-000000000303",
    title: "京都团队行程",
    startDate: "2027-05-01",
    endDate: "2027-05-04",
    visibility: "workspace",
    createdById: OTHER_USER_ID,
  });
  const foreignPrivate = row({
    id: "01942f30-1200-7000-8000-000000000304",
    title: "京都外部行程",
    startDate: "2027-06-01",
    endDate: "2027-06-04",
    visibility: "private",
    workspaceId: OTHER_WORKSPACE_ID,
    createdById: OTHER_USER_ID,
  });
  const foreignShared = row({
    id: "01942f30-1200-7000-8000-000000000305",
    title: "京都外部公开行程",
    startDate: "2027-07-01",
    endDate: "2027-07-04",
    visibility: "workspace",
    workspaceId: OTHER_WORKSPACE_ID,
    createdById: OTHER_USER_ID,
  });
  const customGranted = row({
    id: "01942f30-1200-7000-8000-000000000306",
    title: "京都定制分享行程",
    startDate: "2027-02-01",
    endDate: "2027-02-04",
    visibility: "custom",
    createdById: OTHER_USER_ID,
    accessGrants: [{ workspaceId: WORKSPACE_ID, userId: null }],
  });

  const allRows = [
    visibleOwn,
    privateColleague,
    workspaceShared,
    foreignPrivate,
    foreignShared,
    customGranted,
  ];

  it("returns only trips the caller can see and hides summaries", async () => {
    const { toolbox } = build(allRows);

    const outcome = await toolbox.execute({ tool: "trips.list", args: {} }, context());

    expect(outcome.ok).toBe(true);
    // Newest startDate first: May (shared), March (own), February (granted).
    expect(payloadTrips(outcome).map((trip) => trip.tripId)).toEqual([
      workspaceShared.id,
      visibleOwn.id,
      customGranted.id,
    ]);
    // A private trip of a colleague is not readable even in the same workspace.
    expect(payloadTrips(outcome).map((trip) => trip.tripId)).not.toContain(privateColleague.id);
    // A workspace-scoped tier never crosses the workspace boundary.
    expect(payloadTrips(outcome).map((trip) => trip.tripId)).not.toContain(foreignShared.id);
    expect(payloadTrips(outcome).map((trip) => trip.tripId)).not.toContain(foreignPrivate.id);
    // The payload is discovery-sized: no summary body and no visibility grants.
    expect(payloadTrips(outcome)[1]).toEqual({
      tripId: visibleOwn.id,
      title: "京都 5 日赏樱计划",
      startDate: "2027-03-01",
      endDate: "2027-03-05",
      destination: "京都",
    });
  });

  it("passes the caller's membership, never a model-supplied workspace or user id", async () => {
    const { toolbox, repository } = build(allRows);

    const outcome = await toolbox.execute(
      {
        tool: "trips.list",
        args: {
          query: "京都",
          limit: 5,
          workspaceId: OTHER_WORKSPACE_ID,
          userId: OTHER_USER_ID,
        },
      },
      context(),
    );

    expect(outcome.ok).toBe(true);
    const args = repository.listTrips.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(args.where.workspaceId).toBe(WORKSPACE_ID);
    expect(args.take).toBe(6); // limit + 1 for hasMore
    // Neither the foreign workspace nor the colleague's private trip leaks in.
    expect(payloadTrips(outcome).map((trip) => trip.tripId)).not.toContain(foreignPrivate.id);
    expect(payloadTrips(outcome).map((trip) => trip.tripId)).not.toContain(privateColleague.id);
  });

  it("filters by a title keyword and matches case-insensitively", async () => {
    const { toolbox } = build(allRows);

    const outcome = await toolbox.execute(
      { tool: "trips.list", args: { query: "京都" } },
      context(),
    );

    expect(outcome.ok).toBe(true);
    expect(payloadTrips(outcome).map((trip) => trip.title)).toEqual([
      "京都团队行程",
      "京都 5 日赏樱计划",
      "京都定制分享行程",
    ]);
  });

  it("defaults to 10 trips and enforces the 1-20 limit bounds", async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      row({
        id: `01942f30-1200-7000-8000-${String(400 + index).padStart(12, "0")}`,
        title: `行程 ${index}`,
        startDate: `2027-01-${String(index + 1).padStart(2, "0")}`,
        endDate: `2027-02-${String(index + 1).padStart(2, "0")}`,
        visibility: "workspace",
        createdById: USER_ID,
      }),
    );
    const { toolbox, repository } = build(many);

    const byDefault = await toolbox.execute({ tool: "trips.list", args: {} }, context());
    expect(payloadTrips(byDefault)).toHaveLength(10);
    expect((repository.listTrips.mock.calls[0]?.[0] as { take: number }).take).toBe(11);

    const one = await toolbox.execute({ tool: "trips.list", args: { limit: 1 } }, context());
    expect(payloadTrips(one)).toHaveLength(1);

    for (const limit of [0, 21]) {
      const rejected = await toolbox.execute(
        { tool: "trips.list", args: { limit } },
        context(),
      );
      expect(rejected.ok).toBe(false);
      expect(rejected.error?.code).toBe("INVALID_ARGUMENTS");
    }
  });

  it("is read-only so the plan phase can execute it without writing", () => {
    expect(toolboxReadOnly()).toBe(true);
    const spec = AI_TOOL_SPECS.find((tool) => tool.name === "trips.list");
    expect(spec).toBeDefined();
    expect(spec?.description).toContain("Read-only, no side effects");
    // Discovery never accepts identifiers that could widen its scope.
    expect(JSON.stringify(spec?.parameters)).not.toMatch(/workspaceId|userId|ownerId/u);
  });
});

function toolboxReadOnly(): boolean {
  const { toolbox } = build([]);
  return toolbox.isReadOnly("trips.list");
}
