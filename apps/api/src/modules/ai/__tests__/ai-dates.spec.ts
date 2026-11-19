import { describe, expect, it } from "vitest";

import { findPastDateIssue, formatDateOnly, shiftDateOnly } from "../ai-dates.js";

/**
 * Date-only rules the planner enforces before queueing a write call. Everything
 * here is pure string math on `YYYY-MM-DD`, so no offset can shift a day.
 */
describe("AI planner dates", () => {
  it("formats today in the given timezone instead of UTC", () => {
    const now = new Date("2026-11-18T17:00:00.000Z");
    expect(formatDateOnly(now, "Asia/Shanghai")).toBe("2026-11-19");
    expect(formatDateOnly(now, "UTC")).toBe("2026-11-18");
  });

  it("tolerates one day of timezone skew but rejects anything older", () => {
    const today = "2026-11-19";
    // "Yesterday" is still accepted: the user's zone may be ahead of the host.
    expect(findPastDateIssue("trips.create", { startDate: "2026-11-18" }, today)).toBeNull();
    expect(findPastDateIssue("trips.create", { startDate: "2026-11-19" }, today)).toBeNull();
    expect(findPastDateIssue("trips.create", { startDate: "2026-11-17" }, today)).toEqual({
      field: "startDate",
      value: "2026-11-17",
      earliest: "2026-11-18",
    });
  });

  it("checks endDate and itinerary dates on the tools that accept them", () => {
    expect(
      findPastDateIssue(
        "trips.create",
        { startDate: "2026-12-01", endDate: "2019-12-07" },
        "2026-11-19",
      ),
    ).toMatchObject({ field: "endDate" });
    expect(
      findPastDateIssue(
        "itinerary.addDay",
        { date: "2022-04-05", items: [{ title: "Temple" }] },
        "2026-11-19",
      ),
    ).toMatchObject({ field: "date" });
    expect(findPastDateIssue("packing.add", { name: "Passport" }, "2026-11-19")).toBeNull();
    expect(findPastDateIssue("places.search", { q: "Kyoto" }, "2026-11-19")).toBeNull();
  });

  it("leaves malformed or missing dates to the tool argument schema", () => {
    expect(findPastDateIssue("trips.create", { startDate: "2020/04/05" }, "2026-11-19")).toBeNull();
    expect(findPastDateIssue("trips.create", { startDate: 20_200_405 }, "2026-11-19")).toBeNull();
    expect(findPastDateIssue("trips.create", {}, "2026-11-19")).toBeNull();
  });

  it("shifts across month and year boundaries", () => {
    expect(shiftDateOnly("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateOnly("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDateOnly("2024-03-01", -1)).toBe("2024-02-29");
  });
});