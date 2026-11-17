import type { EmailStatus, MediaStatus, TripVisibility, WorkspaceRole } from "@roamlog/contracts";

export type ContentKind = "trip" | "entry" | "comment";
export type ContentModerationStatus = "published" | "flagged" | "deleted";

export interface AdminContentItem {
  id: string;
  kind: ContentKind;
  title: string;
  excerpt: string;
  workspaceId: string;
  workspaceName: string;
  authorName: string;
  visibility: TripVisibility;
  status: ContentModerationStatus;
  reportCount: number;
  createdAt: string;
  updatedAt: string;
  shareToken: string | null;
}

export interface AdminMediaItem {
  id: string;
  fileName: string;
  workspaceId: string;
  workspaceName: string;
  mimeType: string;
  sizeBytes: number;
  status: MediaStatus;
  usage: "linked" | "orphan";
  caption: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface AdminEmailRecord {
  id: string;
  to: string;
  template: string;
  subject: string;
  providerId: string | null;
  status: EmailStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminQueueSummary {
  name: string;
  label: string;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  throughputPerMinute: number;
  paused: boolean;
}

export interface AdminFailedJob {
  id: string;
  queue: string;
  name: string;
  attempts: number;
  failedReason: string;
  payloadSummary: string;
  createdAt: string;
  processedAt: string | null;
}

export interface AdminFlagRecord {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  workspaceAllowlist: string[];
  updatedByName: string;
  updatedAt: string;
}

export interface AdminSystemCheck {
  name: string;
  status: "up" | "degraded" | "down";
  latencyMs: number | null;
  detail: string;
}

export interface AdminMigration {
  version: string;
  name: string;
  appliedAt: string;
  status: "applied" | "pending";
}

export interface AdminSystemSnapshot {
  apiVersion: string;
  workerVersion: string;
  environment: "local" | "staging" | "production";
  nodeVersion: string;
  buildTime: string;
  startedAt: string;
  uptimeSeconds: number;
  workerStatus: "up" | "degraded" | "down";
  workerConsumers: number;
  checks: AdminSystemCheck[];
  migrations: AdminMigration[];
}

export interface AdminSessionRecord {
  id: string;
  device: string;
  ip: string;
  lastSeenAt: string;
  current: boolean;
}

export interface AdminUserMembership {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface AdminUserContext {
  userId: string;
  sessions: AdminSessionRecord[];
  memberships: AdminUserMembership[];
}

export interface AdminWorkspaceMemberRecord {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: "active" | "suspended";
}

export interface AdminWorkspaceTripRecord {
  id: string;
  title: string;
  status: "planning" | "active" | "completed";
  updatedAt: string;
}

export interface AdminWorkspaceContext {
  workspaceId: string;
  storageBytes: number;
  members: AdminWorkspaceMemberRecord[];
  recentTrips: AdminWorkspaceTripRecord[];
}

export const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  trip: "旅行",
  entry: "日志",
  comment: "评论",
};

export const CONTENT_STATUS_LABELS: Record<ContentModerationStatus, string> = {
  published: "已发布",
  flagged: "待审核",
  deleted: "已删除",
};

export const MOCK_ADMIN_CONTENT: AdminContentItem[] = [
  {
    id: "0199b0c0-2100-7000-8000-000000000001",
    kind: "trip",
    title: "冬季瀨戶內海跳岛",
    excerpt: "从高松出发的七天慢船路线，包含直岛与丰岛的住宿笔记。",
    workspaceId: "0199a0c2-1200-7000-8000-000000000001",
    workspaceName: "Roamlog Crew",
    authorName: "陈墨",
    visibility: "public_link",
    status: "published",
    reportCount: 0,
    createdAt: "2026-11-09T02:14:00.000Z",
    updatedAt: "2026-11-17T01:42:00.000Z",
    shareToken: "sh_7f4a2c91d0",
  },
  {
    id: "0199b0c0-2100-7000-8000-000000000002",
    kind: "entry",
    title: "在直岛等一班末班船",
    excerpt: "海风把晒干的衣服吹成一排旗子，我们在港口等到天色完全暗下来。",
    workspaceId: "0199a0c2-1200-7000-8000-000000000001",
    workspaceName: "Roamlog Crew",
    authorName: "苏禾",
    visibility: "workspace",
    status: "flagged",
    reportCount: 2,
    createdAt: "2026-11-15T10:08:00.000Z",
    updatedAt: "2026-11-16T12:34:00.000Z",
    shareToken: null,
  },
  {
    id: "0199b0c0-2100-7000-8000-000000000003",
    kind: "comment",
    title: "Re: 京都清晨的鸭川",
    excerpt: "这条评论包含疑似广告外链，已被两位成员举报。",
    workspaceId: "0199a0c2-1200-7000-8000-000000000002",
    workspaceName: "海风与旧城",
    authorName: "江屿",
    visibility: "workspace",
    status: "flagged",
    reportCount: 3,
    createdAt: "2026-11-16T03:21:00.000Z",
    updatedAt: "2026-11-16T03:21:00.000Z",
    shareToken: null,
  },
  {
    id: "0199b0c0-2100-7000-8000-000000000004",
    kind: "trip",
    title: "Studio North 里斯本驻留记录",
    excerpt: "三周的驻留工作与周末海岸线散步，含工作室内部分享。",
    workspaceId: "0199a0c2-1200-7000-8000-000000000003",
    workspaceName: "Studio North",
    authorName: "沈星野",
    visibility: "workspace",
    status: "published",
    reportCount: 0,
    createdAt: "2026-10-18T09:00:00.000Z",
    updatedAt: "2026-11-14T16:20:00.000Z",
    shareToken: null,
  },
  {
    id: "0199b0c0-2100-7000-8000-000000000005",
    kind: "entry",
    title: "山野档案 / 雨天的补给清单",
    excerpt: "一条已由作者删除的日志，保留用于验证恢复流程。",
    workspaceId: "0199a0c2-1200-7000-8000-000000000004",
    workspaceName: "山野档案",
    authorName: "江屿",
    visibility: "private",
    status: "deleted",
    reportCount: 0,
    createdAt: "2026-10-23T06:18:00.000Z",
    updatedAt: "2026-11-12T08:07:00.000Z",
    shareToken: null,
  },
  {
    id: "0199b0c0-2100-7000-8000-000000000006",
    kind: "comment",
    title: "Re: 山手线一日券值得吗",
    excerpt: "很实用的路线补充，建议把换乘时间写进正文。",
    workspaceId: "0199a0c2-1200-7000-8000-000000000002",
    workspaceName: "海风与旧城",
    authorName: "林知夏",
    visibility: "workspace",
    status: "published",
    reportCount: 0,
    createdAt: "2026-11-11T13:45:00.000Z",
    updatedAt: "2026-11-11T13:45:00.000Z",
    shareToken: null,
  },
];

export const MOCK_ADMIN_MEDIA: AdminMediaItem[] = [
  {
    id: "0199b0c1-2200-7000-8000-000000000001",
    fileName: "naoshima-pier-rain.jpg",
    workspaceId: "0199a0c2-1200-7000-8000-000000000001",
    workspaceName: "Roamlog Crew",
    mimeType: "image/jpeg",
    sizeBytes: 4_812_032,
    status: "ready",
    usage: "linked",
    caption: "直岛港口，雨停之前",
    createdAt: "2026-11-16T08:12:00.000Z",
    deletedAt: null,
  },
  {
    id: "0199b0c1-2200-7000-8000-000000000002",
    fileName: "lisbon-studio-window.jpg",
    workspaceId: "0199a0c2-1200-7000-8000-000000000003",
    workspaceName: "Studio North",
    mimeType: "image/jpeg",
    sizeBytes: 7_122_944,
    status: "ready",
    usage: "linked",
    caption: "驻留工作室的北窗",
    createdAt: "2026-11-13T05:40:00.000Z",
    deletedAt: null,
  },
  {
    id: "0199b0c1-2200-7000-8000-000000000003",
    fileName: "upload-9ac31.mp4",
    workspaceId: "0199a0c2-1200-7000-8000-000000000002",
    workspaceName: "海风与旧城",
    mimeType: "video/mp4",
    sizeBytes: 184_549_376,
    status: "processing",
    usage: "linked",
    caption: null,
    createdAt: "2026-11-17T07:02:00.000Z",
    deletedAt: null,
  },
  {
    id: "0199b0c1-2200-7000-8000-000000000004",
    fileName: "IMG_4402-orphan.jpg",
    workspaceId: "0199a0c2-1200-7000-8000-000000000001",
    workspaceName: "Roamlog Crew",
    mimeType: "image/jpeg",
    sizeBytes: 3_889_152,
    status: "ready",
    usage: "orphan",
    caption: null,
    createdAt: "2026-11-02T12:20:00.000Z",
    deletedAt: null,
  },
  {
    id: "0199b0c1-2200-7000-8000-000000000005",
    fileName: "mountain-scan-07.tiff",
    workspaceId: "0199a0c2-1200-7000-8000-000000000004",
    workspaceName: "山野档案",
    mimeType: "image/tiff",
    sizeBytes: 92_144_320,
    status: "failed",
    usage: "orphan",
    caption: null,
    createdAt: "2026-10-29T02:03:00.000Z",
    deletedAt: null,
  },
  {
    id: "0199b0c1-2200-7000-8000-000000000006",
    fileName: "old-avatar-2024.png",
    workspaceId: "0199a0c2-1200-7000-8000-000000000003",
    workspaceName: "Studio North",
    mimeType: "image/png",
    sizeBytes: 620_544,
    status: "ready",
    usage: "orphan",
    caption: null,
    createdAt: "2026-09-18T15:30:00.000Z",
    deletedAt: null,
  },
];

export const MOCK_ADMIN_EMAILS: AdminEmailRecord[] = [
  {
    id: "0199b0c2-2300-7000-8000-000000000001",
    to: "member.01@example.invalid",
    template: "workspace-invitation",
    subject: "邀请你加入 Roamlog Crew",
    providerId: "re_fixture_01",
    status: "delivered",
    error: null,
    createdAt: "2026-11-17T08:02:00.000Z",
    updatedAt: "2026-11-17T08:02:14.000Z",
  },
  {
    id: "0199b0c2-2300-7000-8000-000000000002",
    to: "jiang.yu@example.invalid",
    template: "email-verification",
    subject: "验证你的 Roamlog 邮箱",
    providerId: "re_fixture_02",
    status: "bounced",
    error: "550 mailbox unavailable",
    createdAt: "2026-11-17T07:40:00.000Z",
    updatedAt: "2026-11-17T07:40:31.000Z",
  },
  {
    id: "0199b0c2-2300-7000-8000-000000000003",
    to: "digest.optout@example.invalid",
    template: "weekly-digest",
    subject: "你本周的旅行记录",
    providerId: "re_fixture_03",
    status: "complained",
    error: "recipient marked as spam",
    createdAt: "2026-11-17T07:10:00.000Z",
    updatedAt: "2026-11-17T07:10:53.000Z",
  },
  {
    id: "0199b0c2-2300-7000-8000-000000000004",
    to: "export.ready@example.invalid",
    template: "export-ready",
    subject: "你的旅行档案已可下载",
    providerId: null,
    status: "queued",
    error: null,
    createdAt: "2026-11-17T08:36:00.000Z",
    updatedAt: "2026-11-17T08:36:00.000Z",
  },
  {
    id: "0199b0c2-2300-7000-8000-000000000005",
    to: "member.02@example.invalid",
    template: "comment-mention",
    subject: "陈墨在日志中提到了你",
    providerId: "re_fixture_05",
    status: "failed",
    error: "provider timeout",
    createdAt: "2026-11-16T12:01:00.000Z",
    updatedAt: "2026-11-16T12:01:42.000Z",
  },
  {
    id: "0199b0c2-2300-7000-8000-000000000006",
    to: "member.03@example.invalid",
    template: "workspace-invitation",
    subject: "邀请你加入 海风与旧城",
    providerId: "re_fixture_06",
    status: "sent",
    error: null,
    createdAt: "2026-11-16T09:30:00.000Z",
    updatedAt: "2026-11-16T09:30:05.000Z",
  },
];

export const MOCK_ADMIN_QUEUES: AdminQueueSummary[] = [
  {
    name: "media-processing",
    label: "媒体处理",
    waiting: 18,
    active: 4,
    failed: 1,
    completed: 14_208,
    throughputPerMinute: 12.4,
    paused: false,
  },
  {
    name: "email-delivery",
    label: "邮件发送",
    waiting: 6,
    active: 2,
    failed: 2,
    completed: 22_814,
    throughputPerMinute: 8.1,
    paused: false,
  },
  {
    name: "archive-export",
    label: "档案导出",
    waiting: 3,
    active: 1,
    failed: 3,
    completed: 1_844,
    throughputPerMinute: 0.7,
    paused: false,
  },
  {
    name: "trip-reminders",
    label: "行程提醒",
    waiting: 42,
    active: 0,
    failed: 0,
    completed: 8_120,
    throughputPerMinute: 3.6,
    paused: true,
  },
];

export const MOCK_ADMIN_FAILED_JOBS: AdminFailedJob[] = [
  {
    id: "job-export-7781",
    queue: "archive-export",
    name: "assemble-workspace-export",
    attempts: 4,
    failedReason: "S3 multipart upload timed out after 3 retries. Last accepted part: 17/28.",
    payloadSummary: "workspace=studio-north, scope=workspace, includeMedia=true",
    createdAt: "2026-11-17T08:12:00.000Z",
    processedAt: "2026-11-17T08:24:00.000Z",
  },
  {
    id: "job-export-7790",
    queue: "archive-export",
    name: "assemble-trip-export",
    attempts: 5,
    failedReason: "Worker marked dead after 5 attempts: archive checksum mismatch.",
    payloadSummary: "trip=trip-seto, scope=trip, format=zip",
    createdAt: "2026-11-17T07:51:00.000Z",
    processedAt: "2026-11-17T08:05:00.000Z",
  },
  {
    id: "job-email-9912",
    queue: "email-delivery",
    name: "deliver-template",
    attempts: 3,
    failedReason: "Resend provider timeout while submitting workspace-invitation.",
    payloadSummary: "template=workspace-invitation, recipient=member.02@example.invalid",
    createdAt: "2026-11-17T07:32:00.000Z",
    processedAt: "2026-11-17T07:38:00.000Z",
  },
  {
    id: "job-media-2204",
    queue: "media-processing",
    name: "generate-image-variants",
    attempts: 2,
    failedReason: "sharp: unsupported input format for tiff variant generation.",
    payloadSummary: "media=mountain-scan-07.tiff, workspace=mountain-archive",
    createdAt: "2026-11-17T06:44:00.000Z",
    processedAt: "2026-11-17T06:46:00.000Z",
  },
];

export const MOCK_ADMIN_FLAGS: AdminFlagRecord[] = [
  {
    key: "share-password-v1",
    label: "分享密码保护",
    description: "允许旅行公开分享链接设置密码与过期时间。",
    enabled: true,
    rolloutPercentage: 25,
    workspaceAllowlist: ["0199a0c2-1200-7000-8000-000000000001"],
    updatedByName: "沈星野",
    updatedAt: "2026-11-17T07:46:00.000Z",
  },
  {
    key: "realtime-presence",
    label: "实时在线状态",
    description: "在旅行与日志页面显示协作者在线头像。",
    enabled: true,
    rolloutPercentage: 100,
    workspaceAllowlist: [],
    updatedByName: "陈墨",
    updatedAt: "2026-11-15T04:26:00.000Z",
  },
  {
    key: "map-style-dark-v2",
    label: "新版深色地图",
    description: "启用 MapLibre 深色地图样式与新的路线光晕。",
    enabled: false,
    rolloutPercentage: 0,
    workspaceAllowlist: [],
    updatedByName: "沈星野",
    updatedAt: "2026-11-12T11:08:00.000Z",
  },
  {
    key: "export-json-v2",
    label: "JSON 导出 v2",
    description: "新的 ZIP/JSON 目录结构与媒体清单。",
    enabled: true,
    rolloutPercentage: 60,
    workspaceAllowlist: [
      "0199a0c2-1200-7000-8000-000000000003",
      "0199a0c2-1200-7000-8000-000000000004",
    ],
    updatedByName: "沈星野",
    updatedAt: "2026-11-16T03:42:00.000Z",
  },
];

export const MOCK_ADMIN_SYSTEM: AdminSystemSnapshot = {
  apiVersion: "1.0.0-rc.1",
  workerVersion: "1.0.0-rc.1",
  environment: "local",
  nodeVersion: "24.4.1",
  buildTime: "2026-11-17T08:31:00.000Z",
  startedAt: "2026-11-17T01:12:00.000Z",
  uptimeSeconds: 27_420,
  workerStatus: "up",
  workerConsumers: 5,
  checks: [
    {
      name: "PostgreSQL",
      status: "up",
      latencyMs: 4,
      detail: "roamlog / primary / pool 12/20",
    },
    {
      name: "Redis",
      status: "up",
      latencyMs: 2,
      detail: "prefix roamlog / maxRetriesPerRequest null",
    },
    {
      name: "S3 / MinIO",
      status: "degraded",
      latencyMs: 188,
      detail: "bucket roamlog-local / one slow HEAD request",
    },
    {
      name: "Resend",
      status: "up",
      latencyMs: 96,
      detail: "webhook last event 3m ago",
    },
  ],
  migrations: [
    {
      version: "0001_init",
      name: "initial schema",
      appliedAt: "2026-11-10T02:11:00.000Z",
      status: "applied",
    },
    {
      version: "0002_media_variants",
      name: "media variants index",
      appliedAt: "2026-11-14T06:35:00.000Z",
      status: "applied",
    },
    {
      version: "0003_export_cleanup",
      name: "export expiry index",
      appliedAt: "2026-11-16T09:20:00.000Z",
      status: "applied",
    },
  ],
};

export const MOCK_ADMIN_USER_CONTEXTS: Record<string, AdminUserContext> = {
  "0199a0c1-1100-7000-8000-000000000001": {
    userId: "0199a0c1-1100-7000-8000-000000000001",
    sessions: [
      {
        id: "sess-lin-01",
        device: "Chrome / macOS",
        ip: "10.10.2.11",
        lastSeenAt: "2026-11-17T08:42:00.000Z",
        current: true,
      },
      {
        id: "sess-lin-02",
        device: "Safari / iPhone",
        ip: "10.10.2.89",
        lastSeenAt: "2026-11-16T13:08:00.000Z",
        current: false,
      },
    ],
    memberships: [
      {
        workspaceId: "0199a0c2-1200-7000-8000-000000000001",
        workspaceName: "Roamlog Crew",
        role: "editor",
        joinedAt: "2026-08-12T03:10:00.000Z",
      },
      {
        workspaceId: "0199a0c2-1200-7000-8000-000000000002",
        workspaceName: "海风与旧城",
        role: "viewer",
        joinedAt: "2026-10-02T05:00:00.000Z",
      },
    ],
  },
  "0199a0c1-1100-7000-8000-000000000002": {
    userId: "0199a0c1-1100-7000-8000-000000000002",
    sessions: [
      {
        id: "sess-chen-01",
        device: "Chrome / Windows",
        ip: "10.10.2.14",
        lastSeenAt: "2026-11-17T08:18:00.000Z",
        current: true,
      },
    ],
    memberships: [
      {
        workspaceId: "0199a0c2-1200-7000-8000-000000000001",
        workspaceName: "Roamlog Crew",
        role: "owner",
        joinedAt: "2026-06-09T02:00:00.000Z",
      },
    ],
  },
  "0199a0c1-1100-7000-8000-000000000004": {
    userId: "0199a0c1-1100-7000-8000-000000000004",
    sessions: [
      {
        id: "sess-shen-01",
        device: "Firefox / Linux",
        ip: "10.10.2.18",
        lastSeenAt: "2026-11-17T06:45:00.000Z",
        current: false,
      },
    ],
    memberships: [
      {
        workspaceId: "0199a0c2-1200-7000-8000-000000000003",
        workspaceName: "Studio North",
        role: "owner",
        joinedAt: "2026-07-19T11:11:00.000Z",
      },
    ],
  },
};

export const MOCK_ADMIN_WORKSPACE_CONTEXTS: Record<string, AdminWorkspaceContext> = {
  "0199a0c2-1200-7000-8000-000000000001": {
    workspaceId: "0199a0c2-1200-7000-8000-000000000001",
    storageBytes: 38_442_188_800,
    members: [
      {
        userId: "0199a0c1-1100-7000-8000-000000000002",
        name: "陈墨",
        email: "chen.mo@roamlog.local",
        role: "owner",
        status: "active",
      },
      {
        userId: "0199a0c1-1100-7000-8000-000000000001",
        name: "林知夏",
        email: "lin.zhixia@roamlog.local",
        role: "editor",
        status: "active",
      },
      {
        userId: "0199a0c1-1100-7000-8000-000000000006",
        name: "苏禾",
        email: "su.he@roamlog.local",
        role: "viewer",
        status: "active",
      },
    ],
    recentTrips: [
      {
        id: "trip-seto",
        title: "冬季瀨戶內海跳岛",
        status: "completed",
        updatedAt: "2026-11-17T01:42:00.000Z",
      },
      {
        id: "trip-kyoto",
        title: "京都清晨的鸭川",
        status: "active",
        updatedAt: "2026-11-15T16:10:00.000Z",
      },
    ],
  },
  "0199a0c2-1200-7000-8000-000000000003": {
    workspaceId: "0199a0c2-1200-7000-8000-000000000003",
    storageBytes: 182_536_192_000,
    members: [
      {
        userId: "0199a0c1-1100-7000-8000-000000000004",
        name: "沈星野",
        email: "shen.xingye@roamlog.local",
        role: "owner",
        status: "active",
      },
      {
        userId: "0199a0c1-1100-7000-8000-000000000003",
        name: "周遥",
        email: "zhou.yao@roamlog.local",
        role: "admin",
        status: "active",
      },
    ],
    recentTrips: [
      {
        id: "trip-lisbon",
        title: "Studio North 里斯本驻留记录",
        status: "planning",
        updatedAt: "2026-11-14T16:20:00.000Z",
      },
    ],
  },
};

export function getUserContext(userId: string): AdminUserContext {
  return (
    MOCK_ADMIN_USER_CONTEXTS[userId] ?? {
      userId,
      sessions: [],
      memberships: [],
    }
  );
}

export function getWorkspaceContext(workspaceId: string): AdminWorkspaceContext {
  return (
    MOCK_ADMIN_WORKSPACE_CONTEXTS[workspaceId] ?? {
      workspaceId,
      storageBytes: 0,
      members: [],
      recentTrips: [],
    }
  );
}

export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  return `${hours} 小时 ${minutes} 分`;
}
