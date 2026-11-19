import { describe, expect, it } from "vitest";

import {
  ActivitySchema,
  EntryRevisionSchema,
  ItineraryItemSchema,
  StopSchema,
  TripParticipantSchema,
} from "@roamlog/contracts";

import {
  presentActivity,
  presentItineraryItem,
  presentParticipant,
  presentRevision,
  presentStop,
  presentTrip,
  type PresentParticipantInput,
  type PresentStopInput,
  type PresentTripInput,
} from "../content-presenters.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const STOP_ID = "01942f30-1200-7000-8000-000000000004";

function tripRecord(overrides: Partial<PresentTripInput> = {}): PresentTripInput {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Seoul, slowly",
    summary: "A week of food, trains, and rain.",
    status: "active",
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-18T00:00:00.000Z"),
    coverMediaId: null,
    origin: "Shanghai",
    destinations: ["Seoul"],
    countryCodes: ["KR"],
    tags: ["food"],
    guestNames: [],
    budgetAmountMinor: 900_000,
    budgetCurrency: "KRW",
    visibility: "workspace",
    favorite: false,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-02T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function stopRecord(overrides: Partial<PresentStopInput> = {}): PresentStopInput {
  return {
    id: STOP_ID,
    tripId: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    city: "Seoul",
    country: "South Korea",
    countryCode: "KR",
    lat: 37.5665,
    lng: 126.978,
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-12T00:00:00.000Z"),
    notes: "Stay near Euljiro.",
    order: 0,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("presentTrip", () => {
  it("derives durationDays from the inclusive date span", () => {
    expect(presentTrip(tripRecord()).durationDays).toBe(9);
    expect(
      presentTrip(
        tripRecord({
          startDate: "2026-11-10",
          endDate: "2026-11-10",
        }),
      ).durationDays,
    ).toBe(1);
  });

  it("reports a null cover until a signed cover projection exists", () => {
    const trip = presentTrip(tripRecord());
    expect(trip.cover).toBeNull();
    expect(trip.coverMediaId).toBeNull();
  });

  it("defaults the exact photo location switch to on and passes an explicit off through", () => {
    // Absent column (a row read before 0014, or a stub): the product default is
    // "a shared trip shows where the photo was taken".
    expect(presentTrip(tripRecord()).showExactPhotoLocation).toBe(true);
    expect(presentTrip(tripRecord({ showExactPhotoLocation: null })).showExactPhotoLocation).toBe(
      true,
    );
    expect(
      presentTrip(tripRecord({ showExactPhotoLocation: false })).showExactPhotoLocation,
    ).toBe(false);
  });

  it("defaults unmigrated place metadata to null instead of inventing a location", () => {
    const trip = presentTrip(tripRecord());
    expect(trip.originLat).toBeNull();
    expect(trip.originLng).toBeNull();
    expect(trip.originCountryCode).toBeNull();
    expect(trip.timeZone).toBeNull();
  });

  it("passes migrated place metadata through unchanged", () => {
    const trip = presentTrip(
      tripRecord({
        originLat: 31.2304,
        originLng: 121.4737,
        originCountryCode: "CN",
        timeZone: "Asia/Shanghai",
      }),
    );
    expect(trip.originLat).toBe(31.2304);
    expect(trip.originLng).toBe(121.4737);
    expect(trip.originCountryCode).toBe("CN");
    expect(trip.timeZone).toBe("Asia/Shanghai");
  });

  it("keeps the existing canonical origin fallback", () => {
    expect(presentTrip(tripRecord({ origin: "   " })).origin).toBe("未填写");
  });
});

describe("presentStop", () => {
  it("defaults provider, providerPlaceId, and timeZone to null", () => {
    const stop = presentStop(stopRecord());
    expect(stop.provider).toBeNull();
    expect(stop.providerPlaceId).toBeNull();
    expect(stop.timeZone).toBeNull();
  });

  it("passes migrated place metadata through unchanged", () => {
    const stop = presentStop(
      stopRecord({
        provider: "photon",
        providerPlaceId: "osm:node/123456",
        timeZone: "Asia/Seoul",
      }),
    );
    expect(stop.provider).toBe("photon");
    expect(stop.providerPlaceId).toBe("osm:node/123456");
    expect(stop.timeZone).toBe("Asia/Seoul");
  });

  it("rejects a provider outside the contract enum instead of guessing", () => {
    expect(() => presentStop(stopRecord({ provider: "manual" }))).toThrow();
  });
});

/**
 * `TripParticipantSchema` grew the 0012 columns; the presenter emitted the old
 * five and every participants read started returning 500. These pin the whole
 * field set so a contract addition cannot leave the presenter behind again.
 */
describe("presentParticipant", () => {
  it("emits every field the contract declares", () => {
    const participant = presentParticipant(participantRow());

    expect(TripParticipantSchema.parse(participant)).toEqual(participant);
    expect(Object.keys(participant).sort()).toEqual(
      [
        "id",
        "invitedAt",
        "joinedAt",
        "respondedAt",
        "role",
        "status",
        "tripId",
        "userId",
        "workspaceId",
      ].sort(),
    );
    expect(participant.status).toBe("joined");
    expect(participant.role).toBe("editor");
    expect(participant.respondedAt).toBe("2026-11-10T01:00:00.000Z");
  });

  it("reports invitedAt as the same instant as joinedAt", () => {
    // 0012 redefined the existing instant instead of adding a second timestamp.
    const participant = presentParticipant(participantRow());

    expect(participant.joinedAt).toBe("2026-11-10T00:00:00.000Z");
    expect(participant.invitedAt).toBe(participant.joinedAt);
  });

  it("keeps an invitation nobody has answered yet", () => {
    const participant = presentParticipant(
      participantRow({ status: "invited", role: "viewer", respondedAt: null }),
    );

    expect(participant.status).toBe("invited");
    expect(participant.role).toBe("viewer");
    expect(participant.respondedAt).toBeNull();
  });

  it("falls back to the 0012 backfill for a pre-0012 stub", () => {
    // A hand-built instance (and a row read before the migration) carries no
    // 0012 columns; it must still present as the backfilled `joined`/`viewer`.
    const participant = presentParticipant({
      id: PARTICIPANT_ID,
      workspaceId: WORKSPACE_ID,
      tripId: TRIP_ID,
      userId: USER_ID,
      joinedAt: new Date("2026-11-10T00:00:00.000Z"),
    });

    expect(participant.status).toBe("joined");
    expect(participant.role).toBe("viewer");
    expect(participant.respondedAt).toBeNull();
    expect(participant.invitedAt).toBe(participant.joinedAt);
  });
});

const PARTICIPANT_ID = "01942f30-1200-7000-8000-000000000005";
const REVISION_ID = "01942f30-1200-7000-8000-000000000006";
const ITINERARY_ID = "01942f30-1200-7000-8000-000000000007";
const ACTIVITY_ID = "01942f30-1200-7000-8000-000000000008";
const FUTURE_TIMESTAMP = new Date("2026-11-19T08:00:00.000Z");

function participantRow(overrides: Partial<PresentParticipantInput> = {}): PresentParticipantInput {
  return {
    id: PARTICIPANT_ID,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    userId: USER_ID,
    status: "joined",
    role: "editor",
    joinedAt: new Date("2026-11-10T00:00:00.000Z"),
    respondedAt: new Date("2026-11-10T01:00:00.000Z"),
    ...overrides,
  };
}

function revisionRow() {
  return {
    id: REVISION_ID,
    workspaceId: WORKSPACE_ID,
    entryId: "01942f30-1200-7000-8000-000000000009",
    version: 1,
    title: "First night in Euljiro",
    contentJson: { type: "doc", content: [] },
    contentHtml: "<p>Old copy.</p>",
    editedById: USER_ID,
    createdAt: new Date("2026-11-10T00:00:00.000Z"),
  };
}

function itineraryRow() {
  return {
    id: ITINERARY_ID,
    tripId: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    date: new Date("2026-11-11T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    title: "Gwangjang breakfast",
    type: "food",
    location: "Gwangjang Market",
    notes: "",
    done: false,
    order: 0,
    assigneeId: null,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    deletedAt: null,
  };
}

function activityRow() {
  return {
    id: ACTIVITY_ID,
    workspaceId: WORKSPACE_ID,
    tripId: null,
    actorId: USER_ID,
    verb: "trip.created",
    entityType: "trip",
    entityId: TRIP_ID,
    metadata: { status: "active" },
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
  };
}

/**
 * Regression guards for the remaining trips presenters: every contract schema is
 * `.strict()`, so an additive database column must be ignored by the explicit
 * field list instead of failing validation and turning a read into a 500.
 */
describe("presenter row-shape guards", () => {
  it("presentStop ignores columns the contract does not declare", () => {
    const record = {
      ...stopRecord(),
      someFutureColumn: "x",
      moderatedAt: FUTURE_TIMESTAMP,
    };

    const presented = presentStop(record);

    expect(() => presentStop(record)).not.toThrow();
    expect(StopSchema.parse(presented)).toEqual(presented);
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented).not.toHaveProperty("moderatedAt");
    expect(presented.provider).toBeNull();
    expect(presented.providerPlaceId).toBeNull();
    expect(presented.timeZone).toBeNull();
    expect(presented.address).toBeNull();
    expect(presented.bbox).toBeNull();
    expect(presented.deletedAt).toBeNull();
  });

  it("presentParticipant ignores columns the contract does not declare", () => {
    const record = {
      ...participantRow(),
      someFutureColumn: "x",
      moderatedAt: FUTURE_TIMESTAMP,
    };

    const presented = presentParticipant(record);

    expect(() => presentParticipant(record)).not.toThrow();
    expect(TripParticipantSchema.parse(presented)).toEqual(presented);
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented).not.toHaveProperty("moderatedAt");
    // The declared fields survive the stray column: status/role/invitedAt are
    // the ones the presenter used to drop.
    expect(presented).toMatchObject({
      status: "joined",
      role: "editor",
      invitedAt: presented.joinedAt,
    });
  });

  it("presentRevision ignores columns the contract does not declare", () => {
    const record = {
      ...revisionRow(),
      someFutureColumn: "x",
      moderatedAt: FUTURE_TIMESTAMP,
    };

    const presented = presentRevision(record);

    expect(() => presentRevision(record)).not.toThrow();
    expect(EntryRevisionSchema.parse(presented)).toEqual(presented);
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented).not.toHaveProperty("moderatedAt");
  });

  it("presentItineraryItem ignores columns the contract does not declare", () => {
    const record = {
      ...itineraryRow(),
      someFutureColumn: "x",
      moderatedAt: FUTURE_TIMESTAMP,
    };

    const presented = presentItineraryItem(record);

    expect(() => presentItineraryItem(record)).not.toThrow();
    expect(ItineraryItemSchema.parse(presented)).toEqual(presented);
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented).not.toHaveProperty("moderatedAt");
    expect(presented.startTime).toBeNull();
    expect(presented.endTime).toBeNull();
    expect(presented.assigneeId).toBeNull();
    expect(presented.deletedAt).toBeNull();
  });

  it("presentActivity ignores columns the contract does not declare", () => {
    const record = {
      ...activityRow(),
      someFutureColumn: "x",
      moderatedAt: FUTURE_TIMESTAMP,
    };

    const presented = presentActivity(record);

    expect(() => presentActivity(record)).not.toThrow();
    expect(ActivitySchema.parse(presented)).toEqual(presented);
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented).not.toHaveProperty("moderatedAt");
    expect(presented.tripId).toBeNull();
  });
});
