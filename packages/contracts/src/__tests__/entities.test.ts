import { describe, expect, it } from "vitest";

import {
  CommentMentionSchema,
  DateOnlySchema,
  EntryMediaSchema,
  ExpenseParticipantSchema,
  ExpenseWithSplitsSchema,
  InvitationSchema,
  IsoTimestampSchema,
  JournalEntrySchema,
  ShareLinkSchema,
  TripParticipantSchema,
  TripSchema,
  UuidV7Schema,
} from "../index";

const USER = "0192f4c5-6a7b-7c8d-9e0f-123456789abc";
const OTHER = "0192f4c5-6a7b-7c8d-9e0f-123456789abd";
const PAYER = "0192f4c5-6a7b-7c8d-a123-456789abcdef";
const WORKSPACE = "0192f4c5-6a7b-7c8d-b123-456789abcdef";
const TRIP = "0192f4c5-6a7b-7c8d-8123-456789abcdef";
const ENTRY = "0192f4c5-6a7b-7c8d-9123-456789abcdef";
const EXPENSE = "0192f4c5-6a7b-7c8d-a923-456789abcdef";
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
  coverMediaId: null,
  origin: "Shanghai",
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
  });

  it("validates journal entries without floating point money", () => {
    expect(JournalEntrySchema.parse(journalEntry).id).toBe(ENTRY);
    expect(JournalEntrySchema.safeParse({ ...journalEntry, id: "not-a-uuid" }).success).toBe(false);
    expect(JournalEntrySchema.safeParse({ ...journalEntry, date: "11/17/2026" }).success).toBe(false);
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
