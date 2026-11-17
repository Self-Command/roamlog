import type {
  AdminMetrics,
  AdminUserDetail,
  AdminWorkspaceDetail,
  AuditLog,
  PlatformRole,
} from "@roamlog/contracts";

export type AdminConsoleRole = Exclude<PlatformRole, "user">;

export interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: AdminConsoleRole;
  twoFactorEnabled: boolean;
  environment: "local" | "staging" | "production";
}

export interface AdminTrendPoint {
  period: string;
  users: number;
  workspaces: number;
}

export interface AdminQueueHealth {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
}

export interface AdminEmailHealth {
  queued: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
}

export interface AdminDashboardData {
  metrics: AdminMetrics;
  trend: AdminTrendPoint[];
  emailHealth: AdminEmailHealth;
  recentAudit: AuditLog[];
  generatedAt: string;
}

export interface AdminNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  tone: "neutral" | "yellow" | "red";
}

export const ADMIN_ROLE_LABELS: Record<AdminConsoleRole, string> = {
  support: "Support",
  analyst: "Analyst",
  admin: "Admin",
  super_admin: "Super admin",
};

export const ADMIN_CONSOLE_ROLES: AdminConsoleRole[] = [
  "support",
  "analyst",
  "admin",
  "super_admin",
];

export function isAdminConsoleRole(value: string): value is AdminConsoleRole {
  return ADMIN_CONSOLE_ROLES.includes(value as AdminConsoleRole);
}

export const DEFAULT_ADMIN_SESSION: AdminSession = {
  id: "0199a0c0-1000-7000-8000-000000000001",
  name: "林知夏",
  email: "lin.zhixia@roamlog.local",
  role: "support",
  twoFactorEnabled: true,
  environment: "local",
};

export const MOCK_ADMIN_USERS = [
  {
    id: "0199a0c1-1100-7000-8000-000000000001",
    email: "lin.zhixia@roamlog.local",
    emailVerified: true,
    name: "林知夏",
    image: null,
    platformRole: "support",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: "2026-11-17T08:42:00.000Z",
    createdAt: "2026-08-11T02:14:00.000Z",
    updatedAt: "2026-11-17T08:42:00.000Z",
    deletedAt: null,
    workspaceCount: 2,
    tripCount: 7,
    entryCount: 24,
    activeSessionCount: 2,
  },
  {
    id: "0199a0c1-1100-7000-8000-000000000002",
    email: "chen.mo@roamlog.local",
    emailVerified: true,
    name: "陈墨",
    image: null,
    platformRole: "admin",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: "2026-11-17T08:18:00.000Z",
    createdAt: "2026-06-03T09:30:00.000Z",
    updatedAt: "2026-11-17T08:18:00.000Z",
    deletedAt: null,
    workspaceCount: 4,
    tripCount: 12,
    entryCount: 58,
    activeSessionCount: 1,
  },
  {
    id: "0199a0c1-1100-7000-8000-000000000003",
    email: "zhou.yao@roamlog.local",
    emailVerified: true,
    name: "周遥",
    image: null,
    platformRole: "analyst",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: "2026-11-17T07:56:00.000Z",
    createdAt: "2026-09-21T05:12:00.000Z",
    updatedAt: "2026-11-17T07:56:00.000Z",
    deletedAt: null,
    workspaceCount: 1,
    tripCount: 3,
    entryCount: 9,
    activeSessionCount: 1,
  },
  {
    id: "0199a0c1-1100-7000-8000-000000000004",
    email: "shen.xingye@roamlog.local",
    emailVerified: true,
    name: "沈星野",
    image: null,
    platformRole: "super_admin",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: "2026-11-17T06:45:00.000Z",
    createdAt: "2026-04-08T01:20:00.000Z",
    updatedAt: "2026-11-17T06:45:00.000Z",
    deletedAt: null,
    workspaceCount: 3,
    tripCount: 18,
    entryCount: 71,
    activeSessionCount: 3,
  },
  {
    id: "0199a0c1-1100-7000-8000-000000000005",
    email: "jiang.yu@roamlog.local",
    emailVerified: false,
    name: "江屿",
    image: null,
    platformRole: "user",
    status: "suspended",
    locale: "zh-CN",
    timezone: "Asia/Manila",
    lastActiveAt: "2026-11-14T12:31:00.000Z",
    createdAt: "2026-10-02T03:48:00.000Z",
    updatedAt: "2026-11-16T10:05:00.000Z",
    deletedAt: null,
    workspaceCount: 2,
    tripCount: 4,
    entryCount: 11,
    activeSessionCount: 0,
  },
  {
    id: "0199a0c1-1100-7000-8000-000000000006",
    email: "su.he@roamlog.local",
    emailVerified: true,
    name: "苏禾",
    image: null,
    platformRole: "user",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Tokyo",
    lastActiveAt: "2026-11-17T01:12:00.000Z",
    createdAt: "2026-11-11T07:07:00.000Z",
    updatedAt: "2026-11-17T01:12:00.000Z",
    deletedAt: null,
    workspaceCount: 1,
    tripCount: 2,
    entryCount: 6,
    activeSessionCount: 1,
  },
] satisfies AdminUserDetail[];

