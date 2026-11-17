import { describe, expect, it } from "vitest";
import {
  buildSeedDataset,
  demoShareTokenHash,
  deterministicId,
  seedAssetFiles,
  type WorkspaceScopedFixture,
} from "../seed-data.js";

const uuidV7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function expectUuidV7(value: string): void {
  expect(value, `${value} must be a lowercase UUIDv7`).toMatch(uuidV7Pattern);
}

function expectWorkspaceScoped(
  rows: readonly WorkspaceScopedFixture[],
  workspaceId: string,
  label: string,
): void {
  for (const row of rows) {
    expect(row.workspaceId, `${label} must be workspace scoped`).toBe(
      workspaceId,
    );
  }
}

describe("deterministic seed data", () => {
  const data = buildSeedDataset();

  it("builds the same shape on every invocation", () => {
    expect(buildSeedDataset()).toEqual(data);
    expect(deterministicId("user", "demo")).toBe(
      deterministicId("user", "demo"),
    );
    expect(deterministicId("user", "demo")).not.toBe(
      deterministicId("user", "editor"),
    );
  });

  it("creates the three named users and exactly one owner in Roamlog Crew", () => {
    expect(data.users).toHaveLength(3);
    expect(data.users.map((user) => user.email)).toEqual([
      "demo@roamlog.local",
      "mei@roamlog.local",
      "jonas@roamlog.local",
    ]);
    expect(data.workspace.name).toBe("Roamlog Crew");
    expect(data.workspace.ownerId).toBe(data.users[0]?.id);
    expect(data.members).toHaveLength(3);
    expect(data.members.filter((member) => member.role === "owner")).toHaveLength(
      1,
    );
    expect(data.members.filter((member) => member.role === "editor")).toHaveLength(
      1,
    );
    expect(data.members.filter((member) => member.role === "viewer")).toHaveLength(
      1,
    );
    expect(
      data.members.find((member) => member.role === "owner")?.userId,
    ).toBe(data.workspace.ownerId);
  });

  it("contains the exact nine trips from the approved seed content", () => {
    expect(data.trips).toHaveLength(9);
    expect(
      data.trips.map((trip) => ({
        title: trip.title,
        countryCodes: trip.countryCodes,
        startDate: trip.startDate,
        endDate: trip.endDate,
        status: trip.status,
      })),
    ).toEqual([
      {
        title: "京都十一月",
        countryCodes: ["JP"],
        startDate: "2026-11-21",
        endDate: "2026-11-29",
        status: "upcoming",
      },
      {
        title: "首尔一周",
        countryCodes: ["KR"],
        startDate: "2026-11-14",
        endDate: "2026-11-20",
        status: "active",
      },
      {
        title: "冰岛环岛",
        countryCodes: ["IS"],
        startDate: "2026-08-02",
        endDate: "2026-08-12",
        status: "completed",
      },
      {
        title: "里斯本慢日",
        countryCodes: ["PT"],
        startDate: "2026-05-10",
        endDate: "2026-05-16",
        status: "completed",
      },
      {
        title: "圣托里尼重启",
        countryCodes: ["GR"],
        startDate: "2025-09-14",
        endDate: "2025-09-20",
        status: "completed",
      },
      {
        title: "东京转机",
        countryCodes: ["JP"],
        startDate: "2025-03-02",
        endDate: "2025-03-05",
        status: "completed",
      },
      {
        title: "马拉喀什与阿特拉斯",
        countryCodes: ["MA"],
        startDate: "2024-10-05",
        endDate: "2024-10-14",
        status: "completed",
      },
      {
        title: "巴塔哥尼亚穿越",
        countryCodes: ["CL", "AR"],
        startDate: "2027-02-10",
        endDate: "2027-02-24",
        status: "wishlist",
      },
      {
        title: "阿马尔菲海岸",
        countryCodes: ["IT"],
        startDate: "2027-05-18",
        endDate: "2027-05-25",
        status: "planning",
      },
    ]);
  });

  it("meets every minimum content count", () => {
    expect(data.entries.length).toBeGreaterThanOrEqual(16);
    expect(data.media.length).toBeGreaterThanOrEqual(24);
    expect(data.itineraryItems.length).toBeGreaterThanOrEqual(30);
    expect(data.expenses.length).toBeGreaterThanOrEqual(20);
    expect(data.packingItems.length).toBeGreaterThanOrEqual(30);
    expect(data.comments.length).toBeGreaterThanOrEqual(8);
    expect(data.activities.length).toBeGreaterThanOrEqual(10);
    expect(data.shareLinks).toHaveLength(1);
    expect(data.notificationPreferences.length).toBeGreaterThanOrEqual(3);
    expect(seedAssetFiles).toHaveLength(8);
    expect(
      new Set(data.media.map((item) => item.assetFileName)).size,
    ).toBe(seedAssetFiles.length);
  });

  it("keeps journal entries realistic, valid Tiptap, and inside trip dates", () => {
    const tripById = new Map(data.trips.map((trip) => [trip.id, trip]));
    for (const entry of data.entries) {
      const trip = tripById.get(entry.tripId);
      expect(trip, `${entry.title} must belong to a seeded trip`).toBeDefined();
      expect(entry.date >= (trip?.startDate ?? "")).toBe(true);
      expect(entry.date <= (trip?.endDate ?? "")).toBe(true);
      expect(entry.title.length).toBeGreaterThan(3);
      expect(entry.excerpt.length).toBeGreaterThan(12);
      expect(entry.contentJson).toMatchObject({
        type: "doc",
        content: expect.any(Array),
      });
      expect(entry.contentHtml).toMatch(/^<p>.*<\/p>$/s);
      expect(entry.contentHtml).not.toMatch(/<script|<iframe|on\w+=/i);
      expect([
        "calm",
        "happy",
        "awe",
        "tired",
        "reflective",
        "excited",
      ]).toContain(entry.mood);
      expect(["sunny", "cloudy", "rain", "snow", "wind", "fog"]).toContain(
        entry.weather,
      );
    }
  });

  it("scopes every business fixture to the demo workspace", () => {
    expectWorkspaceScoped(data.members, data.workspace.id, "member");
    expectWorkspaceScoped(data.trips, data.workspace.id, "trip");
    expectWorkspaceScoped(data.stops, data.workspace.id, "stop");
    expectWorkspaceScoped(data.entries, data.workspace.id, "entry");
    expectWorkspaceScoped(data.revisions, data.workspace.id, "revision");
    expectWorkspaceScoped(data.media, data.workspace.id, "media");
    expectWorkspaceScoped(data.entryMedia, data.workspace.id, "entry media");
    expectWorkspaceScoped(
      data.itineraryItems,
      data.workspace.id,
      "itinerary item",
    );
    expectWorkspaceScoped(data.comments, data.workspace.id, "comment");
    expectWorkspaceScoped(
      data.commentMentions,
      data.workspace.id,
      "comment mention",
    );
    expectWorkspaceScoped(data.activities, data.workspace.id, "activity");
    expectWorkspaceScoped(data.expenses, data.workspace.id, "expense");
    expectWorkspaceScoped(
      data.expenses.flatMap((expense) => expense.participants),
      data.workspace.id,
      "expense participant",
    );
    expectWorkspaceScoped(data.packingItems, data.workspace.id, "packing item");
    expectWorkspaceScoped(data.shareLinks, data.workspace.id, "share link");
    expectWorkspaceScoped(data.tripParticipants, data.workspace.id, "trip participant");
  });

  it("reconciles every expense to the last minor unit", () => {
    for (const expense of data.expenses) {
      const participantTotal = expense.participants.reduce(
        (sum, participant) => sum + participant.shareAmountMinor,
        0,
      );
      expect(participantTotal, expense.note).toBe(expense.amountMinor);
      expect(expense.participants.length).toBeGreaterThan(0);
      expect(
        new Set(expense.participants.map((participant) => participant.userId))
          .size,
      ).toBe(expense.participants.length);
      if (expense.splitMode === "equal") {
        const payerShare = expense.participants.find(
          (participant) => participant.userId === expense.paidById,
        );
        expect(payerShare, `${expense.note} payer must participate`).toBeDefined();
      }
    }
  });

  it("stores only a hash for the public share link", () => {
    const shareLink = data.shareLinks[0];
    expect(shareLink).toBeDefined();
    expect(shareLink).not.toHaveProperty("token");
    expect(shareLink?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(shareLink?.tokenHash).toBe(demoShareTokenHash);
    expect(JSON.stringify(data)).not.toContain("roamlog-demo-share-2026-kyoto");
  });

  it("uses valid deterministic UUIDv7 IDs throughout", () => {
    const ids = [
      ...data.users.map((row) => row.id),
      ...data.members.map((row) => row.id),
      data.workspace.id,
      ...data.trips.map((row) => row.id),
      ...data.tripParticipants.map((row) => row.id),
      ...data.stops.map((row) => row.id),
      ...data.entries.map((row) => row.id),
      ...data.revisions.map((row) => row.id),
      ...data.media.map((row) => row.id),
      ...data.itineraryItems.map((row) => row.id),
      ...data.comments.map((row) => row.id),
      ...data.activities.map((row) => row.id),
      ...data.expenses.map((row) => row.id),
      ...data.packingItems.map((row) => row.id),
      ...data.shareLinks.map((row) => row.id),
      ...data.notifications.map((row) => row.id),
      ...data.auditLogs.map((row) => row.id),
      ...data.emailLogs.map((row) => row.id),
      ...data.exports.map((row) => row.id),
    ];
    expect(ids.length).toBeGreaterThan(100);
    for (const id of ids) {
      expectUuidV7(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
