import type {
  ExpenseWithSplits,
  JournalEntry,
  Stop,
  Trip,
  User,
  WorkspaceWithRole,
} from "@roamlog/contracts";
import { vi } from "vitest";

import type { DataAdapter } from "@/lib/api";

export const TEST_USER_ID = "0198f000-0000-7000-8000-000000000001";
export const TEST_WORKSPACE_ID = "0198f000-0000-7000-8000-000000000002";
export const TEST_OTHER_USER_ID = "0198f000-0000-7000-8000-000000000003";
export const TEST_NOW = "2026-11-18T08:00:00.000Z";

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: TEST_USER_ID,
    email: "traveler@roamlog.test",
    emailVerified: true,
    name: "测试旅人",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: TEST_NOW,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function makeWorkspace(overrides: Partial<WorkspaceWithRole> = {}): WorkspaceWithRole {
  return {
    id: TEST_WORKSPACE_ID,
    name: "测试工作区",
    slug: "roamlog-crew",
    logoMediaId: null,
    ownerId: TEST_USER_ID,
    plan: "team",
    status: "active",
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    weekStartsOn: 1,
    settings: {
      defaultVisibility: "workspace",
      notificationDefaults: { inApp: true, email: false },
      density: "comfortable",
    },
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    deletedAt: null,
    role: "owner",
    ...overrides,
  };
}

function durationDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000) + 1;
}

export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  const startDate = overrides.startDate ?? "2026-11-01";
  const endDate = overrides.endDate ?? "2026-11-03";
  return {
    id: "0198f000-0000-7000-8000-000000000010",
    workspaceId: TEST_WORKSPACE_ID,
    title: "真实测试旅行",
    summary: "由真实 API 数据渲染的旅行。",
    status: "planning",
    startDate,
    endDate,
    coverMediaId: null,
    cover: null,
    origin: "上海",
    originLat: null,
    originLng: null,
    originCountryCode: "CN",
    timeZone: "Asia/Shanghai",
    destinations: ["京都"],
    countryCodes: ["JP"],
    tags: ["测试"],
    guestNames: [],
    budgetAmountMinor: null,
    budgetCurrency: null,
    visibility: "workspace",
    favorite: false,
    version: 1,
    createdById: TEST_USER_ID,
    updatedById: TEST_USER_ID,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    deletedAt: null,
    ...overrides,
    durationDays: overrides.durationDays ?? durationDays(startDate, endDate),
  };
}

export function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "0198f000-0000-7000-8000-000000000020",
    tripId: "0198f000-0000-7000-8000-000000000010",
    workspaceId: TEST_WORKSPACE_ID,
    title: "真实日志",
    date: "2026-11-02",
    location: "京都",
    lat: null,
    lng: null,
    mood: null,
    weather: null,
    contentJson: {},
    contentHtml: "",
    excerpt: "",
    tags: [],
    favorite: false,
    version: 1,
    createdById: TEST_USER_ID,
    updatedById: TEST_USER_ID,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function makeExpense(overrides: Partial<ExpenseWithSplits> = {}): ExpenseWithSplits {
  const id = overrides.id ?? "0198f000-0000-7000-8000-000000000030";
  const amountMinor = overrides.amountMinor ?? 123_400;
  return {
    id,
    workspaceId: TEST_WORKSPACE_ID,
    tripId: "0198f000-0000-7000-8000-000000000010",
    date: "2026-11-02",
    category: "food",
    note: "真实支出",
    amountMinor,
    currency: "CNY",
    paidById: TEST_USER_ID,
    splitMode: "equal",
    receiptMediaId: null,
    createdById: TEST_USER_ID,
    version: 1,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    deletedAt: null,
    participants: [
      {
        workspaceId: TEST_WORKSPACE_ID,
        expenseId: id,
        userId: TEST_USER_ID,
        shareAmountMinor: amountMinor,
      },
    ],
    ...overrides,
  };
}

export function makeStop(overrides: Partial<Stop> = {}): Stop {
  return {
    id: "0198f000-0000-7000-8000-000000000040",
    tripId: "0198f000-0000-7000-8000-000000000010",
    workspaceId: TEST_WORKSPACE_ID,
    city: "京都",
    country: "日本",
    countryCode: "JP",
    lat: 35.0116,
    lng: 135.7681,
    provider: "local",
    providerPlaceId: null,
    timeZone: "Asia/Tokyo",
    startDate: "2026-11-01",
    endDate: "2026-11-03",
    notes: "",
    order: 0,
    version: 1,
    createdById: TEST_USER_ID,
    updatedById: TEST_USER_ID,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    deletedAt: null,
    ...overrides,
  };
}

export interface FakeAdapterData {
  user?: User;
  workspace?: WorkspaceWithRole;
  trips?: Trip[];
  entries?: JournalEntry[];
  expenses?: ExpenseWithSplits[];
  stops?: Stop[];
}

export function createFakeAdapter(data: FakeAdapterData = {}): DataAdapter {
  const user = data.user ?? makeUser();
  const workspace = data.workspace ?? makeWorkspace();
  const trips = data.trips ?? [];
  const entries = data.entries ?? [];
  const expenses = data.expenses ?? [];
  const stops = data.stops ?? [];

  const adapter = {
    mode: "api" as const,
    fetchMe: vi.fn(async () => user),
    fetchSession: vi.fn(async () => ({ user })),
    fetchMyWorkspaces: vi.fn(async () => [workspace]),
    fetchWorkspaces: vi.fn(async () => [workspace]),
    fetchWorkspace: vi.fn(async () => workspace),
    fetchTrips: vi.fn(async () => ({
      items: trips,
      nextCursor: null,
      hasMore: false,
    })),
    fetchItinerary: vi.fn(async () => []),
    fetchEntries: vi.fn(async () => ({
      items: entries,
      nextCursor: null,
      hasMore: false,
    })),
    fetchExpenses: vi.fn(async (tripId: string) => ({
      items: expenses.filter((expense) => expense.tripId === tripId),
      nextCursor: null,
      hasMore: false,
    })),
    fetchStops: vi.fn(async (tripId: string) =>
      stops.filter((stop) => stop.tripId === tripId),
    ),
  };

  return adapter as unknown as DataAdapter;
}