function fixtureUser(index: number): AdminUserDetail {
  const user = MOCK_ADMIN_USERS[index];
  if (!user) {
    throw new Error(`Missing admin fixture user at index ${index}.`);
  }
  return user;
}

const FIXTURE_CHEN_MO = fixtureUser(1);
const FIXTURE_SHEN_XINGYE = fixtureUser(3);
const FIXTURE_JIANG_YU = fixtureUser(4);
const FIXTURE_SU_HE = fixtureUser(5);
const FIXTURE_LIN_ZHIXIA = fixtureUser(0);

export const MOCK_ADMIN_WORKSPACES = [
  {
    id: "0199a0c2-1200-7000-8000-000000000001",
    name: "Roamlog Crew",
    slug: "roamlog-crew",
    logoMediaId: null,
    ownerId: FIXTURE_CHEN_MO.id,
    plan: "team",
    status: "active",
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    weekStartsOn: 1,
    settings: {},
    createdAt: "2026-06-09T02:00:00.000Z",
    updatedAt: "2026-11-17T07:41:00.000Z",
    deletedAt: null,
    memberCount: 8,
    tripCount: 9,
    entryCount: 42,
    owner: {
      id: FIXTURE_CHEN_MO.id,
      name: FIXTURE_CHEN_MO.name,
      email: FIXTURE_CHEN_MO.email,
      image: null,
    },
  },
  {
    id: "0199a0c2-1200-7000-8000-000000000002",
    name: "海风与旧城",
    slug: "sea-and-old-town",
    logoMediaId: null,
    ownerId: FIXTURE_SU_HE.id,
    plan: "pro",
    status: "active",
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    weekStartsOn: 1,
    settings: { density: "compact" },
    createdAt: "2026-09-14T04:30:00.000Z",
    updatedAt: "2026-11-16T13:22:00.000Z",
    deletedAt: null,
    memberCount: 3,
    tripCount: 4,
    entryCount: 16,
    owner: {
      id: FIXTURE_SU_HE.id,
      name: FIXTURE_SU_HE.name,
      email: FIXTURE_SU_HE.email,
      image: null,
    },
  },
  {
    id: "0199a0c2-1200-7000-8000-000000000003",
    name: "Studio North",
    slug: "studio-north",
    logoMediaId: null,
    ownerId: FIXTURE_SHEN_XINGYE.id,
    plan: "team",
    status: "active",
    defaultCurrency: "EUR",
    timezone: "Europe/Lisbon",
    weekStartsOn: 0,
    settings: {},
    createdAt: "2026-07-19T11:11:00.000Z",
    updatedAt: "2026-11-15T17:08:00.000Z",
    deletedAt: null,
    memberCount: 12,
    tripCount: 6,
    entryCount: 31,
    owner: {
      id: FIXTURE_SHEN_XINGYE.id,
      name: FIXTURE_SHEN_XINGYE.name,
      email: FIXTURE_SHEN_XINGYE.email,
      image: null,
    },
  },
  {
    id: "0199a0c2-1200-7000-8000-000000000004",
    name: "山野档案",
    slug: "mountain-archive",
    logoMediaId: null,
    ownerId: FIXTURE_JIANG_YU.id,
    plan: "free",
    status: "suspended",
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    weekStartsOn: 1,
    settings: {},
    createdAt: "2026-10-05T08:22:00.000Z",
    updatedAt: "2026-11-16T10:05:00.000Z",
    deletedAt: null,
    memberCount: 2,
    tripCount: 2,
    entryCount: 4,
    owner: {
      id: FIXTURE_JIANG_YU.id,
      name: FIXTURE_JIANG_YU.name,
      email: FIXTURE_JIANG_YU.email,
      image: null,
    },
  },
] satisfies AdminWorkspaceDetail[];

