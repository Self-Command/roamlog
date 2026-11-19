import {
  ActivitySchema,
  EntryRevisionSchema,
  ItineraryItemSchema,
  JournalEntrySchema,
  StopSchema,
  TripParticipantSchema,
  TripSchema,
  tripDurationDays,
  type Activity,
  type EntryRevision,
  type ItineraryItem,
  type JournalEntry,
  type Stop,
  type Trip,
  type TripCover,
  type TripParticipant,
} from "@roamlog/contracts";

import { canonicalTripOrigin, iso, nullableIso, presentDate, toBbox } from "./content-values.js";

/**
 * Row shape accepted by {@link presentTrip}.
 *
 * The place-metadata fields are optional while the W0_DB migration that adds
 * `originLat` / `originLng` / `originCountryCode` / `timeZone` is still rolling
 * out: once Prisma exposes them they flow through untouched, and until then the
 * presenter reports `null` instead of inventing a location.
 */
export interface PresentTripDestinationInput {
  id: string;
  name: string;
  provider?: string | null;
  providerPlaceId?: string | null;
  address?: string | null;
  country?: string | null;
  countryCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  timeZone?: string | null;
  /** Raw `JSONB`; normalized with {@link toBbox} so legacy rows report `null`. */
  bbox?: unknown;
  order: number;
  deletedAt?: Date | string | null;
}

export interface PresentTripInput {
  id: string;
  workspaceId: string;
  title: string;
  summary: string;
  status: string;
  startDate: Date | string;
  endDate: Date | string;
  coverMediaId: string | null;
  origin: string;
  originLat?: number | null;
  originLng?: number | null;
  originCountryCode?: string | null;
  originAddress?: string | null;
  /** Raw `JSONB`; normalized with {@link toBbox} so legacy rows report `null`. */
  originBbox?: unknown;
  timeZone?: string | null;
  /** @deprecated Names-only mirror; see {@link PresentTripInput.destinationsV2}. */
  destinations: string[];
  /**
   * Active structured destination rows. Presenter sorts by `order` and filters
   * `deletedAt` defensively, then derives `destinations` from the same rows so
   * the deprecated array and the structured rows can never disagree on a read.
   */
  destinationsV2?: PresentTripDestinationInput[];
  countryCodes: string[];
  tags: string[];
  guestNames: string[];
  budgetAmountMinor: number | null;
  budgetCurrency: string | null;
  visibility: string;
  favorite: boolean;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
  moderatedAt?: Date | string | null;
  moderatedById?: string | null;
}

/**
 * Projects a trip row.
 *
 * `cover` is resolved separately: it needs signed URLs and a same-Workspace /
 * same-trip media lookup (`TripCoverService`). Callers that have not resolved one
 * pass nothing and the trip reports `cover: null` — never a made-up URL.
 */
export function presentTrip(record: PresentTripInput, cover: TripCover | null = null): Trip {
  const startDate = presentDate(record.startDate);
  const endDate = presentDate(record.endDate);
  // V2 rows are the source of truth once they exist. The relation include
  // already filters/sorts, but the presenter does it again: a caller that hands
  // us a raw paginated row (or a stub without the include) must still produce a
  // deterministic, soft-delete-free list. The deprecated `destinations` array is
  // then derived from the same rows, so the two fields cannot disagree after a
  // structured write.
  const structuredDestinations = (record.destinationsV2 ?? [])
    .filter((destination) => destination.deletedAt === null || destination.deletedAt === undefined)
    .slice()
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((destination) => ({
      id: destination.id,
      name: destination.name,
      provider: destination.provider ?? null,
      providerPlaceId: destination.providerPlaceId ?? null,
      address: destination.address ?? null,
      country: destination.country ?? null,
      countryCode: destination.countryCode ?? null,
      lat: destination.lat ?? null,
      lng: destination.lng ?? null,
      timeZone: destination.timeZone ?? null,
      bbox: toBbox(destination.bbox),
      order: destination.order,
    }));
  const destinationNames =
    structuredDestinations.length > 0
      ? structuredDestinations.map((destination) => destination.name)
      : record.destinations;

  // Fields are listed explicitly: the row also carries operator-only columns
  // (`moderatedAt`, `moderatedById`) and future schema additions, and the
  // `.strict()` contract must never receive a column it does not declare.
  return TripSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    title: record.title,
    summary: record.summary,
    status: record.status,
    startDate,
    endDate,
    durationDays: tripDurationDays(startDate, endDate),
    coverMediaId: record.coverMediaId,
    cover,
    origin: canonicalTripOrigin(record.origin),
    originLat: record.originLat ?? null,
    originLng: record.originLng ?? null,
    originCountryCode: record.originCountryCode ?? null,
    originAddress: record.originAddress ?? null,
    originBbox: toBbox(record.originBbox),
    timeZone: record.timeZone ?? null,
    destinations: destinationNames,
    destinationsV2: structuredDestinations,
    countryCodes: record.countryCodes,
    tags: record.tags,
    guestNames: record.guestNames,
    budgetAmountMinor: record.budgetAmountMinor,
    budgetCurrency: record.budgetCurrency,
    visibility: record.visibility,
    favorite: record.favorite,
    version: record.version,
    createdById: record.createdById,
    updatedById: record.updatedById,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
    moderatedAt: record.moderatedAt === undefined ? null : nullableIso(record.moderatedAt),
    moderatedById: record.moderatedById ?? null,
  });
}

