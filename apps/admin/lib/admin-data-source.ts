import type { AdminUserDetail, AdminWorkspaceDetail, AuditLog } from "@roamlog/contracts";

import {
  MOCK_AUDIT_LOGS,
  MOCK_ADMIN_DASHBOARD,
  MOCK_ADMIN_USERS,
  MOCK_ADMIN_WORKSPACES,
  type AdminDashboardData,
} from "./fixtures";
import {
  MOCK_ADMIN_CONTENT,
  MOCK_ADMIN_EMAILS,
  MOCK_ADMIN_FAILED_JOBS,
  MOCK_ADMIN_FLAGS,
  MOCK_ADMIN_MEDIA,
  MOCK_ADMIN_QUEUES,
  MOCK_ADMIN_SYSTEM,
  type AdminContentItem,
  type AdminEmailRecord,
  type AdminFailedJob,
  type AdminFlagRecord,
  type AdminMediaItem,
  type AdminQueueSummary,
  type AdminSystemSnapshot,
} from "./ops-fixtures";

export interface AdminDataSource {
  readonly mode: "fixture" | "msw";
  getDashboard(): AdminDashboardData;
  listUsers(): readonly AdminUserDetail[];
  listWorkspaces(): readonly AdminWorkspaceDetail[];
  listAuditLogs(): readonly AuditLog[];
  listContent(): readonly AdminContentItem[];
  listMedia(): readonly AdminMediaItem[];
  listEmails(): readonly AdminEmailRecord[];
  listQueues(): readonly AdminQueueSummary[];
  listFailedJobs(): readonly AdminFailedJob[];
  listFlags(): readonly AdminFlagRecord[];
  getSystem(): AdminSystemSnapshot;
}

export const fixtureAdminDataSource: AdminDataSource = {
  mode: "fixture",
  getDashboard: () => MOCK_ADMIN_DASHBOARD,
  listUsers: () => MOCK_ADMIN_USERS,
  listWorkspaces: () => MOCK_ADMIN_WORKSPACES,
  listAuditLogs: () => MOCK_AUDIT_LOGS,
  listContent: () => MOCK_ADMIN_CONTENT,
  listMedia: () => MOCK_ADMIN_MEDIA,
  listEmails: () => MOCK_ADMIN_EMAILS,
  listQueues: () => MOCK_ADMIN_QUEUES,
  listFailedJobs: () => MOCK_ADMIN_FAILED_JOBS,
  listFlags: () => MOCK_ADMIN_FLAGS,
  getSystem: () => MOCK_ADMIN_SYSTEM,
};

let activeAdminDataSource: AdminDataSource = fixtureAdminDataSource;

/**
 * Shared MSW fixtures are not ready in Wave 0. Admin views consume this single
 * adapter boundary; replacing it with a `@roamlog/api-mocks`-backed source must
 * not require page or table rewrites.
 */
export function getAdminDataSource(): AdminDataSource {
  return activeAdminDataSource;
}

export function configureAdminDataSource(source: AdminDataSource): void {
  activeAdminDataSource = source;
}