function fixtureWorkspace(index: number): AdminWorkspaceDetail {
  const workspace = MOCK_ADMIN_WORKSPACES[index];
  if (!workspace) {
    throw new Error(`Missing admin fixture workspace at index ${index}.`);
  }
  return workspace;
}

const FIXTURE_ROAMLOG_CREW = fixtureWorkspace(0);
const FIXTURE_MOUNTAIN_ARCHIVE = fixtureWorkspace(3);

export const MOCK_AUDIT_LOGS = [
  {
    id: "0199a0c3-1300-7000-8000-000000000001",
    actorId: FIXTURE_CHEN_MO.id,
    actorType: "admin",
    action: "admin.user.suspend",
    targetType: "user",
    targetId: FIXTURE_JIANG_YU.id,
    workspaceId: null,
    ip: "10.10.2.14",
    userAgent: "Roamlog Admin / local fixture",
    metadata: { reason: "reported abuse", previousStatus: "active" },
    createdAt: "2026-11-17T08:03:00.000Z",
  },
  {
    id: "0199a0c3-1300-7000-8000-000000000002",
    actorId: FIXTURE_SHEN_XINGYE.id,
    actorType: "admin",
    action: "admin.flags.update",
    targetType: "feature_flag",
    targetId: "0199a0c3-1300-7000-8000-000000000099",
    workspaceId: null,
    ip: "10.10.2.18",
    userAgent: "Roamlog Admin / local fixture",
    metadata: { key: "share-password-v1", enabled: true, rolloutPercentage: 25 },
    createdAt: "2026-11-17T07:46:00.000Z",
  },
  {
    id: "0199a0c3-1300-7000-8000-000000000003",
    actorId: null,
    actorType: "system",
    action: "system.media.process",
    targetType: "media",
    targetId: "0199a0c3-1300-7000-8000-000000000098",
    workspaceId: FIXTURE_ROAMLOG_CREW.id,
    ip: null,
    userAgent: null,
    metadata: { durationMs: 1820, variants: 3, status: "ready" },
    createdAt: "2026-11-17T07:32:00.000Z",
  },
  {
    id: "0199a0c3-1300-7000-8000-000000000004",
    actorId: FIXTURE_LIN_ZHIXIA.id,
    actorType: "admin",
    action: "admin.email.resend",
    targetType: "email_log",
    targetId: "0199a0c3-1300-7000-8000-000000000097",
    workspaceId: null,
    ip: "10.10.2.11",
    userAgent: "Roamlog Admin / local fixture",
    metadata: { template: "workspace-invitation", recipient: "hello@example.invalid" },
    createdAt: "2026-11-17T07:14:00.000Z",
  },
  {
    id: "0199a0c3-1300-7000-8000-000000000005",
    actorId: FIXTURE_CHEN_MO.id,
    actorType: "admin",
    action: "admin.workspace.restore",
    targetType: "workspace",
    targetId: FIXTURE_MOUNTAIN_ARCHIVE.id,
    workspaceId: FIXTURE_MOUNTAIN_ARCHIVE.id,
    ip: "10.10.2.14",
    userAgent: "Roamlog Admin / local fixture",
    metadata: { previousStatus: "deleted" },
    createdAt: "2026-11-17T06:51:00.000Z",
  },
] satisfies AuditLog[];

