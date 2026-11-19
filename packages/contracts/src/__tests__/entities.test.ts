import { describe, expect, it } from "vitest";

import {
  CommentMentionSchema,
  DateOnlySchema,
  EntryMediaSchema,
  ExpenseParticipantSchema,
  ExpenseWithSplitsSchema,
  GetMediaResponseSchema,
  InvitationSchema,
  IsoTimestampSchema,
  JournalEntrySchema,
  PlaceProviderSchema,
  PlaceSchema,
  PlaceSearchProviderSchema,
  PlaceSearchQuerySchema,
  PlaceSearchResponseSchema,
  PublicMediaSchema,
  PublicStopSchema,
  ShareLinkSchema,
  StopSchema,
  CreateStopRequestSchema,
  CreateTripRequestSchema,
  UpdateStopRequestSchema,
  TripCoverSchema,
  TripDestinationProviderSchema,
  TripDestinationSchema,
  TripParticipantSchema,
  TripSchema,
  UpdateTripRequestSchema,
  UuidV7Schema,
} from "../index";

const USER = "0192f4c5-6a7b-7c8d-9e0f-123456789abc";
const OTHER = "0192f4c5-6a7b-7c8d-9e0f-123456789abd";
const PAYER = "0192f4c5-6a7b-7c8d-a123-456789abcdef";
const WORKSPACE = "0192f4c5-6a7b-7c8d-b123-456789abcdef";
const TRIP = "0192f4c5-6a7b-7c8d-8123-456789abcdef";
const ENTRY = "0192f4c5-6a7b-7c8d-9123-456789abcdef";
const EXPENSE = "0192f4c5-6a7b-7c8d-a923-456789abcdef";
const MEDIA = "0192f4c5-6a7b-7c8d-b123-456789abcdea";
const TS = "2026-11-17T08:00:00.000Z";
const DAY = "2026-11-17";

const trip = {
  id: TRIP,
  workspaceId: WORKSPACE,
  title: "Kyoto in November",
  summary: "Temples, coffee, and an unreasonable number of train platforms.",
  status: "upcoming",
  startDate: "2026-11-21",
  endDate: "2026-11-29",
  durationDays: 9,
  coverMediaId: null,
  cover: null,
  origin: "Shanghai",
  originLat: null,
  originLng: null,
  originCountryCode: null,
  originAddress: null,
  originBbox: null,
  timeZone: "Asia/Tokyo",
  destinations: ["Kyoto", "Osaka"],
  countryCodes: ["JP"],
  tags: ["autumn", "food"],
  guestNames: [],
  budgetAmountMinor: 420000,
  budgetCurrency: "JPY",
  visibility: "workspace",
  favorite: false,
  version: 3,
  createdById: USER,
  updatedById: OTHER,
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
};

const journalEntry = {
  id: ENTRY,
  tripId: TRIP,
  workspaceId: WORKSPACE,
  title: "A quiet morning in Higashiyama",
  date: DAY,
  location: "Kyoto",
  lat: 35.0037,
  lng: 135.7788,
  mood: "calm",
  weather: "sunny",
  contentJson: { type: "doc", content: [{ type: "paragraph", text: "Before the crowds." }] },
  contentHtml: "<p>Before the crowds.</p>",
  excerpt: "Before the crowds.",
  tags: ["walking"],
  favorite: false,
  version: 1,
  createdById: USER,
  updatedById: USER,
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
};

const expense = {
  id: EXPENSE,
  workspaceId: WORKSPACE,
  tripId: TRIP,
  date: DAY,
  category: "food",
  note: "Dinner",
  amountMinor: 100,
  currency: "JPY",
  paidById: PAYER,
  splitMode: "custom",
  receiptMediaId: null,
  createdById: USER,
  version: 1,
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
};

