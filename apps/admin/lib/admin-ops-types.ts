import type { EmailStatus, MediaStatus, TripVisibility } from "@roamlog/contracts";

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

export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  return `${hours} 小时 ${minutes} 分`;
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