export const MOCK_ADMIN_METRICS: AdminMetrics = {
  users: { total: 18420, active: 17302, suspended: 1118, new24h: 184 },
  workspaces: { total: 5914, active: 5631, suspended: 283, new24h: 62 },
  trips: 23891,
  entries: 94128,
  comments: 41705,
  media: { count: 318420, bytes: 824_633_190_400 },
  exports: { queued: 18, processing: 6, ready: 244, failed: 3, expired: 1120 },
  queues: [
    {
      name: "media-processing",
      waiting: 18,
      active: 4,
      failed: 1,
      completed: 14208,
      paused: false,
    },
    { name: "email-delivery", waiting: 6, active: 2, failed: 0, completed: 22814, paused: false },
    { name: "archive-export", waiting: 3, active: 1, failed: 2, completed: 1844, paused: false },
    { name: "trip-reminders", waiting: 42, active: 0, failed: 0, completed: 8120, paused: true },
  ],
  generatedAt: "2026-11-17T08:45:00.000Z",
};

export const MOCK_ADMIN_TREND: AdminTrendPoint[] = [
  { period: "11-06", users: 16680, workspaces: 5280 },
  { period: "11-07", users: 16812, workspaces: 5322 },
  { period: "11-08", users: 16970, workspaces: 5365 },
  { period: "11-09", users: 17006, workspaces: 5398 },
  { period: "11-10", users: 17184, workspaces: 5431 },
  { period: "11-11", users: 17452, workspaces: 5488 },
  { period: "11-12", users: 17630, workspaces: 5540 },
  { period: "11-13", users: 17845, workspaces: 5602 },
  { period: "11-14", users: 18010, workspaces: 5667 },
  { period: "11-15", users: 18156, workspaces: 5724 },
  { period: "11-16", users: 18236, workspaces: 5849 },
  { period: "11-17", users: 18420, workspaces: 5914 },
];

export const MOCK_ADMIN_EMAIL_HEALTH: AdminEmailHealth = {
  queued: 6,
  delivered: 126482,
  bounced: 184,
  complained: 12,
  failed: 9,
};

export const MOCK_ADMIN_DASHBOARD: AdminDashboardData = {
  metrics: MOCK_ADMIN_METRICS,
  trend: MOCK_ADMIN_TREND,
  emailHealth: MOCK_ADMIN_EMAIL_HEALTH,
  recentAudit: MOCK_AUDIT_LOGS,
  generatedAt: MOCK_ADMIN_METRICS.generatedAt,
};

export const MOCK_ADMIN_NOTIFICATIONS: AdminNotification[] = [
  {
    id: "notification-1",
    title: "队列失败率上升",
    body: "archive-export 在最近 15 分钟出现 2 次连续失败。",
    createdAt: "2026-11-17T08:39:00.000Z",
    read: false,
    tone: "red",
  },
  {
    id: "notification-2",
    title: "邮件退信需要复核",
    body: "有一条新退信与 workspace-invitation 模板相关。",
    createdAt: "2026-11-17T08:24:00.000Z",
    read: false,
    tone: "yellow",
  },
  {
    id: "notification-3",
    title: "媒体存储每日报告",
    body: "过去 24 小时新增 4.8 GB，仍在当日预算内。",
    createdAt: "2026-11-17T07:00:00.000Z",
    read: true,
    tone: "neutral",
  },
];
