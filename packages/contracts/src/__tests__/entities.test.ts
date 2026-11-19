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
  PlaceSchema,
  PlaceSearchQuerySchema,
  PlaceSearchResponseSchema,
  PublicMediaSchema,
  ShareLinkSchema,
  StopSchema,
  TripCoverSchema,
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
    expect(StopSchema.safeParse({ ...stop, timeZone: "local time" }).success).toBe(false);
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
