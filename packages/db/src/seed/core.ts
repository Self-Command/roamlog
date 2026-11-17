import type {
  SeedInvitation,
  SeedMember,
  SeedUser,
  SeedWorkspace,
} from "./types.js";
import { deterministicId, sha256, timestamp } from "./util.js";

export const userIds = {
  owner: deterministicId("user", "demo-owner"),
  editor: deterministicId("user", "mei-editor"),
  viewer: deterministicId("user", "jonas-viewer"),
} as const;

export const workspaceId = deterministicId("workspace", "roamlog-crew");

const createdAt = timestamp("2026-01-05", "08:00:00");
const updatedAt = timestamp("2026-11-17", "02:30:00");

export const users: SeedUser[] = [
  {
    id: userIds.owner,
    email: "demo@roamlog.local",
    emailVerified: true,
    name: "林墨",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: timestamp("2026-11-17", "01:50:00"),
    createdAt,
    updatedAt,
  },
  {
    id: userIds.editor,
    email: "mei@roamlog.local",
    emailVerified: true,
    name: "陈美",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: timestamp("2026-11-16", "14:20:00"),
    createdAt: timestamp("2026-01-06", "03:10:00"),
    updatedAt,
  },
  {
    id: userIds.viewer,
    email: "jonas@roamlog.local",
    emailVerified: true,
    name: "Jonas Berg",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "en-US",
    timezone: "Europe/Berlin",
    lastActiveAt: timestamp("2026-11-15", "18:05:00"),
    createdAt: timestamp("2026-01-07", "09:40:00"),
    updatedAt,
  },
];

export const workspace: SeedWorkspace = {
  id: workspaceId,
  name: "Roamlog Crew",
  slug: "roamlog-crew",
  logoMediaId: null,
  ownerId: userIds.owner,
  plan: "team",
  status: "active",
  defaultCurrency: "CNY",
  timezone: "Asia/Shanghai",
  weekStartsOn: 1,
  settings: {
    defaultTripVisibility: "workspace",
    defaultNotificationChannels: { inApp: true, email: true },
    density: "comfortable",
    accentGlow: "#91a7ff",
  },
  createdAt,
  updatedAt,
};

export const members: SeedMember[] = [
  {
    id: deterministicId("workspace-member", "demo-owner"),
    workspaceId,
    userId: userIds.owner,
    role: "owner",
    status: "active",
    joinedAt: createdAt,
    invitedById: null,
    createdAt,
    updatedAt,
  },
  {
    id: deterministicId("workspace-member", "mei-editor"),
    workspaceId,
    userId: userIds.editor,
    role: "editor",
    status: "active",
    joinedAt: timestamp("2026-01-06", "03:10:00"),
    invitedById: userIds.owner,
    createdAt: timestamp("2026-01-06", "03:10:00"),
    updatedAt,
  },
  {
    id: deterministicId("workspace-member", "jonas-viewer"),
    workspaceId,
    userId: userIds.viewer,
    role: "viewer",
    status: "active",
    joinedAt: timestamp("2026-01-07", "09:40:00"),
    invitedById: userIds.owner,
    createdAt: timestamp("2026-01-07", "09:40:00"),
    updatedAt,
  },
];

export const invitations: SeedInvitation[] = [
  {
    id: deterministicId("invitation", "sora-pending"),
    workspaceId,
    email: "sora@roamlog.local",
    role: "editor",
    tokenHash: sha256("demo-invitation-sora-2026"),
    invitedById: userIds.owner,
    expiresAt: timestamp("2026-11-24", "02:30:00"),
    acceptedAt: null,
    revokedAt: null,
    createdAt: timestamp("2026-11-17", "02:30:00"),
  },
];
