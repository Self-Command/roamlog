import { vi } from "vitest";

import type { WorkspaceMembershipAccess } from "../src/common/services/workspace-access.service.js";
import {
  NOW,
  USER_ADMIN_ID,
  USER_EDITOR_ID,
  USER_OWNER_ID,
  USER_VIEWER_ID,
  WORKSPACE_A_ID,
  WORKSPACE_B_ID,
} from "./identity-fixtures.js";

function uuidV7(suffix: number): string {
  const tail = suffix.toString(16).padStart(12, "0");
  return `01942f30-1200-7000-8000-${tail}`;
}

export const TRIP_A_ID = uuidV7(501);
export const TRIP_B_ID = uuidV7(502);
export const STOP_ID = uuidV7(503);
export const ENTRY_ID = uuidV7(504);
export const REVISION_ID = uuidV7(505);
export const ITINERARY_ID = uuidV7(506);
export const PARTICIPANT_ID = uuidV7(507);
export const MEDIA_ID = uuidV7(508);
export const ACTIVITY_ID = uuidV7(509);

export function membership(
  role: WorkspaceMembershipAccess["role"],
  userId = role === "viewer"
    ? USER_VIEWER_ID
    : role === "editor"
      ? USER_EDITOR_ID
      : role === "admin"
        ? USER_ADMIN_ID
        : USER_OWNER_ID,
  workspaceId = WORKSPACE_A_ID,
): WorkspaceMembershipAccess {
  return {
    id: uuidV7(600 + role.length),
    workspaceId,
    userId,
    role,
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    workspaceName: workspaceId === WORKSPACE_A_ID ? "Atlas Studio" : "Other Studio",
  };
}

export function tripRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIP_A_ID,
    workspaceId: WORKSPACE_A_ID,
    title: "Seoul, slowly",
    summary: "A week of food, trains, and rain.",
    status: "active",
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-18T00:00:00.000Z"),
    coverMediaId: null,
    origin: "Shanghai",
    destinations: ["Seoul"],
    countryCodes: ["KR"],
    tags: ["food", "city"],
    guestNames: [],
    budgetAmountMinor: 900_000,
    budgetCurrency: "KRW",
    visibility: "workspace",
    favorite: false,
    version: 1,
    createdById: USER_OWNER_ID,
    updatedById: USER_OWNER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function stopRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: STOP_ID,
    tripId: TRIP_A_ID,
    workspaceId: WORKSPACE_A_ID,
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
    createdById: USER_OWNER_ID,
    updatedById: USER_OWNER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function entryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    tripId: TRIP_A_ID,
    workspaceId: WORKSPACE_A_ID,
    title: "First night in Euljiro",
    date: new Date("2026-11-10T00:00:00.000Z"),
    location: "Euljiro, Seoul",
    lat: 37.5665,
    lng: 126.978,
    mood: "happy",
    weather: "rain",
    contentJson: { type: "doc", content: [] },
    contentHtml: "<p>Soju and warm noodles.</p>",
    excerpt: "Soju and warm noodles.",
    tags: ["seoul", "night"],
    favorite: false,
    version: 1,
    createdById: USER_OWNER_ID,
    updatedById: USER_OWNER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function revisionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: REVISION_ID,
    workspaceId: WORKSPACE_A_ID,
    entryId: ENTRY_ID,
    version: 1,
    title: "First night in Euljiro",
    contentJson: { type: "doc", content: [] },
    contentHtml: "<p>Old copy.</p>",
    editedById: USER_OWNER_ID,
    createdAt: NOW,
    ...overrides,
  };
}

export function itineraryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ITINERARY_ID,
    tripId: TRIP_A_ID,
    workspaceId: WORKSPACE_A_ID,
    date: new Date("2026-11-11T00:00:00.000Z"),
    startTime: "10:00",
    endTime: "11:00",
    title: "Gwangjang breakfast",
    type: "food",
    location: "Gwangjang Market",
    notes: "",
    done: false,
    order: 0,
    assigneeId: null,
    version: 1,
    createdById: USER_OWNER_ID,
    updatedById: USER_OWNER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function participantRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTICIPANT_ID,
    workspaceId: WORKSPACE_A_ID,
    tripId: TRIP_A_ID,
    userId: USER_EDITOR_ID,
    joinedAt: NOW,
    ...overrides,
  };
}

export function activityRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTIVITY_ID,
    workspaceId: WORKSPACE_A_ID,
    tripId: TRIP_A_ID,
    actorId: USER_OWNER_ID,
    verb: "trip.updated",
    entityType: "trip",
    entityId: TRIP_A_ID,
    metadata: {},
    createdAt: NOW,
    ...overrides,
  };
}

export interface FakeActivities {
  record: (
    tx: unknown,
    input: Record<string, unknown>,
  ) => Promise<{ id: string }>;
}

export function fakeActivities(): FakeActivities {
  return {
    record: vi.fn().mockResolvedValue({ id: ACTIVITY_ID }),
  };
}

export function fakeTransaction(repository: { transaction: ReturnType<typeof vi.fn> }, tx: unknown) {
  repository.transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
    callback(tx),
  );
}

export const OTHER_WORKSPACE_ID = WORKSPACE_B_ID;
