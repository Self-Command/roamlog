import {
  ActivitySchema,
  EntryRevisionSchema,
  ItineraryItemSchema,
  JournalEntrySchema,
  StopSchema,
  TripParticipantSchema,
  TripSchema,
  type Activity,
  type EntryRevision,
  type ItineraryItem,
  type JournalEntry,
  type Stop,
  type Trip,
  type TripParticipant,
} from "@roamlog/contracts";

import { canonicalTripOrigin, iso, nullableIso, presentDate } from "./content-values.js";

export function presentTrip(record: {
  id: string;
  workspaceId: string;
  title: string;
  summary: string;
  status: string;
  startDate: Date | string;
  endDate: Date | string;
  coverMediaId: string | null;
  origin: string;
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
}): Trip {
  return TripSchema.parse({
    ...record,
    origin: canonicalTripOrigin(record.origin),
    startDate: presentDate(record.startDate),
    endDate: presentDate(record.endDate),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
  });
}

export function presentStop(record: {
  id: string;
  tripId: string;
  workspaceId: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number | null;
  lng: number | null;
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
}): Stop {
  return StopSchema.parse({
    ...record,
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
