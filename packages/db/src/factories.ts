import type {
  Expense,
  ExpenseParticipant,
  JournalEntry,
  Media,
  PackingItem,
  PlatformRoleOverride,
  Prisma,
  Trip,
  User,
  Workspace,
  WorkspaceMember,
} from "./generated/prisma/client.js";
import { deterministicId } from "./seed/util.js";

let sequence = 0;

function nextId(namespace: string): string {
  sequence += 1;
  return deterministicId("factory", `${namespace}:${sequence}`);
}

const fixedNow = new Date("2026-01-01T00:00:00.000Z");

export function makeUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? nextId("user");
  return {
    id,
    email: `user-${id.slice(0, 8)}@roamlog.local`,
    emailVerified: true,
    twoFactorEnabled: false,
    name: "Factory User",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: fixedNow,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deletedAt: null,
    ...overrides,
  };
}

export function makeWorkspace(
  overrides: Partial<Workspace> = {},
): Workspace {
  const id = overrides.id ?? nextId("workspace");
  return {
    id,
    name: "Factory Workspace",
    slug: `factory-${id.slice(0, 8)}`,
    logoMediaId: null,
    ownerId: overrides.ownerId ?? nextId("owner"),
    plan: "team",
    status: "active",
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    weekStartsOn: 1,
    settings: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deletedAt: null,
    ...overrides,
  };
}

export function makeMember(
  overrides: Partial<WorkspaceMember> = {},
): WorkspaceMember {
  return {
    id: overrides.id ?? nextId("member"),
    workspaceId: overrides.workspaceId ?? nextId("workspace"),
    userId: overrides.userId ?? nextId("user"),
    role: "editor",
    status: "active",
    joinedAt: fixedNow,
    invitedById: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides,
  };
}

export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  const createdById = overrides.createdById ?? nextId("user");
  return {
    id: overrides.id ?? nextId("trip"),
    workspaceId: overrides.workspaceId ?? nextId("workspace"),
    title: "Factory Trip",
    summary: "A focused test trip.",
    status: "planning",
    startDate: fixedNow,
    endDate: fixedNow,
    coverMediaId: null,
    origin: "Factory origin",
    originLat: null,
    originLng: null,
    originCountryCode: null,
    originAddress: null,
    originBbox: null,
    timeZone: null,
    destinations: [],
    countryCodes: [],
    tags: [],
    guestNames: [],
    budgetAmountMinor: 0,
    budgetCurrency: "CNY",
    visibility: "workspace",
    favorite: false,
    version: 1,
    createdById,
    updatedById: overrides.updatedById ?? createdById,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deletedAt: null,
    ...overrides,
  };
}

export function makeEntry(
  overrides: Partial<JournalEntry> = {},
): JournalEntry {
  const createdById = overrides.createdById ?? nextId("user");
  return {
    id: overrides.id ?? nextId("entry"),
    tripId: overrides.tripId ?? nextId("trip"),
    workspaceId: overrides.workspaceId ?? nextId("workspace"),
    title: "Factory Entry",
    date: fixedNow,
    location: "Test location",
    lat: null,
    lng: null,
    mood: "calm",
    weather: "sunny",
    contentJson: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    },
    contentHtml: "<p>Hello</p>",
    excerpt: "Hello",
    tags: [],
    favorite: false,
    version: 1,
    createdById,
    updatedById: overrides.updatedById ?? createdById,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deletedAt: null,
    ...overrides,
  };
}

export interface ExpenseFactoryInput {
  workspaceId: string;
  tripId: string;
  paidById: string;
  participantIds: string[];
  amountMinor?: number;
  currency?: string;
  splitMode?: "equal" | "custom";
  customShares?: { userId: string; shareAmountMinor: number }[];
  overrides?: Partial<Expense>;
}

export function makeExpense(
  input: ExpenseFactoryInput,
): Expense & { participants: ExpenseParticipant[] } {
  const amountMinor = input.amountMinor ?? 10_000;
  const splitMode = input.splitMode ?? "equal";
  const expenseId = input.overrides?.id ?? nextId("expense");
  const createdAt = input.overrides?.createdAt ?? fixedNow;

  if (!input.participantIds.includes(input.paidById)) {
    throw new Error("Expense payer must be a participant");
  }

  let shares: { userId: string; shareAmountMinor: number }[];
  if (splitMode === "equal") {
    const base = Math.floor(amountMinor / input.participantIds.length);
    let remainder = amountMinor - base * input.participantIds.length;
    shares = input.participantIds.map((userId) => {
      const extra = userId === input.paidById ? remainder : 0;
      remainder -= extra;
      return { userId, shareAmountMinor: base + extra };
    });
  } else {
    shares = input.customShares ?? [];
    const total = shares.reduce(
      (sum, share) => sum + share.shareAmountMinor,
      0,
    );
    if (total !== amountMinor) {
      throw new Error("Custom expense shares must sum to amountMinor");
    }
    if (shares.some((share) => !input.participantIds.includes(share.userId))) {
      throw new Error("Every custom share must reference a participant");
    }
  }

  const expense: Expense = {
    id: expenseId,
    workspaceId: input.workspaceId,
    tripId: input.tripId,
    date: fixedNow,
    category: "food",
    note: "Factory expense",
    amountMinor,
    currency: input.currency ?? "CNY",
    paidById: input.paidById,
    splitMode,
    receiptMediaId: null,
    createdById: input.paidById,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    ...input.overrides,
  };

  const participants: ExpenseParticipant[] = shares.map((share) => ({
    workspaceId: input.workspaceId,
    expenseId,
    userId: share.userId,
    shareAmountMinor: share.shareAmountMinor,
  }));

  return { ...expense, participants };
}

export function makePackingItem(
  overrides: Partial<PackingItem> = {},
): PackingItem {
  const createdById = overrides.createdById ?? nextId("user");
  return {
    id: overrides.id ?? nextId("packing"),
    workspaceId: overrides.workspaceId ?? nextId("workspace"),
    tripId: overrides.tripId ?? nextId("trip"),
    category: "gear",
    name: "Factory packing item",
    quantity: 1,
    packed: false,
    assigneeId: null,
    order: 0,
    version: 1,
    createdById,
    updatedById: overrides.updatedById ?? createdById,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deletedAt: null,
    ...overrides,
  };
}

export function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: overrides.id ?? nextId("media"),
    workspaceId: overrides.workspaceId ?? nextId("workspace"),
    tripId: null,
    uploaderId: overrides.uploaderId ?? nextId("user"),
    bucket: "roamlog-local",
    key: `test/media-${nextId("key")}.jpg`,
    mimeType: "image/jpeg",
    size: 1024,
    width: 1200,
    height: 800,
    blurhash: null,
    variants: {},
    status: "ready",
    error: null,
    caption: null,
    date: null,
    location: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deletedAt: null,
    ...overrides,
  };
}

export function makePlatformRoleOverride(
  overrides: Partial<PlatformRoleOverride> = {},
): PlatformRoleOverride {
  return {
    role: overrides.role ?? "support",
    action: overrides.action ?? "admin:users:read",
    granted: overrides.granted ?? false,
    updatedById: overrides.updatedById ?? nextId("user"),
    updatedAt: fixedNow,
    createdAt: fixedNow,
    ...overrides,
  };
}

export type { Prisma };
