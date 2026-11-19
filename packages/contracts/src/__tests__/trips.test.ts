import { describe, expect, it } from "vitest";

import {
  AddTripParticipantRequestSchema,
  CreateParticipantRequestSchema,
  CreateTripRequestSchema,
  PlaceSearchProviderSchema,
  SetTripAccessGrantsRequestSchema,
  TRIP_ACCESS_GRANT_LIMIT,
  TripDestinationInputListSchema,
  TripDestinationInputSchema,
  TripDestinationProviderSchema,
  UpdateParticipantRequestSchema,
  UpdateTripRequestSchema,
} from "../index";

const BASE_CREATE = {
  title: "Kyoto in November",
  startDate: "2026-11-21",
  endDate: "2026-11-29",
};

const FULL_DESTINATION = {
  name: "京都",
  provider: "geoapify",
  providerPlaceId: "51e1bdfea47461405994da8b683bb64140f00103f9",
  address: "京都市, 京都府, 日本",
  country: "日本",
  countryCode: "JP",
  lat: 35.0116,
  lng: 135.7681,
  timeZone: "Asia/Tokyo",
  bbox: [135.6, 34.85, 135.93, 35.17],
};

describe("trip destination request contracts", () => {
  it("keeps destinationsV2 optional so existing callers never break", () => {
    // The regression that matters: a client that does not know the field must
    // still be able to create and update a trip.
    const created = CreateTripRequestSchema.parse(BASE_CREATE);
    expect(created).not.toHaveProperty("destinationsV2");
    expect(created.destinations).toBeUndefined();

    const updated = UpdateTripRequestSchema.parse({
      version: 3,
      destinations: ["京都"],
    });
    expect(updated).not.toHaveProperty("destinationsV2");
  });

  it("accepts a destination that only knows its name", () => {
    const parsed = CreateTripRequestSchema.parse({
      ...BASE_CREATE,
      destinationsV2: [{ name: "金泽" }],
    });
    expect(parsed.destinationsV2).toEqual([{ name: "金泽" }]);
    // Metadata keys are optional; absence is not an error.
    expect(TripDestinationInputSchema.safeParse({ name: "金泽" }).success).toBe(true);
  });

  it("round-trips full place metadata including address, coordinates and timezone", () => {
    const parsed = CreateTripRequestSchema.parse({
      ...BASE_CREATE,
      destinationsV2: [FULL_DESTINATION, { ...FULL_DESTINATION, name: "大阪", lat: 34.6937, lng: 135.5023 }],
    });
    expect(parsed.destinationsV2?.[0]).toEqual(FULL_DESTINATION);
    expect(parsed.destinationsV2?.[1]?.name).toBe("大阪");
  });

  it("accepts explicit nulls but rejects a half coordinate pair", () => {
    expect(
      TripDestinationInputSchema.safeParse({
        name: "金泽",
        provider: null,
        providerPlaceId: null,
        address: null,
        lat: null,
        lng: null,
        timeZone: null,
        bbox: null,
      }).success,
    ).toBe(true);
    expect(TripDestinationInputSchema.safeParse({ name: "金泽", lat: 36.5 }).success).toBe(false);
    expect(TripDestinationInputSchema.safeParse({ name: "金泽", lng: 136.7 }).success).toBe(false);
  });

  it("rejects unknown destination keys and invalid metadata", () => {
    expect(
      TripDestinationInputSchema.safeParse({ name: "金泽", province: "石川県" }).success,
    ).toBe(false);
    expect(
      TripDestinationInputSchema.safeParse({ ...FULL_DESTINATION, provider: "osm" }).success,
    ).toBe(false);
    expect(
      TripDestinationInputSchema.safeParse({ ...FULL_DESTINATION, countryCode: "JPN" }).success,
    ).toBe(false);
    expect(
      TripDestinationInputSchema.safeParse({ ...FULL_DESTINATION, bbox: [1, 2, 3] }).success,
    ).toBe(false);
  });

  it("bounds the group and keeps names unique case-insensitively", () => {
    const many = Array.from({ length: 31 }, (_, index) => ({ name: `city-${index}` }));
    expect(TripDestinationInputListSchema.safeParse(many).success).toBe(false);
    expect(
      TripDestinationInputListSchema.safeParse([{ name: "Kyoto" }, { name: " kyoto " }]).success,
    ).toBe(false);
    expect(TripDestinationInputListSchema.safeParse([]).success).toBe(true);
  });

  it("allows an empty array to clear the group on update", () => {
    const parsed = UpdateTripRequestSchema.parse({ version: 2, destinationsV2: [] });
    expect(parsed.destinationsV2).toEqual([]);
  });

  it("shares the provider value set with the place search", () => {
    expect(TripDestinationProviderSchema.options).toEqual(PlaceSearchProviderSchema.options);
  });
});

