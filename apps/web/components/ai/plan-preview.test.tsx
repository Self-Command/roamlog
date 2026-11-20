import type { AiToolCall, AiToolName } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import {
  buildPlanReview,
  countTripDays,
  isPlaceholderTripId,
  normalizeSelection,
} from "./plan-preview";

const TRIP_ID = "018f0a00-0000-7000-8000-0000000000b1";
const STOP_ID = "018f0a00-0000-7000-8000-0000000000c1";

function call(tool: AiToolName, args: Record<string, unknown> = {}): AiToolCall {
  return { tool, args } as AiToolCall;
}

const TRIP_CREATE = call("trips.create", {
  title: "京都一周：古寺与咖啡馆",
  startDate: "2027-04-05",
  endDate: "2027-04-11",
  destinations: ["京都", "大阪"],
  budgetAmountMinor: 800000,
  budgetCurrency: "CNY",
});

describe("buildPlanReview", () => {
  it("maps all 26 tools into their bucket and action", () => {
    const expected: Array<[AiToolName, string, string]> = [
      ["places.search", "orphan", "change"],
      ["trips.create", "trip", "add"],
      ["trips.get", "orphan", "change"],
      ["trips.list", "orphan", "change"],
      ["trips.update", "trip", "change"],
      ["stops.add", "stops", "add"],
      ["stops.list", "orphan", "change"],
      ["stops.update", "stops", "change"],
      ["stops.delete", "stops", "remove"],
      ["stops.reorder", "stops", "change"],
      ["itinerary.addDay", "itinerary", "add"],
      ["itinerary.update", "itinerary", "change"],
      ["itinerary.delete", "itinerary", "remove"],
      ["packing.add", "packing", "add"],
      ["packing.update", "packing", "change"],
      ["packing.delete", "packing", "remove"],
      ["packing.reorder", "packing", "change"],
      ["budget.setSummary", "budget", "change"],
      ["expenses.add", "expenses", "add"],
      ["expenses.update", "expenses", "change"],
      ["expenses.delete", "expenses", "remove"],
      ["entries.create", "entries", "add"],
      ["entries.update", "entries", "change"],
      ["participants.add", "participants", "add"],
      ["participants.remove", "participants", "remove"],
      ["participants.role", "participants", "change"],
    ];

    for (const [tool, bucket, action] of expected) {
      const review = buildPlanReview([call(tool, { tripId: TRIP_ID, stopId: STOP_ID, itemId: STOP_ID, expenseId: STOP_ID, entryId: STOP_ID, memberId: STOP_ID, providerPlaceId: "N:1" })]);
      const rows = review.groups.flatMap((group) => group.rows);
      expect(rows, tool).toHaveLength(1);
      expect(rows[0]?.tool, tool).toBe(tool);
      expect(rows[0]?.action, tool).toBe(action);
      expect(rows[0]?.bucket, tool).toBe(bucket);
    }
  });

  it("summarises the created trip and groups three packing rows", () => {
    const review = buildPlanReview([
      TRIP_CREATE,
      call("packing.add", { tripId: TRIP_ID, name: "护照" }),
      call("packing.add", { tripId: TRIP_ID, name: "充电器" }),
      call("packing.add", { tripId: TRIP_ID, name: "雨伞" }),
    ]);

    expect(review.empty).toBe(false);
    expect(review.headerTitle).toBe("京都一周：古寺与咖啡馆");
    expect(review.trip).toMatchObject({
      title: "京都一周：古寺与咖啡馆",
      days: 7,
      destinations: "京都、大阪",
      budget: "¥8,000.00",
    });
    const packing = review.groups.find((group) => group.bucket === "packing");
    expect(packing?.rows).toHaveLength(3);
    expect(packing?.counts).toEqual({ add: 3, change: 0, remove: 0 });
    expect(packing?.title).toBe("打包清单");
    // An additive row never renders the From/To comparison.
    expect(packing?.rows.every((row) => row.mode === "add" && row.from.length === 0)).toBe(true);
  });

  it("omits the day count when a date is missing", () => {
    const review = buildPlanReview([
      call("trips.create", { title: "只有开始日期", startDate: "2027-04-05" }),
    ]);
    expect(review.trip?.days).toBeUndefined();
    expect(review.trip?.dateRange).toBe("从 2027-04-05 开始");
    expect(countTripDays("2027-04-05", "2027-04-11")).toBe(7);
    expect(countTripDays(undefined, "2027-04-11")).toBeUndefined();
    expect(countTripDays("not-a-date", "2027-04-11")).toBeUndefined();
  });

  it("builds the summary for an update-only plan, including the budget call", () => {
    const review = buildPlanReview([
      call("trips.update", {
        tripId: TRIP_ID,
        title: "京都七日",
        startDate: "2027-04-05",
        endDate: "2027-04-11",
      }),
      call("budget.setSummary", { tripId: TRIP_ID, amountMinor: 2000000, currency: "JPY" }),
    ]);
    expect(review.trip).toEqual({
      title: "京都七日",
      dateRange: "2027-04-05 → 2027-04-11",
      days: 7,
      budget: "JP¥2,000,000",
    });
  });

  it("keeps two trip blocks and moves placeholder calls to the orphan group", () => {
    const review = buildPlanReview([
      call("trips.create", { title: "第一个" }),
      call("trips.create", { title: "第二个" }),
      call("stops.add", { tripId: "{{createTripId}}", providerPlaceId: "N:1" }),
    ]);

    expect(review.groups.find((group) => group.bucket === "trip")?.rows).toHaveLength(2);
    expect(review.groups.find((group) => group.bucket === "stops")).toBeUndefined();
    const orphan = review.groups.find((group) => group.bucket === "orphan");
    expect(orphan?.rows).toHaveLength(1);
    expect(orphan?.rows[0]?.note).toMatch(/无法判断/);
    expect(review.orphanCount).toBe(1);
  });

  it("moves placeholder writes to the orphan group when no trip is created", () => {
    const review = buildPlanReview([
      call("stops.add", { tripId: "new", providerPlaceId: "N:1" }),
      call("itinerary.addDay", { tripId: "", date: "2027-04-05", items: [{ title: "清水寺" }] }),
    ]);
    const orphan = review.groups.find((group) => group.bucket === "orphan");
    expect(orphan?.rows).toHaveLength(2);
    expect(orphan?.rows[0]?.note).toMatch(/没有创建旅行/);
  });

  it("flags destructive plans and counts removals", () => {
    const review = buildPlanReview([
      call("stops.delete", { stopId: STOP_ID }),
      call("expenses.delete", { expenseId: STOP_ID }),
    ]);
    expect(review.hasDestructive).toBe(true);
    expect(review.summary.remove).toBe(2);
    expect(review.groups).toHaveLength(2);
  });

  it("does not throw on missing or non-object arguments", () => {
    const broken = { tool: "packing.update", args: null } as unknown as AiToolCall;
    const review = buildPlanReview([broken]);
    expect(review.groups).toHaveLength(1);
    expect(review.groups[0]?.rows[0]?.headline.length).toBeGreaterThan(0);
  });

  it("returns the empty state for no calls and never renders an empty group", () => {
    const review = buildPlanReview([]);
    expect(review.empty).toBe(true);
    expect(review.groups).toHaveLength(0);
    expect(review.summary.total).toBe(0);
  });

  it("formats JPY with zero fraction digits", () => {
    const review = buildPlanReview([
      call("expenses.add", {
        tripId: TRIP_ID,
        date: "2027-04-05",
        category: "food",
        amountMinor: 1200,
        currency: "JPY",
        paidByMemberId: STOP_ID,
        splitMode: "equal",
        participants: [{ memberId: STOP_ID }],
      }),
    ]);
    expect(review.groups[0]?.rows[0]?.headline).toBe("JP¥1,200");
  });

  it("keeps rows addressable by their original call index", () => {
    const calls = [
      call("trips.create", { title: "体验" }),
      call("packing.add", { tripId: TRIP_ID, name: "护照" }),
      call("stops.delete", { stopId: STOP_ID }),
    ];
    const review = buildPlanReview(calls);
    const rows = review.groups.flatMap((group) => group.rows);
    expect(rows.map((row) => row.callIndex)).toEqual([0, 2, 1]);
    const delivered = rows.filter((row) => [0, 2].includes(row.callIndex));
    expect(delivered.map((row) => row.tool)).toEqual(["trips.create", "stops.delete"]);
  });

  it("uses subjects for the target name instead of an opaque id", () => {
    const subjects = { [STOP_ID]: { label: "清水寺" } };
    const review = buildPlanReview(
      [
        call("stops.delete", { stopId: STOP_ID }),
        call("stops.update", { tripId: TRIP_ID, stopId: STOP_ID, city: "东山区" }),
      ],
      subjects,
    );
    const rows = review.groups.flatMap((group) => group.rows);
    expect(rows[0]?.headline).toBe("清水寺");
    expect(rows[0]?.mode).toBe("remove");
    expect(rows[1]?.headline).toBe("清水寺");
    expect(rows[1]?.from).toEqual(["清水寺"]);
    expect(rows[1]?.to).toContain("东山区");
  });

  it("opens destructive and orphan groups but folds a plain packing list", () => {
    const review = buildPlanReview([
      call("trips.create", { title: "折叠" }),
      call("packing.add", { tripId: TRIP_ID, name: "护照" }),
      call("stops.delete", { stopId: STOP_ID }),
    ]);
    expect(review.groups.find((group) => group.bucket === "packing")?.defaultOpen).toBe(false);
    expect(review.groups.find((group) => group.bucket === "stops")?.defaultOpen).toBe(true);
    expect(review.groups.find((group) => group.bucket === "trip")?.defaultOpen).toBe(true);
  });
});

