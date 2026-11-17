import type {
  ItineraryItemType,
  Mood,
  TripStatus,
  TripVisibility,
  Weather,
} from "@roamlog/contracts";

export interface TripRecord {
  id: string;
  workspaceId: string;
  title: string;
  summary: string;
  status: TripStatus;
  startDate: Date;
  endDate: Date;
  coverMediaId: string | null;
  origin: string;
  destinations: string[];
  countryCodes: string[];
  tags: string[];
  guestNames: string[];
  budgetAmountMinor: number | null;
  budgetCurrency: string | null;
  visibility: TripVisibility;
  favorite: boolean;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface StopRecord {
  id: string;
  tripId: string;
  workspaceId: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number | null;
  lng: number | null;
  startDate: Date;
  endDate: Date;
  notes: string;
  order: number;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ParticipantRecord {
  id: string;
  workspaceId: string;
  tripId: string;
  userId: string;
  joinedAt: Date;
}

export interface EntryRecord {
  id: string;
  tripId: string;
  workspaceId: string;
  title: string;
  date: Date;
  location: string;
  lat: number | null;
  lng: number | null;
  mood: Mood | null;
  weather: Weather | null;
  contentJson: unknown;
  contentHtml: string;
  excerpt: string;
  tags: string[];
  favorite: boolean;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface RevisionRecord {
  id: string;
  workspaceId: string;
  entryId: string;
  version: number;
  title: string;
  contentJson: unknown;
  contentHtml: string;
  editedById: string;
  createdAt: Date;
}

export interface ItineraryRecord {
  id: string;
  tripId: string;
  workspaceId: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  title: string;
  type: ItineraryItemType;
  location: string;
  notes: string;
  done: boolean;
  order: number;
  assigneeId: string | null;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ActivityRecord {
  id: string;
  workspaceId: string;
  tripId: string | null;
  actorId: string;
  verb: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date;
}

export interface MaxOrderResult {
  _max: {
    order: number | null;
  };
}
