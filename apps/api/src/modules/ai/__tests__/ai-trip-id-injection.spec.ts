import { describe, expect, it, vi } from "vitest";

import { AiToolbox, type AiToolContext } from "../ai-tools.js";
import {
  actorStub,
  KINKAKUJI,
  membershipStub,
  toolServiceMocks,
  tripRecord,
} from "./ai-fixtures.js";

/**
 * The batch channel: a plan that creates a trip and then adds stops cannot know
 * the new trip's id while it is still planning. These tests pin the rule the
 * server applies at execute time — resolve from the batch, or fail loudly.
 */
const CREATED_TRIP_ID = "01942f30-1200-7000-8000-0000000002ff";
const SECOND_TRIP_ID = "01942f30-1200-7000-8000-0000000002aa";
/** A UUIDv4: syntactically an id, structurally impossible as a stored UUIDv7. */
const FABRICATED_V4 = "123e4567-e89b-42d3-a456-426614174000";

function harness(createdIds: string[] = [CREATED_TRIP_ID]) {
  const mocks = toolServiceMocks();
  mocks.trips.create.mockReset();
  for (const id of createdIds) {
    mocks.trips.create.mockResolvedValueOnce(tripRecord({ id }));
  }
  mocks.trips.create.mockResolvedValue(tripRecord({ id: createdIds.at(-1) ?? CREATED_TRIP_ID }));
  const toolbox = new AiToolbox(
    mocks.places as never,
    mocks.trips as never,
    mocks.stops as never,
    mocks.itinerary as never,
    mocks.packing as never,
  );
  return { toolbox, mocks };
}

function context(): AiToolContext {
  return {
    actor: actorStub(),
    membership: membershipStub("editor"),
    runId: "c".repeat(32),
    candidates: new Map([[KINKAKUJI.providerPlaceId, KINKAKUJI]]),
    createdTripIds: [],
  };
}

const stopArgs = { providerPlaceId: KINKAKUJI.providerPlaceId } as const;