describe("normalizeSelection", () => {
  it("drops placeholder writes when the single trip creation is unchecked", () => {
    const calls = [
      call("trips.create", { title: "新旅行" }),
      call("packing.add", { tripId: "new", name: "护照" }),
      call("stops.add", { tripId: TRIP_ID, providerPlaceId: "N:1" }),
    ];
    const next = normalizeSelection(calls, [false, true, true]);
    expect(next).toEqual([false, false, true]);
  });

  it("leaves the selection alone while the creation stays selected", () => {
    const calls = [
      call("trips.create", { title: "新旅行" }),
      call("packing.add", { tripId: "new", name: "护照" }),
    ];
    expect(normalizeSelection(calls, [true, true])).toEqual([true, true]);
  });

  it("does not guess when two trip creations are planned", () => {
    const calls = [
      call("trips.create", { title: "一" }),
      call("trips.create", { title: "二" }),
      call("packing.add", { tripId: "new", name: "护照" }),
    ];
    expect(normalizeSelection(calls, [false, false, true])).toEqual([false, false, true]);
  });
});

describe("isPlaceholderTripId", () => {
  it("matches the server's UUIDv7 rule", () => {
    expect(isPlaceholderTripId(undefined)).toBe(true);
    expect(isPlaceholderTripId("")).toBe(true);
    expect(isPlaceholderTripId("new")).toBe(true);
    expect(isPlaceholderTripId(TRIP_ID)).toBe(false);
  });
});