import { describe, expect, it, vi } from "vitest";

import type { AiToolCall } from "@roamlog/contracts";

import { AiToolbox, type AiToolContext } from "../ai-tools.js";
import { actorStub, membershipStub, TRIP_ID, USER_ID } from "./ai-fixtures.js";

const STOP_ID = "01942f30-1200-7000-8000-000000000302";
const ITEM_ID = "01942f30-1200-7000-8000-000000000303";
const ENTRY_ID = "01942f30-1200-7000-8000-000000000304";
const MEMBER_ID = USER_ID;
const PLACE_ID = "N:3628707764";

function build(
  overrides: {
    stops?: unknown[];
    itinerary?: unknown[];
    packing?: unknown[];
    expenses?: unknown[];
    entry?: unknown;
    stopListError?: Error;
    entryError?: Error;
  } = {},
) {
  const trips = { get: vi.fn(async () => ({ title: "京都一周" })) };
  const stops = {
    list: vi.fn(async () => {
      if (overrides.stopListError) throw overrides.stopListError;
      return overrides.stops ?? [{ id: STOP_ID, city: "清水寺" }];
    }),
  };
  const itinerary = { list: vi.fn(async () => overrides.itinerary ?? []) };
  const packing = { list: vi.fn(async () => ({ items: overrides.packing ?? [] })) };
  const entries = {
    get: vi.fn(async () => {
      if (overrides.entryError) throw overrides.entryError;
      return overrides.entry ?? { title: "第一天：抵达京都" };
    }),
  };
  const expenses = { list: vi.fn(async () => ({ items: overrides.expenses ?? [] })) };
  const toolbox = new AiToolbox(
    {} as never,
    trips as never,
    stops as never,
    itinerary as never,
    packing as never,
    expenses as never,
    entries as never,
  );
  const context: AiToolContext = {
    actor: actorStub(),
    membership: membershipStub("editor"),
    runId: "b".repeat(32),
    candidates: new Map(),
  };
  return { toolbox, context, trips, stops, itinerary, packing, entries, expenses };
}

function call(tool: AiToolCall["tool"], args: Record<string, unknown>): AiToolCall {
  return { tool, args } as AiToolCall;
}

describe("AiToolbox.rememberLabels", () => {
  it("remembers place, stop and trip names already read this run", () => {
    const { toolbox } = build();
    const labels = new Map<string, string>();

    toolbox.rememberLabels(
      call("places.search", { q: "京都" }),
      { candidates: [{ providerPlaceId: PLACE_ID, name: "清水寺" }] },
      labels,
    );
    toolbox.rememberLabels(
      call("stops.list", { tripId: TRIP_ID }),
      { stops: [{ stopId: STOP_ID, city: "京都市" }] },
      labels,
    );
    toolbox.rememberLabels(call("trips.get", { tripId: TRIP_ID }), { tripId: TRIP_ID, title: "京都一周" }, labels);
    toolbox.rememberLabels(
      call("trips.list", { q: "京都" }),
      { trips: [{ tripId: TRIP_ID, title: "京都一周" }] },
      labels,
    );

    expect(labels.get(PLACE_ID)).toBe("清水寺");
    expect(labels.get(STOP_ID)).toBe("京都市");
    expect(labels.get(TRIP_ID)).toBe("京都一周");
  });

  it("ignores a payload that is not an object instead of throwing", () => {
    const { toolbox } = build();
    const labels = new Map<string, string>();
    expect(() =>
      toolbox.rememberLabels(call("places.search", { q: "x" }), null, labels),
    ).not.toThrow();
    expect(() =>
      toolbox.rememberLabels(call("stops.list", { tripId: TRIP_ID }), [], labels),
    ).not.toThrow();
    expect(labels.size).toBe(0);
  });
});

describe("AiToolbox.planSubjects", () => {
  it("returns only the ids the plan references, with names from reads", async () => {
    const { toolbox, context } = build();
    const seen = new Map([[PLACE_ID, "清水寺"]]);
    const subjects = await toolbox.planSubjects(
      [call("stops.add", { tripId: "new", providerPlaceId: PLACE_ID })],
      context,
      seen,
    );

    expect(subjects).toEqual({ [PLACE_ID]: { label: "清水寺" } });
  });

  it("names a delete that only carries an id by listing the plan's trip", async () => {
    const { toolbox, context, stops } = build();
    const subjects = await toolbox.planSubjects(
      [
        call("trips.update", { tripId: TRIP_ID, title: "京都七日" }),
        call("stops.delete", { stopId: STOP_ID }),
      ],
      context,
      new Map(),
    );

    expect(stops.list).toHaveBeenCalledWith(context.actor, context.membership, TRIP_ID);
    expect(subjects[TRIP_ID]).toEqual({ label: "京都一周" });
    expect(subjects[STOP_ID]).toEqual({ label: "清水寺" });
  });

  it("resolves entry titles through the permission-checked read", async () => {
    const { toolbox, context, entries } = build();
    const subjects = await toolbox.planSubjects(
      [call("entries.update", { entryId: ENTRY_ID, title: "第二天" })],
      context,
      new Map(),
    );

    expect(entries.get).toHaveBeenCalledWith(context.actor, context.membership, ENTRY_ID);
    expect(subjects[ENTRY_ID]).toEqual({ label: "第一天：抵达京都" });
  });

  it("resolves itinerary and packing item names from the trip lists", async () => {
    const { toolbox, context } = build({
      itinerary: [{ id: ITEM_ID, title: "清水寺参拜" }],
      packing: [{ id: STOP_ID, name: "护照" }],
    });
    const subjects = await toolbox.planSubjects(
      [
        call("trips.update", { tripId: TRIP_ID, title: "京都七日" }),
        call("itinerary.update", { tripId: TRIP_ID, itemId: ITEM_ID, title: "清水寺参拜" }),
        call("packing.delete", { itemId: STOP_ID }),
      ],
      context,
      new Map(),
    );

    expect(subjects[ITEM_ID]).toEqual({ label: "清水寺参拜" });
    expect(subjects[STOP_ID]).toEqual({ label: "护照" });
  });

  it("logs a failed lookup and keeps the plan namable", async () => {
    const { toolbox, context } = build({ stopListError: new Error("not visible") });
    const errors: string[] = [];
    const subjects = await toolbox.planSubjects(
      [
        call("trips.update", { tripId: TRIP_ID, title: "京都七日" }),
        call("stops.delete", { stopId: STOP_ID }),
      ],
      context,
      new Map(),
      (message) => errors.push(message),
    );

    expect(errors.some((message) => message.includes(`stops.list(${TRIP_ID})`))).toBe(true);
    expect(subjects[STOP_ID]).toBeUndefined();
    expect(subjects[TRIP_ID]).toEqual({ label: "京都一周" });
  });

  it("leaves participant ids nameless instead of inventing a person", async () => {
    const { toolbox, context } = build();
    const subjects = await toolbox.planSubjects(
      [call("participants.role", { tripId: TRIP_ID, memberId: MEMBER_ID, role: "editor" })],
      context,
      new Map(),
    );

    expect(subjects[MEMBER_ID]).toBeUndefined();
    expect(subjects[TRIP_ID]).toEqual({ label: "京都一周" });
  });

  it("returns an empty map for a plan with no calls", async () => {
    const { toolbox, context } = build();
    expect(await toolbox.planSubjects([], context, new Map())).toEqual({});
  });
});