/** Row shape accepted by {@link presentStop}; place metadata is optional for the same reason. */
export interface PresentStopInput {
  id: string;
  tripId: string;
  workspaceId: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number | null;
  lng: number | null;
  provider?: string | null;
  providerPlaceId?: string | null;
  timeZone?: string | null;
  address?: string | null;
  /** Raw `JSONB`; normalized with {@link toBbox} so legacy rows report `null`. */
  bbox?: unknown;
  startDate: Date | string;
  endDate: Date | string;
  notes: string;
  order: number;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

export function presentStop(record: PresentStopInput): Stop {
  // Explicit field list — the row is never spread into the `.strict()` contract.
  // `StopSchema` is strict, so an additive column (`moderatedAt`, a future place
  // column) would otherwise turn every read into a 500.
  return StopSchema.parse({
    id: record.id,
    tripId: record.tripId,
    workspaceId: record.workspaceId,
    city: record.city,
    country: record.country,
    countryCode: record.countryCode,
    lat: record.lat,
    lng: record.lng,
    provider: record.provider ?? null,
    providerPlaceId: record.providerPlaceId ?? null,
    timeZone: record.timeZone ?? null,
    address: record.address ?? null,
    bbox: toBbox(record.bbox),
    startDate: presentDate(record.startDate),
    endDate: presentDate(record.endDate),
    notes: record.notes,
    order: record.order,
    version: record.version,
    createdById: record.createdById,
    updatedById: record.updatedById,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
  });
}

export function presentParticipant(record: {
  id: string;
  workspaceId: string;
  tripId: string;
  userId: string;
  joinedAt: Date | string;
}): TripParticipant {
  // `TripParticipantSchema` is strict and the row is never spread.
  return TripParticipantSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    tripId: record.tripId,
    userId: record.userId,
    joinedAt: iso(record.joinedAt),
  });
}

export function presentEntry(record: {
  id: string;
  tripId: string;
  workspaceId: string;
  title: string;
  date: Date | string;
  location: string;
  lat: number | null;
  lng: number | null;
  mood: string | null;
  weather: string | null;
  contentJson: unknown;
  contentHtml: string;
  excerpt: string;
  tags: string[];
  favorite: boolean;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
  moderatedAt?: Date | string | null;
  moderatedById?: string | null;
}): JournalEntry {
  return JournalEntrySchema.parse({
    id: record.id,
    tripId: record.tripId,
    workspaceId: record.workspaceId,
    title: record.title,
    date: presentDate(record.date),
    location: record.location,
    lat: record.lat,
    lng: record.lng,
    mood: record.mood,
    weather: record.weather,
    contentJson: record.contentJson,
    contentHtml: record.contentHtml,
    excerpt: record.excerpt,
    tags: record.tags,
    favorite: record.favorite,
    version: record.version,
    createdById: record.createdById,
    updatedById: record.updatedById,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
    moderatedAt: record.moderatedAt === undefined ? null : nullableIso(record.moderatedAt),
    moderatedById: record.moderatedById ?? null,
  });
}

export function presentRevision(record: {
  id: string;
  workspaceId: string;
  entryId: string;
  version: number;
  title: string;
  contentJson: unknown;
  contentHtml: string;
  editedById: string;
  createdAt: Date | string;
}): EntryRevision {
  // `EntryRevisionSchema` is strict; list the contract fields explicitly so a
  // future revision column (or a read model with extra joins) cannot 500 the
  // revision history.
  return EntryRevisionSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    entryId: record.entryId,
    version: record.version,
    title: record.title,
    contentJson: record.contentJson,
    contentHtml: record.contentHtml,
    editedById: record.editedById,
    createdAt: iso(record.createdAt),
  });
}

export function presentItineraryItem(record: {
  id: string;
  tripId: string;
  workspaceId: string;
  date: Date | string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  type: string;
  location: string;
  notes: string;
  done: boolean;
  order: number;
  assigneeId: string | null;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}): ItineraryItem {
  // `ItineraryItemSchema` is strict; the row is never spread.
  return ItineraryItemSchema.parse({
    id: record.id,
    tripId: record.tripId,
    workspaceId: record.workspaceId,
    date: presentDate(record.date),
    startTime: record.startTime,
    endTime: record.endTime,
    title: record.title,
    type: record.type,
    location: record.location,
    notes: record.notes,
    done: record.done,
    order: record.order,
    assigneeId: record.assigneeId,
    version: record.version,
    createdById: record.createdById,
    updatedById: record.updatedById,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
  });
}

export function presentActivity(record: {
  id: string;
  workspaceId: string;
  tripId: string | null;
  actorId: string;
  verb: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date | string;
}): Activity {
  // `ActivitySchema` is strict; only the declared columns reach the contract,
  // and `metadata` is normalized to an object before validation.
  return ActivitySchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    tripId: record.tripId,
    actorId: record.actorId,
    verb: record.verb,
    entityType: record.entityType,
    entityId: record.entityId,
    metadata:
      typeof record.metadata === "object" &&
      record.metadata !== null &&
      !Array.isArray(record.metadata)
        ? record.metadata
        : {},
    createdAt: iso(record.createdAt),
  });
}