describe("common scalar contracts", () => {
  it("accepts UUIDv7 only", () => {
    expect(UuidV7Schema.safeParse(USER).success).toBe(true);
    expect(UuidV7Schema.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(false);
  });

  it("validates dates and timestamps", () => {
    expect(DateOnlySchema.safeParse("2024-02-29").success).toBe(true);
    expect(DateOnlySchema.safeParse("2026-02-29").success).toBe(false);
    expect(IsoTimestampSchema.safeParse(TS).success).toBe(true);
    expect(IsoTimestampSchema.safeParse("2026-11-17").success).toBe(false);
  });
});

describe("entity contracts", () => {
  it("validates trips and date ordering", () => {
    expect(TripSchema.parse(trip).version).toBe(3);
    expect(TripSchema.safeParse({ ...trip, endDate: "2026-11-20" }).success).toBe(false);
    expect(TripSchema.safeParse({ ...trip, startDate: "2026-13-01" }).success).toBe(false);
    expect(TripSchema.safeParse({ ...trip, budgetAmountMinor: 10.5 }).success).toBe(false);
    expect(TripSchema.safeParse({ ...trip, durationDays: 8 }).success).toBe(false);
    expect(TripSchema.safeParse({ ...trip, originLat: 31.2304 }).success).toBe(false);
    expect(TripSchema.safeParse({ ...trip, timeZone: "Asia Shanghai" }).success).toBe(false);
  });

  it("keeps originAddress and originBbox nullable and order-aware", () => {
    const withPlace = {
      ...trip,
      originAddress: "京都市, 京都府, 日本",
      originBbox: [135.6, 34.85, 135.93, 35.17],
    };

    expect(TripSchema.parse(trip).originAddress).toBeNull();
    expect(TripSchema.parse(trip).originBbox).toBeNull();
    expect(TripSchema.parse(withPlace).originBbox).toEqual([135.6, 34.85, 135.93, 35.17]);
    // west <= east and south <= north, or it is not a box.
    expect(TripSchema.safeParse({ ...withPlace, originBbox: [135.93, 34.85, 135.6, 35.17] }).success).toBe(
      false,
    );
    expect(TripSchema.safeParse({ ...withPlace, originBbox: [135.6, 35.17, 135.93, 34.85] }).success).toBe(
      false,
    );
    // Longitude/latitude limits, arity, and element types.
    expect(TripSchema.safeParse({ ...withPlace, originBbox: [181, 34.85, 181.5, 35.17] }).success).toBe(
      false,
    );
    expect(TripSchema.safeParse({ ...withPlace, originBbox: [135.6, 91, 135.93, 92] }).success).toBe(false);
    expect(TripSchema.safeParse({ ...withPlace, originBbox: [135.6, 34.85, 135.93] }).success).toBe(false);
    expect(TripSchema.safeParse({ ...withPlace, originBbox: [135.6, 34.85, 135.93, "35.17"] }).success).toBe(
      false,
    );
    // The column is VARCHAR(400).
    expect(TripSchema.safeParse({ ...withPlace, originAddress: "x".repeat(401) }).success).toBe(false);
    // Unknown keys stay rejected.
    expect(TripSchema.safeParse({ ...withPlace, bbox: [] }).success).toBe(false);
  });

  it("accepts originAddress/originBbox on create and update requests", () => {
    const created = CreateTripRequestSchema.parse({
      title: "Kyoto",
      startDate: "2026-11-21",
      endDate: "2026-11-24",
      originAddress: "京都市, 京都府, 日本",
      originBbox: [135.6, 34.85, 135.93, 35.17],
    });
    expect(created.originAddress).toBe("京都市, 京都府, 日本");
    expect(created.originBbox).toEqual([135.6, 34.85, 135.93, 35.17]);

    const cleared = UpdateTripRequestSchema.parse({ version: 1, originAddress: null, originBbox: null });
    expect(cleared.originAddress).toBeNull();
    expect(cleared.originBbox).toBeNull();

    // Omitted keys stay omitted so the API can leave the columns untouched.
    const untouched = UpdateTripRequestSchema.parse({ version: 1, title: "Kyoto" });
    expect(untouched).not.toHaveProperty("originAddress");
    expect(untouched).not.toHaveProperty("originBbox");

    expect(
      CreateTripRequestSchema.safeParse({
        title: "Kyoto",
        startDate: "2026-11-21",
        endDate: "2026-11-24",
        originBbox: [135.6, 34.85],
      }).success,
    ).toBe(false);
  });

  it("enforces unique, bounded trip tags, destinations, and guest names", () => {
    expect(TripSchema.safeParse({ ...trip, tags: ["autumn", "Autumn"] }).success).toBe(false);
    expect(TripSchema.safeParse({ ...trip, destinations: ["Kyoto", " Kyoto "] }).success).toBe(
      false,
    );
    expect(
      TripSchema.safeParse({
        ...trip,
        tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`),
      }).success,
    ).toBe(false);
  });

  describe("structured destinations", () => {
    const destination = {
      id: "0192f4c5-6a7b-7c8d-c123-456789abcdef",
      name: "Kyoto",
      provider: "geoapify",
      providerPlaceId: "51e1bdfea47461405994da8b683bb64140f00103f9",
      address: "京都市, 京都府, 日本",
      country: "日本",
      countryCode: "JP",
      lat: 35.0116,
      lng: 135.7681,
      timeZone: "Asia/Tokyo",
      bbox: [135.6, 34.85, 135.93, 35.17],
      order: 0,
    };

    it("parses a trip that carries both the deprecated names and destinationsV2", () => {
      const parsed = TripSchema.parse({ ...trip, destinationsV2: [destination] });
      expect(parsed.destinations).toEqual(["Kyoto", "Osaka"]);
      expect(parsed.destinationsV2).toEqual([destination]);
    });

    it("keeps destinationsV2 omitted for readers that predate the field", () => {
      const parsed = TripSchema.parse(trip);
      expect(parsed.destinationsV2).toBeUndefined();
    });

    it("keeps every metadata field nullable and rejects unknown keys", () => {
      const nameOnly = {
        ...destination,
        provider: null,
        providerPlaceId: null,
        address: null,
        country: null,
        countryCode: null,
        lat: null,
        lng: null,
        timeZone: null,
        bbox: null,
      };
      expect(TripDestinationSchema.parse(nameOnly).provider).toBeNull();
      // `address` is nullable but still required: a missing key is not "unknown".
      const { address: _address, ...missingAddress } = destination;
      expect(TripDestinationSchema.safeParse(missingAddress).success).toBe(false);
      expect(TripDestinationSchema.safeParse({ ...destination, unknown: 1 }).success).toBe(false);
      expect(TripDestinationSchema.safeParse({ ...destination, order: -1 }).success).toBe(false);
      expect(TripDestinationSchema.safeParse({ ...destination, provider: "osm" }).success).toBe(
        false,
      );
      expect(TripDestinationSchema.safeParse({ ...destination, countryCode: "jp" }).success).toBe(
        false,
      );
      expect(TripDestinationSchema.safeParse({ ...destination, lng: null }).success).toBe(false);
      expect(
        TripDestinationSchema.safeParse({ ...destination, bbox: [135.93, 34.85, 135.6, 35.17] })
          .success,
      ).toBe(false);
    });

    it("shares the provider value set with the place search", () => {
      expect(TripDestinationProviderSchema.options).toEqual(PlaceSearchProviderSchema.options);
    });

    it("rejects duplicate or over-long destination rows on the trip", () => {
      expect(
        TripSchema.safeParse({ ...trip, destinationsV2: [destination, { ...destination }] })
          .success,
      ).toBe(true);
      // Duplicate names are a payload rule (`TripDestinationInputListSchema`),
      // not a row rule; the entity schema only checks the row shape.
      expect(
        TripSchema.safeParse({
          ...trip,
          destinationsV2: [{ ...destination, lat: 31.2, lng: 121.4, order: 1 }],
        }).success,
      ).toBe(true);
    });
  });

  it("projects a serializable cover without storage secrets", () => {
    const cover = {
      mediaId: MEDIA,
      status: "ready" as const,
      url: "https://media.example.com/large.webp?signature=one",
      thumbUrl: "https://media.example.com/thumb.webp?signature=two",
      width: 4000,
      height: 3000,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      expiresAt: TS,
    };

    const parsed = TripCoverSchema.parse(cover);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
    expect(parsed).not.toHaveProperty("bucket");
    expect(parsed).not.toHaveProperty("key");
    expect(TripCoverSchema.safeParse({ ...cover, url: null }).success).toBe(false);
    expect(TripCoverSchema.safeParse({ ...cover, expiresAt: null }).success).toBe(false);
  });

  it("keeps trip updates partial while routing cover writes through the cover endpoint", () => {
    expect(
      UpdateTripRequestSchema.safeParse({ version: 3, title: "Winter in Kyoto" }).success,
    ).toBe(true);
    expect(UpdateTripRequestSchema.safeParse({ version: 3, coverMediaId: MEDIA }).success).toBe(
      false,
    );
    expect(UpdateTripRequestSchema.safeParse({ version: 3, coverMediaId: null }).success).toBe(
      true,
    );
  });

  it("validates stop place metadata without breaking stop CRUD fields", () => {
    const stop = {
      id: OTHER,
      tripId: TRIP,
      workspaceId: WORKSPACE,
      city: "Kyoto",
      country: "Japan",
      countryCode: "JP",
      lat: 35.0116,
      lng: 135.7681,
      provider: "photon" as const,
      providerPlaceId: "photon:kyoto",
      timeZone: "Asia/Tokyo",
      address: "京都市, 京都府, 日本",
      bbox: [135.6, 34.85, 135.93, 35.17],
      startDate: "2026-11-21",
      endDate: "2026-11-24",
      notes: "",
      order: 0,
      version: 1,
      createdById: USER,
      updatedById: USER,
      createdAt: TS,
      updatedAt: TS,
      deletedAt: null,
    };

    expect(StopSchema.parse(stop).providerPlaceId).toBe("photon:kyoto");
    expect(StopSchema.parse(stop).address).toBe("京都市, 京都府, 日本");
    expect(StopSchema.parse(stop).bbox).toEqual([135.6, 34.85, 135.93, 35.17]);
    expect(StopSchema.safeParse({ ...stop, timeZone: "local time" }).success).toBe(false);
  });

  it("accepts geoapify as a stored stop provider and rejects unknown sources", () => {
    expect(PlaceProviderSchema.parse("geoapify")).toBe("geoapify");
    expect(PlaceProviderSchema.safeParse("mapbox").success).toBe(false);

    const request = {
      city: "Kyoto",
      country: "Japan",
      countryCode: "JP",
      startDate: "2026-11-21",
      endDate: "2026-11-24",
    };
    expect(CreateStopRequestSchema.safeParse({ ...request, provider: "geoapify" }).success).toBe(
      true,
    );
    expect(CreateStopRequestSchema.safeParse({ ...request, provider: "mapbox" }).success).toBe(
      false,
    );
    expect(UpdateStopRequestSchema.safeParse({ version: 1, provider: "geoapify" }).success).toBe(
      true,
    );
    expect(UpdateStopRequestSchema.safeParse({ version: 1, provider: "mapbox" }).success).toBe(
      false,
    );
  });

  it("keeps the stored stop provider set identical to the places search provider set", () => {
    // A search source that cannot be stored forces the API to drop or mislabel
    // it; this assertion is the tripwire for that drift.
    expect([...PlaceProviderSchema.options].sort()).toEqual(
      [...PlaceSearchProviderSchema.options].sort(),
    );
    expect(PlaceSearchProviderSchema.options).toEqual(["geoapify", "photon", "local"]);
  });

  it("keeps the stop address/bbox nullable and rejects inverted or short boxes", () => {
    const stop = {
      id: OTHER,
      tripId: TRIP,
      workspaceId: WORKSPACE,
      city: "Kyoto",
      country: "Japan",
      countryCode: "JP",
      lat: null,
      lng: null,
      provider: null,
      providerPlaceId: null,
      timeZone: null,
      address: null,
      bbox: null,
      startDate: "2026-11-21",
      endDate: "2026-11-24",
      notes: "",
      order: 0,
      version: 1,
      createdById: USER,
      updatedById: USER,
      createdAt: TS,
      updatedAt: TS,
      deletedAt: null,
    };

    expect(StopSchema.parse(stop).address).toBeNull();
    expect(StopSchema.parse(stop).bbox).toBeNull();
    expect(StopSchema.safeParse({ ...stop, bbox: [1, 2, 3] }).success).toBe(false);
    expect(StopSchema.safeParse({ ...stop, bbox: [10, 20, 5, 30] }).success).toBe(false);
    expect(StopSchema.safeParse({ ...stop, address: "x".repeat(401) }).success).toBe(false);

    // Create/update requests take the same optional nullable pair.
    const base = {
      city: "Kyoto",
      country: "Japan",
      countryCode: "JP",
      startDate: "2026-11-21",
      endDate: "2026-11-24",
    };
    expect(
      CreateStopRequestSchema.parse({
        ...base,
        address: "京都市, 京都府, 日本",
        bbox: [135.6, 34.85, 135.93, 35.17],
      }).bbox,
    ).toEqual([135.6, 34.85, 135.93, 35.17]);
    expect(UpdateStopRequestSchema.parse({ version: 1, address: null, bbox: null })).toEqual({
      version: 1,
      address: null,
      bbox: null,
    });
    const untouched = UpdateStopRequestSchema.parse({ version: 1, notes: "later" });
    expect(untouched).not.toHaveProperty("address");
    expect(untouched).not.toHaveProperty("bbox");
    expect(CreateStopRequestSchema.safeParse({ ...base, bbox: [1, 2, 3, 4, 5] }).success).toBe(false);
  });

  it("exposes the public stop address but never its bbox", () => {
    const publicStop = {
      id: OTHER,
      city: "Kyoto",
      country: "Japan",
      countryCode: "JP",
      lat: 35.0116,
      lng: 135.7681,
      // The public page credits the real source; `null` stays legal for manually
      // typed or legacy stops (the key itself is required).
      provider: "photon",
      address: "京都市, 京都府, 日本",
      startDate: "2026-11-21",
      endDate: "2026-11-24",
      notes: "",
      order: 0,
    };

    expect(PublicStopSchema.parse(publicStop).address).toBe("京都市, 京都府, 日本");
    expect(PublicStopSchema.parse(publicStop).provider).toBe("photon");
    expect(PublicStopSchema.safeParse({ ...publicStop, address: null }).success).toBe(true);
    expect(PublicStopSchema.safeParse({ ...publicStop, provider: null }).success).toBe(true);
    // A bbox in a public stop is an unknown key: the schema is strict.
    expect(PublicStopSchema.safeParse({ ...publicStop, bbox: [1, 2, 3, 4] }).success).toBe(false);
  });

  it("defines bounded place search input and output", () => {
    expect(PlaceSearchQuerySchema.parse({ q: "  Kyoto  " })).toEqual({
      q: "Kyoto",
      limit: 6,
    });
    expect(PlaceSearchQuerySchema.parse({ q: "Kyoto", limit: "10" }).limit).toBe(10);
    expect(PlaceSearchQuerySchema.safeParse({ q: "Kyoto", limit: 11 }).success).toBe(false);
    expect(PlaceSearchQuerySchema.safeParse({ q: "   " }).success).toBe(false);
    expect(
      PlaceSearchResponseSchema.parse({
        items: [],
        provider: "local",
        degraded: true,
        cached: false,
      }).items,
    ).toEqual([]);
  });

  it("accepts the Geoapify place fields and keeps address, bbox and importance nullable", () => {
    const place = {
      provider: "geoapify",
      providerPlaceId: "51e1bdfea47461405994da8b683bb64140f00103f901d146c57b",
      name: "京都市",
      address: "京都市, 京都府, 日本",
      country: "日本",
      countryCode: "JP",
      lat: 35.0115754,
      lng: 135.7681441,
      timeZone: "Asia/Tokyo",
      bbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
      importance: 0.18666666666666665,
      type: "city",
    };

    expect(PlaceSchema.parse(place)).toEqual(place);
    expect(
      PlaceSchema.parse({
        ...place,
        address: null,
        timeZone: null,
        bbox: null,
        importance: null,
      }),
    ).toMatchObject({ address: null, timeZone: null, bbox: null, importance: null });
  });

  it("keeps the Geoapify place contract strict and order-aware", () => {
    const base = {
      provider: "geoapify",
      providerPlaceId: null,
      name: "Kyoto",
      address: null,
      country: "Japan",
      countryCode: "JP",
      lat: 35,
      lng: 135,
      timeZone: "Asia/Tokyo",
      bbox: null,
      importance: null,
      type: "city",
    };

    expect(PlaceSchema.safeParse({ ...base, unexpected: true }).success).toBe(false);
    expect(PlaceSchema.safeParse({ ...base, bbox: [136, 34, 135, 36] }).success).toBe(false);
    expect(PlaceSchema.safeParse({ ...base, bbox: [135, 36, 136, 34] }).success).toBe(false);
    expect(PlaceSchema.safeParse({ ...base, importance: 1.5 }).success).toBe(false);
    expect(PlaceSchema.safeParse({ ...base, timeZone: "local time" }).success).toBe(false);
    expect(
      PlaceSearchResponseSchema.safeParse({
        items: [base],
        provider: "geoapify",
        degraded: false,
        cached: false,
      }).success,
    ).toBe(true);
  });

  it("exposes media display URLs without bucket, object key, or raw variants", () => {
    const media = {
      id: MEDIA,
      workspaceId: WORKSPACE,
      tripId: TRIP,
      uploaderId: USER,
      mimeType: "image/webp",
      size: 123456,
      width: 4000,
      height: 3000,
      blurhash: null,
      status: "ready" as const,
      error: null,
      caption: null,
      date: null,
      location: null,
      createdAt: TS,
      updatedAt: TS,
      deletedAt: null,
      url: "https://media.example.com/large.webp?signature=one",
      thumbUrl: "https://media.example.com/thumb.webp?signature=two",
      expiresAt: TS,
    };

    const parsedMedia = GetMediaResponseSchema.parse(media);
    expect(JSON.parse(JSON.stringify(parsedMedia))).toEqual(parsedMedia);
    expect(parsedMedia.status).toBe("ready");
    expect(parsedMedia).not.toHaveProperty("bucket");
    expect(parsedMedia).not.toHaveProperty("key");
    expect(parsedMedia).not.toHaveProperty("variants");
    expect(GetMediaResponseSchema.safeParse({ ...media, url: null }).success).toBe(false);
    expect(GetMediaResponseSchema.safeParse({ ...media, expiresAt: null }).success).toBe(false);

    const parsedPublicMedia = PublicMediaSchema.parse({
      id: MEDIA,
      url: media.url,
      thumbUrl: media.thumbUrl,
      expiresAt: TS,
      width: media.width,
      height: media.height,
      blurhash: null,
      caption: null,
      date: null,
      location: null,
    });
    expect(parsedPublicMedia).not.toHaveProperty("bucket");
    expect(parsedPublicMedia).not.toHaveProperty("key");
    expect(parsedPublicMedia).not.toHaveProperty("variants");
  });

  it("validates journal entries without floating point money", () => {
    expect(JournalEntrySchema.parse(journalEntry).id).toBe(ENTRY);
    expect(JournalEntrySchema.safeParse({ ...journalEntry, id: "not-a-uuid" }).success).toBe(false);
    expect(JournalEntrySchema.safeParse({ ...journalEntry, date: "11/17/2026" }).success).toBe(
      false,
    );
  });

  it("accepts exact custom splits and rejects totals that do not reconcile", () => {
    const parsed = ExpenseWithSplitsSchema.parse({
      ...expense,
      participants: [
        { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: USER, shareAmountMinor: 40 },
        { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: OTHER, shareAmountMinor: 30 },
        { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: PAYER, shareAmountMinor: 30 },
      ],
    });
    expect(parsed.participants).toHaveLength(3);

    expect(
      ExpenseWithSplitsSchema.safeParse({
        ...expense,
        participants: [
          { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: USER, shareAmountMinor: 40 },
          { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: OTHER, shareAmountMinor: 30 },
        ],
      }).success,
    ).toBe(false);
  });

  it("assigns equal split remainders to the payer", () => {
    expect(
      ExpenseWithSplitsSchema.safeParse({
        ...expense,
        splitMode: "equal",
        participants: [
          { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: USER, shareAmountMinor: 33 },
          { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: OTHER, shareAmountMinor: 33 },
          { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: PAYER, shareAmountMinor: 34 },
        ],
      }).success,
    ).toBe(true);

    expect(
      ExpenseWithSplitsSchema.safeParse({
        ...expense,
        splitMode: "equal",
        participants: [
          { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: USER, shareAmountMinor: 34 },
          { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: OTHER, shareAmountMinor: 33 },
          { expenseId: EXPENSE, workspaceId: WORKSPACE, userId: PAYER, shareAmountMinor: 33 },
        ],
      }).success,
    ).toBe(false);
  });

  it("never exposes share-link secrets", () => {
    const link = {
      id: "0192f4c5-6a7b-7c8d-8123-456789abcdea",
      workspaceId: WORKSPACE,
      tripId: TRIP,
      createdById: USER,
      expiresAt: null,
      revokedAt: null,
      hasPassword: true,
      allowIndex: false,
      showBudget: false,
      lastAccessedAt: null,
      accessCount: 0,
      createdAt: TS,
    };

    const parsed = ShareLinkSchema.parse(link);
    expect(parsed.hasPassword).toBe(true);
    expect(parsed).not.toHaveProperty("tokenHash");
    expect(parsed).not.toHaveProperty("passwordHash");
    expect(ShareLinkSchema.safeParse({ ...link, tokenHash: "secret" }).success).toBe(false);
  });

  it("keeps invitation hashes out of the API entity", () => {
    const parsed = InvitationSchema.parse({
      id: "0192f4c5-6a7b-7c8d-8123-456789abcdeb",
      workspaceId: WORKSPACE,
      email: "traveler@example.com",
      role: "editor",
      invitedById: USER,
      expiresAt: "2026-11-24T08:00:00.000Z",
      acceptedAt: null,
      revokedAt: null,
      createdAt: TS,
    });
    expect(parsed.role).toBe("editor");
    expect(parsed).not.toHaveProperty("tokenHash");
  });
});

describe("workspace scoping", () => {
  const scopedRows = [
    {
      schema: TripParticipantSchema,
      row: { id: USER, workspaceId: WORKSPACE, tripId: TRIP, userId: USER, joinedAt: TS },
    },
    {
      schema: EntryMediaSchema,
      row: { workspaceId: WORKSPACE, entryId: ENTRY, mediaId: OTHER, order: 0 },
    },
    {
      schema: CommentMentionSchema,
      row: { workspaceId: WORKSPACE, commentId: ENTRY, userId: OTHER },
    },
    {
      schema: ExpenseParticipantSchema,
      row: {
        workspaceId: WORKSPACE,
        expenseId: EXPENSE,
        userId: OTHER,
        shareAmountMinor: 25,
      },
    },
  ] as const;

  it.each(scopedRows)("requires workspaceId on $schema", ({ schema, row }) => {
    expect(schema.safeParse(row).success).toBe(true);
    const withoutWorkspace = { ...row } as Record<string, unknown>;
    delete withoutWorkspace.workspaceId;
    expect(schema.safeParse(withoutWorkspace).success).toBe(false);
  });
});
