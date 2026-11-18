import { describe, expect, it } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service.js";
import { ShareLinksRepository, type ShareLinkRecord } from "../share-links.repository.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "01942f30-1200-7000-8000-000000000002";
const USER_ID = "01942f30-1200-7000-8000-000000000003";
const TRIP_ID = "01942f30-1200-7000-8000-000000000004";
const OTHER_TRIP_ID = "01942f30-1200-7000-8000-000000000005";
const SHARE_LINK_ID = "01942f30-1200-7000-8000-000000000006";
const TRIP_MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const COVER_MEDIA_ID = "01942f30-1200-7000-8000-000000000011";
const UNRELATED_MEDIA_ID = "01942f30-1200-7000-8000-000000000012";

/** Row shape close enough to the Prisma `Media` model for the repository. */
function mediaRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRIP_MEDIA_ID,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    uploaderId: USER_ID,
    bucket: "roamlog-test",
    key: "ws/2026/11/media/original.jpg",
    mimeType: "image/jpeg",
    size: 4096,
    width: 1200,
    height: 800,
    blurhash: null,
    variants: {},
    status: "ready",
    error: null,
    caption: null,
    location: null,
    date: null,
    createdAt: new Date("2026-11-11T00:00:00.000Z"),
    updatedAt: new Date("2026-11-11T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function tripRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    tags: [],
    guestNames: [],
    budgetAmountMinor: null,
    budgetCurrency: null,
    visibility: "public_link",
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

function shareLinkRecord(overrides: Partial<ShareLinkRecord> = {}): ShareLinkRecord {
  return {
    id: SHARE_LINK_ID,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    tokenHash: "hash",
    createdById: USER_ID,
    expiresAt: null,
    revokedAt: null,
    passwordHash: null,
    allowIndex: false,
    showBudget: false,
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Evaluates the subset of Prisma's `where` semantics this repository relies on:
 * scalar equality (including `null`) and top-level `OR`.
 */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [field, expected] of Object.entries(where)) {
    if (field === "OR") {
      const arms = expected as Array<Record<string, unknown>>;
      if (!arms.some((arm) => matchesWhere(row, arm))) {
        return false;
      }
      continue;
    }
    const actual = row[field] ?? null;
    if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Minimal `PrismaService` double: a trip lookup plus a `media` table that honours
 * the repository's own `where` clause, so tenant / status / soft-delete filtering
 * is exercised instead of asserted against a hard-coded return value.
 */
function fakePrisma(
  trip: Record<string, unknown> | null,
  media: ReadonlyArray<Record<string, unknown>>,
) {
  const mediaQueries: Array<Record<string, unknown>> = [];
  const client = {
    trip: { findFirst: async () => trip },
    stop: { findMany: async () => [] },
    journalEntry: { findMany: async () => [] },
    media: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        mediaQueries.push(args.where);
        return media.filter((row) => matchesWhere(row, args.where));
      },
    },
    entryMedia: { findMany: async () => [] },
    expense: { findMany: async () => [] },
  };
  return {
    prisma: { client } as unknown as PrismaService,
    mediaQueries,
  };
}

async function loadBundle(
  trip: Record<string, unknown>,
  media: ReadonlyArray<Record<string, unknown>>,
) {
  const { prisma, mediaQueries } = fakePrisma(trip, media);
  const repository = new ShareLinksRepository(prisma);
  const bundle = await repository.loadPublicTrip(shareLinkRecord());
  return { bundle, mediaQueries };
}

describe("ShareLinksRepository.loadPublicTrip cover media", () => {
  it("loads a Workspace-level cover in the same media query as the gallery", async () => {
    const { bundle, mediaQueries } = await loadBundle(tripRow({ coverMediaId: COVER_MEDIA_ID }), [
      mediaRow(),
      mediaRow({
        id: COVER_MEDIA_ID,
        tripId: null,
        key: "ws/2026/11/media/cover.jpg",
        createdAt: new Date("2026-11-12T00:00:00.000Z"),
      }),
      // Workspace media that is not the cover must not ride along.
      mediaRow({
        id: UNRELATED_MEDIA_ID,
        tripId: null,
        key: "ws/2026/11/media/unrelated.jpg",
      }),
    ]);

    expect(bundle?.coverMedia).toMatchObject({
      id: COVER_MEDIA_ID,
      workspaceId: WORKSPACE_ID,
      tripId: null,
      status: "ready",
    });
    // The gallery is unchanged: only media attached to this trip.
    expect(bundle?.media.map((row) => row.id)).toEqual([TRIP_MEDIA_ID]);
    // No N+1: the cover rides in the existing media query.
    expect(mediaQueries).toHaveLength(1);
    expect(mediaQueries[0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      status: "ready",
      deletedAt: null,
    });
    expect(mediaQueries[0]).not.toHaveProperty("tripId");
    expect(mediaQueries[0]?.OR).toEqual([{ tripId: TRIP_ID }, { id: COVER_MEDIA_ID }]);
  });

  it("keeps the pre-existing gallery query when the trip has no cover", async () => {
    const { bundle, mediaQueries } = await loadBundle(tripRow(), [mediaRow()]);

    expect(bundle?.coverMedia).toBeNull();
    expect(bundle?.media.map((row) => row.id)).toEqual([TRIP_MEDIA_ID]);
    expect(mediaQueries).toHaveLength(1);
    expect(mediaQueries[0]).toEqual({
      workspaceId: WORKSPACE_ID,
      status: "ready",
      deletedAt: null,
      tripId: TRIP_ID,
    });
  });

  it("keeps a trip-attached cover inside the gallery instead of duplicating it", async () => {
    const { bundle } = await loadBundle(tripRow({ coverMediaId: TRIP_MEDIA_ID }), [mediaRow()]);

    expect(bundle?.coverMedia).toBeNull();
    expect(bundle?.media.map((row) => row.id)).toEqual([TRIP_MEDIA_ID]);
  });

  it("never loads a cover row owned by another Workspace", async () => {
    const { bundle } = await loadBundle(tripRow({ coverMediaId: COVER_MEDIA_ID }), [
      mediaRow(),
      mediaRow({
        id: COVER_MEDIA_ID,
        tripId: null,
        workspaceId: OTHER_WORKSPACE_ID,
      }),
    ]);

    expect(bundle?.coverMedia).toBeNull();
    expect(bundle?.media.map((row) => row.id)).toEqual([TRIP_MEDIA_ID]);
  });

  it("never loads a soft-deleted cover", async () => {
    const { bundle } = await loadBundle(tripRow({ coverMediaId: COVER_MEDIA_ID }), [
      mediaRow(),
      mediaRow({
        id: COVER_MEDIA_ID,
        tripId: null,
        deletedAt: new Date("2026-11-13T00:00:00.000Z"),
      }),
    ]);

    expect(bundle?.coverMedia).toBeNull();
    expect(bundle?.media.map((row) => row.id)).toEqual([TRIP_MEDIA_ID]);
  });

  it.each(["processing", "failed", "pending"])("never loads a %s cover", async (status) => {
    const { bundle } = await loadBundle(tripRow({ coverMediaId: COVER_MEDIA_ID }), [
      mediaRow(),
      mediaRow({ id: COVER_MEDIA_ID, tripId: null, status }),
    ]);

    expect(bundle?.coverMedia).toBeNull();
    expect(bundle?.media.map((row) => row.id)).toEqual([TRIP_MEDIA_ID]);
  });

  it("hands over a cover attached to another trip without adding it to the gallery", async () => {
    const { bundle } = await loadBundle(tripRow({ coverMediaId: COVER_MEDIA_ID }), [
      mediaRow(),
      mediaRow({ id: COVER_MEDIA_ID, tripId: OTHER_TRIP_ID }),
    ]);

    // The repository scopes the cover arm by Workspace, not by trip: `TripCover`
    // semantics ("Workspace-level or this very trip") belong to the projector,
    // which is the same one the authenticated trip reads use.
    expect(bundle?.coverMedia).toMatchObject({
      id: COVER_MEDIA_ID,
      tripId: OTHER_TRIP_ID,
    });
    expect(bundle?.media.map((row) => row.id)).toEqual([TRIP_MEDIA_ID]);
  });

  it("survives a stale cover reference instead of failing the read", async () => {
    const { bundle, mediaQueries } = await loadBundle(tripRow({ coverMediaId: COVER_MEDIA_ID }), [
      mediaRow(),
    ]);

    expect(bundle?.coverMedia).toBeNull();
    expect(bundle?.media.map((row) => row.id)).toEqual([TRIP_MEDIA_ID]);
    expect(mediaQueries).toHaveLength(1);
    expect(bundle?.trip).toMatchObject({ id: TRIP_ID });
  });

  it("keeps entry media and budget projection untouched", async () => {
    const { bundle } = await loadBundle(tripRow({ coverMediaId: COVER_MEDIA_ID }), [
      mediaRow(),
      mediaRow({ id: COVER_MEDIA_ID, tripId: null }),
    ]);

    expect(bundle?.entries).toEqual([]);
    expect(bundle?.stops).toEqual([]);
    expect(bundle?.budget).toBeNull();
  });
});