describe("AiToolbox tripId hand-off inside one batch", () => {
  it("points a later stop at the trip this batch created", async () => {
    const { toolbox, mocks } = harness();
    const ctx = context();

    const created = await toolbox.execute({ tool: "trips.create", args: { title: "京都 5 天" } }, ctx);
    expect(created.ok).toBe(true);
    expect(created.entityId).toBe(CREATED_TRIP_ID);
    expect(ctx.createdTripIds).toEqual([CREATED_TRIP_ID]);

    const added = await toolbox.execute({ tool: "stops.add", args: stopArgs }, ctx);

    expect(added.ok).toBe(true);
    expect(mocks.stops.create).toHaveBeenCalledTimes(1);
    // (actor, membership, tripId, body)
    expect(mocks.stops.create.mock.calls[0]?.[2]).toBe(CREATED_TRIP_ID);
  });

  it("treats a non-id placeholder as 'the trip created above'", async () => {
    const { toolbox, mocks } = harness();
    const ctx = context();
    await toolbox.execute({ tool: "trips.create", args: { title: "京都 5 天" } }, ctx);

    const added = await toolbox.execute(
      { tool: "packing.add", args: { tripId: "new", name: "护照" } },
      ctx,
    );

    expect(added.ok).toBe(true);
    expect(mocks.packing.create.mock.calls[0]?.[2]).toBe(CREATED_TRIP_ID);
  });

  it("treats a fabricated v4 uuid as a placeholder, never as the target", async () => {
    const { toolbox, mocks } = harness();
    const ctx = context();
    await toolbox.execute({ tool: "trips.create", args: { title: "京都 5 天" } }, ctx);

    const added = await toolbox.execute(
      { tool: "budget.setSummary", args: { tripId: FABRICATED_V4, amountMinor: 800_000, currency: "CNY" } },
      ctx,
    );

    expect(added.ok).toBe(true);
    expect(mocks.trips.get.mock.calls[0]?.[2]).toBe(CREATED_TRIP_ID);
  });

  it("never rewrites an explicit trip uuid, even right after a create", async () => {
    const { toolbox, mocks } = harness();
    const ctx = context();
    await toolbox.execute({ tool: "trips.create", args: { title: "京都 5 天" } }, ctx);

    const added = await toolbox.execute(
      { tool: "stops.add", args: { tripId: "01942f30-1200-7000-8000-000000000201", ...stopArgs } },
      ctx,
    );

    expect(added.ok).toBe(true);
    expect(mocks.stops.create.mock.calls[0]?.[2]).toBe(
      "01942f30-1200-7000-8000-000000000201",
    );
  });

  it("fails readably when the batch created no trip", async () => {
    const { toolbox, mocks } = harness();
    const ctx = context();

    const added = await toolbox.execute({ tool: "stops.add", args: stopArgs }, ctx);

    expect(added.ok).toBe(false);
    expect(added.error?.code).toBe("TRIP_ID_UNRESOLVED");
    expect(added.error?.message).toContain("trips.create");
    expect(mocks.stops.create).not.toHaveBeenCalled();
  });

  it("refuses to guess when the batch created two trips", async () => {
    const { toolbox, mocks } = harness([CREATED_TRIP_ID, SECOND_TRIP_ID]);
    const ctx = context();
    await toolbox.execute({ tool: "trips.create", args: { title: "京都" } }, ctx);
    await toolbox.execute({ tool: "trips.create", args: { title: "大阪" } }, ctx);
    expect(ctx.createdTripIds).toEqual([CREATED_TRIP_ID, SECOND_TRIP_ID]);

    const added = await toolbox.execute(
      { tool: "packing.add", args: { tripId: "new", name: "护照" } },
      ctx,
    );

    expect(added.ok).toBe(false);
    expect(added.error?.code).toBe("TRIP_ID_AMBIGUOUS");
    expect(added.error?.message).toContain("2");
    expect(mocks.packing.create).not.toHaveBeenCalled();
  });

  it("applies the same rule to trips.update", async () => {
    const { toolbox, mocks } = harness();
    const ctx = context();
    await toolbox.execute({ tool: "trips.create", args: { title: "京都 5 天" } }, ctx);

    const updated = await toolbox.execute(
      { tool: "trips.update", args: { endDate: "2026-12-06" } },
      ctx,
    );

    expect(updated.ok).toBe(true);
    expect(mocks.trips.get.mock.calls[0]?.[2]).toBe(CREATED_TRIP_ID);
    expect(mocks.trips.update.mock.calls[0]?.[2]).toBe(CREATED_TRIP_ID);
  });

  it("does not record a failed create as this batch's trip", async () => {
    const mocks = toolServiceMocks();
    mocks.trips.create.mockRejectedValue(new Error("boom"));
    const toolbox = new AiToolbox(
      mocks.places as never,
      mocks.trips as never,
      mocks.stops as never,
      mocks.itinerary as never,
      mocks.packing as never,
    );
    const ctx = context();

    await expect(
      toolbox.execute({ tool: "trips.create", args: { title: "京都" } }, ctx),
    ).rejects.toThrow("boom");
    expect(ctx.createdTripIds).toEqual([]);

    const added = await toolbox.execute({ tool: "stops.add", args: stopArgs }, ctx);
    expect(added.error?.code).toBe("TRIP_ID_UNRESOLVED");
  });
});

describe("AiToolbox preview accepts the deferred tripId", () => {
  it("queues stops.add without a tripId instead of rejecting it at plan time", () => {
    const { toolbox } = harness();
    expect(toolbox.preview({ tool: "stops.add", args: stopArgs }, context())).toBeNull();
  });

  it("still rejects a stops.add whose place was never searched", () => {
    const { toolbox } = harness();
    expect(
      toolbox.preview({ tool: "stops.add", args: { providerPlaceId: "N:999999" } }, context()),
    ).toMatchObject({ code: "UNRESOLVED_PLACE" });
  });

  it("rejects a trips.update that changes nothing", () => {
    const { toolbox } = harness();
    expect(
      toolbox.preview({ tool: "trips.update", args: { tripId: "01942f30-1200-7000-8000-000000000201" } }, context()),
    ).toMatchObject({ code: "INVALID_ARGUMENTS" });
  });

  it("does not execute writes while previewing", () => {
    const { toolbox, mocks } = harness();
    toolbox.preview({ tool: "stops.add", args: stopArgs }, context());
    expect(mocks.stops.create).not.toHaveBeenCalled();
    expect(vi.isMockFunction(mocks.stops.create)).toBe(true);
  });
});