describe("trip access grant and participant request contracts (0012)", () => {
  const WORKSPACE_ID = "0192f4c5-6a7b-7c8d-b123-456789abcdef";
  const USER_ID = "0192f4c5-6a7b-7c8d-9e0f-123456789abc";
  const OTHER_ID = "0192f4c5-6a7b-7c8d-9e0f-123456789abd";

  it("requires both arrays when replacing a custom audience", () => {
    // Whole-set replacement: `users` missing must not silently mean "delete
    // every user grant", so both arrays are required even when empty.
    const cleared = SetTripAccessGrantsRequestSchema.parse({ workspaces: [], users: [] });
    expect(cleared).toEqual({ workspaces: [], users: [] });

    expect(SetTripAccessGrantsRequestSchema.safeParse({ workspaces: [] }).success).toBe(false);
    expect(SetTripAccessGrantsRequestSchema.safeParse({ users: [] }).success).toBe(false);
    expect(
      SetTripAccessGrantsRequestSchema.safeParse({
        workspaces: [WORKSPACE_ID],
        users: [USER_ID],
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate and malformed grant targets", () => {
    expect(
      SetTripAccessGrantsRequestSchema.safeParse({
        workspaces: [WORKSPACE_ID, WORKSPACE_ID],
        users: [],
      }).success,
    ).toBe(false);
    expect(
      SetTripAccessGrantsRequestSchema.safeParse({
        workspaces: [],
        users: ["not-a-uuid"],
      }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: TRIP_ACCESS_GRANT_LIMIT + 1 }, (_, index) =>
      `0192f4c5-6a7b-7c8d-9e0f-${String(index).padStart(12, "0")}`,
    );
    expect(
      SetTripAccessGrantsRequestSchema.safeParse({ workspaces: tooMany, users: [] }).success,
    ).toBe(false);
  });

  it("invites by exactly one of userId or email", () => {
    const byId = CreateParticipantRequestSchema.parse({ userId: USER_ID });
    expect(byId.userId).toBe(USER_ID);
    expect(byId.email).toBeUndefined();
    expect(byId.role).toBeUndefined();

    const byEmail = CreateParticipantRequestSchema.parse({
      email: "traveler@example.com",
      role: "editor",
    });
    expect(byEmail.email).toBe("traveler@example.com");
    expect(byEmail.role).toBe("editor");

    expect(CreateParticipantRequestSchema.safeParse({}).success).toBe(false);
    expect(
      CreateParticipantRequestSchema.safeParse({ userId: USER_ID, email: "a@example.com" }).success,
    ).toBe(false);
    expect(CreateParticipantRequestSchema.safeParse({ userId: null }).success).toBe(false);
    expect(CreateParticipantRequestSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(
      CreateParticipantRequestSchema.safeParse({ userId: USER_ID, role: "owner" }).success,
    ).toBe(false);
  });

  it("keeps both participant update fields truly optional", () => {
    // `.optional()` and not `.nullable()`: an existing caller that sends only
    // one field must keep parsing, and an absent field must stay absent.
    const roleOnly = UpdateParticipantRequestSchema.parse({ role: "editor" });
    expect(roleOnly).toEqual({ role: "editor" });
    expect(roleOnly).not.toHaveProperty("status");

    const statusOnly = UpdateParticipantRequestSchema.parse({ status: "declined" });
    expect(statusOnly).toEqual({ status: "declined" });

    expect(UpdateParticipantRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateParticipantRequestSchema.safeParse({ role: null }).success).toBe(false);
    expect(UpdateParticipantRequestSchema.safeParse({ status: "maybe" }).success).toBe(false);
    expect(UpdateParticipantRequestSchema.parse({ role: "viewer", status: "joined" })).toEqual({
      role: "viewer",
      status: "joined",
    });
  });

  it("keeps the pre-0012 add-participant request working", () => {
    expect(AddTripParticipantRequestSchema.parse({ userId: OTHER_ID })).toEqual({
      userId: OTHER_ID,
    });
  });

  it("accepts custom on the trip write requests without forcing it", () => {
    const created = CreateTripRequestSchema.parse({ ...BASE_CREATE, visibility: "custom" });
    expect(created.visibility).toBe("custom");
    // Omitted visibility stays omitted (the server keeps the workspace default).
    expect(CreateTripRequestSchema.parse(BASE_CREATE).visibility).toBeUndefined();
    expect(UpdateTripRequestSchema.parse({ version: 2, visibility: "custom" }).visibility).toBe(
      "custom",
    );
  });
});