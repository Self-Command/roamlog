import type { AiToolName } from "@roamlog/contracts";
import { describe, expect, it, vi } from "vitest";

import { AiToolbox, type AiToolContext } from "../ai-tools.js";
import {
  actorStub,
  ITEM_ID,
  membershipStub,
  PACKING_ID,
  STOP_ID,
  TRIP_ID,
  USER_ID,
} from "./ai-fixtures.js";

/**
 * AI_TOOL_SURFACE_EXPAND_2: the new write tools must validate their arguments
 * with the same strictness as a controller body and must delegate to the
 * existing product services instead of touching Prisma.
 */
const EXPENSE_ID = "01942f30-1200-7000-8000-000000000205";
const ENTRY_ID = "01942f30-1200-7000-8000-000000000206";
const PARTICIPANT_ID = "01942f30-1200-7000-8000-000000000207";

function context(): AiToolContext {
  return {
    actor: actorStub(),
    membership: membershipStub("editor"),
    runId: "e".repeat(32),
    candidates: new Map(),
    createdTripIds: [],
    today: "2026-12-01",
  };
}

function previewToolbox(): AiToolbox {
  return new AiToolbox(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

interface ValidationCase {
  readonly tool: AiToolName;
  readonly valid: Record<string, unknown>;
  readonly missing: Record<string, unknown>;
  readonly badType: Record<string, unknown>;
}

const expenseAdd = {
  tripId: TRIP_ID,
  date: "2026-12-01",
  category: "food",
  amountMinor: 1200,
  currency: "CNY",
  paidByMemberId: USER_ID,
  splitMode: "equal",
  participants: [{ memberId: USER_ID }],
} as const;

const validationCases: readonly ValidationCase[] = [
  {
    tool: "stops.update",
    valid: { tripId: TRIP_ID, stopId: STOP_ID, notes: "Near the station" },
    missing: { tripId: TRIP_ID, stopId: STOP_ID },
    badType: { tripId: TRIP_ID, stopId: STOP_ID, startDate: 20261201 },
  },
  {
    tool: "stops.delete",
    valid: { stopId: STOP_ID },
    missing: {},
    badType: { stopId: 123 },
  },
  {
    tool: "stops.reorder",
    valid: { tripId: TRIP_ID, items: [{ id: STOP_ID, order: 0 }] },
    missing: { tripId: TRIP_ID },
    badType: { tripId: TRIP_ID, items: [{ id: STOP_ID, order: "first" }] },
  },
  {
    tool: "itinerary.update",
    valid: { tripId: TRIP_ID, itemId: ITEM_ID, title: "Museum" },
    missing: { tripId: TRIP_ID, itemId: ITEM_ID },
    badType: { tripId: TRIP_ID, itemId: ITEM_ID, date: 20261201 },
  },
  {
    tool: "itinerary.delete",
    valid: { itemId: ITEM_ID },
    missing: {},
    badType: { itemId: 123 },
  },
  {
    tool: "packing.update",
    valid: { tripId: TRIP_ID, itemId: PACKING_ID, packed: true },
    missing: { tripId: TRIP_ID, itemId: PACKING_ID },
    badType: { tripId: TRIP_ID, itemId: PACKING_ID, quantity: "two" },
  },
  {
    tool: "packing.delete",
    valid: { itemId: PACKING_ID },
    missing: {},
    badType: { itemId: 123 },
  },
  {
    tool: "packing.reorder",
    valid: { tripId: TRIP_ID, items: [{ id: PACKING_ID, order: 1 }] },
    missing: { tripId: TRIP_ID },
    badType: { tripId: TRIP_ID, items: [{ id: PACKING_ID, order: -1 }] },
  },
  {
    tool: "expenses.add",
    valid: expenseAdd,
    missing: { ...expenseAdd, amountMinor: undefined },
    badType: { ...expenseAdd, amountMinor: "1200" },
  },
  {
    tool: "expenses.update",
    valid: { tripId: TRIP_ID, expenseId: EXPENSE_ID, note: "Dinner" },
    missing: { tripId: TRIP_ID, expenseId: EXPENSE_ID },
    badType: { tripId: TRIP_ID, expenseId: EXPENSE_ID, amountMinor: "1200" },
  },
  {
    tool: "expenses.delete",
    valid: { expenseId: EXPENSE_ID },
    missing: {},
    badType: { expenseId: 123 },
  },
  {
    tool: "entries.create",
    valid: { tripId: TRIP_ID, title: "Day one", content: "A long walk by the river." },
    missing: { tripId: TRIP_ID, title: "Day one" },
    badType: { tripId: TRIP_ID, title: "Day one", content: 42 },
  },
  {
    tool: "entries.update",
    valid: { entryId: ENTRY_ID, title: "Day one, edited" },
    missing: {},
    badType: { entryId: ENTRY_ID, favorite: "yes" },
  },
  {
    tool: "participants.add",
    valid: { tripId: TRIP_ID, memberId: USER_ID },
    missing: { tripId: TRIP_ID },
    badType: { tripId: TRIP_ID, memberId: "not-a-uuid" },
  },
  {
    tool: "participants.remove",
    valid: { tripId: TRIP_ID, memberId: USER_ID },
    missing: { tripId: TRIP_ID },
    badType: { tripId: TRIP_ID, memberId: "not-a-uuid" },
  },
  {
    tool: "participants.role",
    valid: { tripId: TRIP_ID, memberId: USER_ID, role: "editor" },
    missing: { tripId: TRIP_ID, memberId: USER_ID },
    badType: { tripId: TRIP_ID, memberId: USER_ID, role: "owner" },
  },
];

describe("new AI tool argument validation", () => {
  it.each(validationCases)("$tool accepts a valid payload and rejects missing/typed fields", (testCase) => {
    const toolbox = previewToolbox();

    expect(toolbox.preview({ tool: testCase.tool, args: testCase.valid }, context())).toBeNull();
    expect(
      toolbox.preview({ tool: testCase.tool, args: testCase.missing }, context())?.code,
    ).toBe("INVALID_ARGUMENTS");
    expect(
      toolbox.preview({ tool: testCase.tool, args: testCase.badType }, context())?.code,
    ).toBe("INVALID_ARGUMENTS");
  });

  it.each(validationCases)("$tool rejects server-injected fields", (testCase) => {
    const toolbox = previewToolbox();

    expect(
      toolbox.preview(
        {
          tool: testCase.tool,
          args: {
            ...testCase.valid,
            workspaceId: "01942f30-1200-7000-8000-00000000dead",
            userId: USER_ID,
            createdById: USER_ID,
            version: 99,
          },
        },
        context(),
      )?.code,
    ).toBe("INVALID_ARGUMENTS");
  });

  it("rejects model-authored visibility and privacy switches through trips.update", () => {
    const toolbox = previewToolbox();

    // trips.update keeps the historical strip mode, but the whitelist only
    // counts allowed fields — a privacy-only payload changes nothing and fails.
    expect(
      toolbox.preview(
        { tool: "trips.update", args: { tripId: TRIP_ID, visibility: "public_link" } },
        context(),
      )?.code,
    ).toBe("INVALID_ARGUMENTS");
    expect(
      toolbox.preview(
        {
          tool: "trips.update",
          args: { tripId: TRIP_ID, showExactPhotoLocation: false },
        },
        context(),
      )?.code,
    ).toBe("INVALID_ARGUMENTS");
  });
});

function serviceMocks() {
  return {
    trips: {
      addParticipant: vi.fn(async () => ({
        id: PARTICIPANT_ID,
        userId: USER_ID,
        role: "editor",
        status: "joined",
      })),
      removeParticipant: vi.fn(async () => ({ message: "Participant removed." })),
      updateParticipant: vi.fn(async () => ({
        id: PARTICIPANT_ID,
        userId: USER_ID,
        role: "viewer",
        status: "joined",
      })),
    },
    stops: {
      list: vi.fn(async (_actor: unknown, _membership: unknown, _tripId: string) => [
        {
          id: STOP_ID,
          version: 4,
          city: "Kyoto",
          country: "Japan",
          startDate: "2026-12-01",
          endDate: "2026-12-02",
          order: 0,
        },
      ]),
      update: vi.fn(async (_actor: unknown, _membership: unknown, _stopId: string, _body: Record<string, unknown>) => ({
        id: STOP_ID,
        city: "Osaka",
        country: "Japan",
        startDate: "2026-12-01",
        endDate: "2026-12-03",
        version: 5,
      })),
      remove: vi.fn(async (_actor: unknown, _membership: unknown, _stopId: string) => ({
        message: "Stop deleted.",
      })),
      reorder: vi.fn(async (_actor: unknown, _membership: unknown, _tripId: string, _body: Record<string, unknown>) => [
        { id: STOP_ID, order: 0 },
      ]),
    },
    itinerary: {
      list: vi.fn(async (_actor: unknown, _membership: unknown, _tripId: string) => [
        { id: ITEM_ID, version: 2, date: "2026-12-01", title: "Walk", done: false },
      ]),
      update: vi.fn(async (_actor: unknown, _membership: unknown, _itemId: string, _body: Record<string, unknown>) => ({
        id: ITEM_ID,
        date: "2026-12-02",
        title: "Museum",
        done: true,
        version: 3,
      })),
      remove: vi.fn(async (_actor: unknown, _membership: unknown, _itemId: string) => ({
        message: "Itinerary item deleted.",
      })),
    },
    packing: {
      list: vi.fn(async (_actor: unknown, _membership: unknown, _tripId: string, _query: unknown) => ({
        items: [{ id: PACKING_ID, version: 1, name: "Socks", quantity: 2, packed: false }],
        nextCursor: null,
        hasMore: false,
      })),
      update: vi.fn(async (_actor: unknown, _membership: unknown, _itemId: string, _body: Record<string, unknown>) => ({
        id: PACKING_ID,
        name: "Socks",
        quantity: 3,
        packed: true,
        version: 2,
      })),
      remove: vi.fn(async (_actor: unknown, _membership: unknown, _itemId: string) => ({
        message: "Packing item deleted.",
      })),
      reorder: vi.fn(async (_actor: unknown, _membership: unknown, _tripId: string, _body: Record<string, unknown>) => [
        { id: PACKING_ID, order: 0 },
      ]),
    },
    expenses: {
      list: vi.fn(async (_actor: unknown, _membership: unknown, _tripId: string, _query: unknown) => ({
        items: [{ id: EXPENSE_ID, version: 1 }],
        nextCursor: null,
        hasMore: false,
      })),
      create: vi.fn(async (_actor: unknown, _membership: unknown, _tripId: string, _body: Record<string, unknown>) => ({
        id: EXPENSE_ID,
        amountMinor: 1200,
        currency: "CNY",
        splitMode: "equal",
        version: 1,
      })),
      update: vi.fn(async (_actor: unknown, _membership: unknown, _expenseId: string, _body: Record<string, unknown>) => ({
        id: EXPENSE_ID,
        amountMinor: 1500,
        currency: "CNY",
        version: 2,
      })),
      remove: vi.fn(async (_actor: unknown, _membership: unknown, _expenseId: string) => ({
        message: "Expense deleted.",
      })),
    },
    entries: {
      get: vi.fn(async (_actor: unknown, _membership: unknown, _entryId: string) => ({
        id: ENTRY_ID,
        version: 1,
      })),
      create: vi.fn(async (_actor: unknown, _membership: unknown, _tripId: string, _body: Record<string, unknown>) => ({
        id: ENTRY_ID,
        title: "Day one",
        date: "2026-12-01",
      })),
      update: vi.fn(async (_actor: unknown, _membership: unknown, _entryId: string, _body: Record<string, unknown>) => ({
        id: ENTRY_ID,
        title: "Day one",
        date: "2026-12-01",
        version: 2,
      })),
    },
  };
}

function toolboxWith(mocks: ReturnType<typeof serviceMocks>): AiToolbox {
  return new AiToolbox(
    {} as never,
    mocks.trips as never,
    mocks.stops as never,
    mocks.itinerary as never,
    mocks.packing as never,
    mocks.expenses as never,
    mocks.entries as never,
  );
}

describe("new AI tool service delegation", () => {
  it("calls StopsService for update, delete and reorder", async () => {
    const mocks = serviceMocks();
    const toolbox = toolboxWith(mocks);

    expect(
      (
        await toolbox.execute(
          { tool: "stops.update", args: { tripId: TRIP_ID, stopId: STOP_ID, notes: "Near" } },
          context(),
        )
      ).ok,
    ).toBe(true);
    expect(mocks.stops.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      STOP_ID,
      expect.objectContaining({ version: 4, notes: "Near" }),
    );

    expect(
      (await toolbox.execute({ tool: "stops.delete", args: { stopId: STOP_ID } }, context())).ok,
    ).toBe(true);
    expect(mocks.stops.remove).toHaveBeenCalledWith(expect.anything(), expect.anything(), STOP_ID);

    expect(
      (
        await toolbox.execute(
          {
            tool: "stops.reorder",
            args: { tripId: TRIP_ID, items: [{ id: STOP_ID, order: 0 }] },
          },
          context(),
        )
      ).ok,
    ).toBe(true);
    expect(mocks.stops.reorder).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      TRIP_ID,
      { items: [{ id: STOP_ID, order: 0 }] },
    );
  });

  it("calls ItineraryService and PackingService for update and delete", async () => {
    const mocks = serviceMocks();
    const toolbox = toolboxWith(mocks);

    expect(
      (
        await toolbox.execute(
          { tool: "itinerary.update", args: { tripId: TRIP_ID, itemId: ITEM_ID, done: true } },
          context(),
        )
      ).ok,
    ).toBe(true);
    expect(mocks.itinerary.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ITEM_ID,
      expect.objectContaining({ version: 2, done: true }),
    );

    expect(
      (
        await toolbox.execute({ tool: "itinerary.delete", args: { itemId: ITEM_ID } }, context())
      ).ok,
    ).toBe(true);

    expect(
      (
        await toolbox.execute(
          { tool: "packing.update", args: { tripId: TRIP_ID, itemId: PACKING_ID, packed: true } },
          context(),
        )
      ).ok,
    ).toBe(true);
    expect(mocks.packing.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      PACKING_ID,
      expect.objectContaining({ version: 1, packed: true }),
    );

    expect(
      (
        await toolbox.execute(
          {
            tool: "packing.reorder",
            args: { tripId: TRIP_ID, items: [{ id: PACKING_ID, order: 0 }] },
          },
          context(),
        )
      ).ok,
    ).toBe(true);

    expect(
      (await toolbox.execute({ tool: "packing.delete", args: { itemId: PACKING_ID } }, context())).ok,
    ).toBe(true);
  });

  it("maps memberId to the service's userId field for expenses and participants", async () => {
    const mocks = serviceMocks();
    const toolbox = toolboxWith(mocks);

    const expense = await toolbox.execute(
      { tool: "expenses.add", args: expenseAdd },
      context(),
    );
    expect(expense.ok).toBe(true);
    expect(mocks.expenses.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      TRIP_ID,
      expect.objectContaining({
        paidById: USER_ID,
        note: "",
        participants: [{ userId: USER_ID }],
      }),
    );

    expect(
      (
        await toolbox.execute(
          {
            tool: "participants.add",
            args: { tripId: TRIP_ID, memberId: USER_ID },
          },
          context(),
        )
      ).ok,
    ).toBe(true);
    expect(mocks.trips.addParticipant).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      TRIP_ID,
      { userId: USER_ID },
    );

    expect(
      (
        await toolbox.execute(
          { tool: "participants.role", args: { tripId: TRIP_ID, memberId: USER_ID, role: "viewer" } },
          context(),
        )
      ).ok,
    ).toBe(true);
    expect(mocks.trips.updateParticipant).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      TRIP_ID,
      USER_ID,
      { role: "viewer" },
    );

    expect(
      (
        await toolbox.execute(
          { tool: "participants.remove", args: { tripId: TRIP_ID, memberId: USER_ID } },
          context(),
        )
      ).ok,
    ).toBe(true);
    expect(mocks.trips.removeParticipant).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      TRIP_ID,
      USER_ID,
    );
  });

  it("builds the editor document for entries.create and entries.update", async () => {
    const mocks = serviceMocks();
    const toolbox = toolboxWith(mocks);

    expect(
      (
        await toolbox.execute(
          {
            tool: "entries.create",
            args: { tripId: TRIP_ID, title: "Day one", content: "A walk.\nDinner." },
          },
          context(),
        )
      ).ok,
    ).toBe(true);
    const createBody = mocks.entries.create.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(createBody.title).toBe("Day one");
    expect(createBody.date).toBe("2026-12-01");
    expect(createBody.location).toBe("未填写");
    expect(createBody.contentJson).toMatchObject({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A walk." }] },
        { type: "paragraph", content: [{ type: "text", text: "Dinner." }] },
      ],
    });
    expect(createBody.contentHtml).toBe("<p>A walk.</p><p>Dinner.</p>");

    expect(
      (
        await toolbox.execute(
          { tool: "entries.update", args: { entryId: ENTRY_ID, content: "Updated body" } },
          context(),
        )
      ).ok,
    ).toBe(true);
    expect(mocks.entries.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ENTRY_ID,
      expect.objectContaining({
        version: 1,
        contentHtml: "<p>Updated body</p>",
        excerpt: "Updated body",
      }),
    );
  });

  it("keeps the tripId hand-off for expenses.add and entries.create", async () => {
    const mocks = serviceMocks();
    const toolbox = toolboxWith(mocks);
    const ctx = context();
    ctx.createdTripIds?.push(TRIP_ID);

    expect((await toolbox.execute({ tool: "expenses.add", args: { ...expenseAdd, tripId: undefined } }, ctx)).ok).toBe(
      true,
    );
    expect(mocks.expenses.create.mock.calls[0]?.[2]).toBe(TRIP_ID);

    expect(
      (
        await toolbox.execute(
          { tool: "entries.create", args: { title: "Day one", content: "Hello" } },
          ctx,
        )
      ).ok,
    ).toBe(true);
    expect(mocks.entries.create.mock.calls[0]?.[2]).toBe(TRIP_ID);
  });
});
