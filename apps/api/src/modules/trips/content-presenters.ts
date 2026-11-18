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

import { canonicalTripOrigin, iso, nullableIso, presentDate } from "./content-values.js";

/**
 * Row shape accepted by {@link presentTrip}.
 *
 * The place-metadata fields are optional while the W0_DB migration that adds
 * `originLat` / `originLng` / `originCountryCode` / `timeZone` is still rolling
 * out: once Prisma exposes them they flow through untouched, and until then the
 * presenter reports `null` instead of inventing a location.
 */
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
  timeZone?: string | null;
  destinations: string[];
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
  return TripSchema.parse({
    ...record,
    origin: canonicalTripOrigin(record.origin),
    startDate,
    endDate,
    durationDays: tripDurationDays(startDate, endDate),
    cover,
    originLat: record.originLat ?? null,
    originLng: record.originLng ?? null,
    originCountryCode: record.originCountryCode ?? null,
    timeZone: record.timeZone ?? null,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
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
  return StopSchema.parse({
    ...record,
    provider: record.provider ?? null,
    providerPlaceId: record.providerPlaceId ?? null,
    timeZone: record.timeZone ?? null,
    startDate: presentDate(record.startDate),
    endDate: presentDate(record.endDate),
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
  return TripParticipantSchema.parse({
    ...record,
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
}): JournalEntry {
  return JournalEntrySchema.parse({
    ...record,
    date: presentDate(record.date),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
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
  return EntryRevisionSchema.parse({
    ...record,
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
  return ItineraryItemSchema.parse({
    ...record,
    date: presentDate(record.date),
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
  return ActivitySchema.parse({
    ...record,
    metadata:
      typeof record.metadata === "object" &&
      record.metadata !== null &&
      !Array.isArray(record.metadata)
        ? record.metadata
        : {},
    createdAt: iso(record.createdAt),
  });
}
