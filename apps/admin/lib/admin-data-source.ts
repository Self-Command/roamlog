import type { AdminUserDetail, AdminWorkspaceDetail, AuditLog } from "@roamlog/contracts";

import {
  MOCK_AUDIT_LOGS,
  MOCK_ADMIN_DASHBOARD,
  MOCK_ADMIN_USERS,
  MOCK_ADMIN_WORKSPACES,
  type AdminDashboardData,
} from "./fixtures";

export interface AdminDataSource {
  readonly mode: "fixture" | "msw";
  getDashboard(): AdminDashboardData;
  listUsers(): readonly AdminUserDetail[];
  listWorkspaces(): readonly AdminWorkspaceDetail[];
  listAuditLogs(): readonly AuditLog[];
}

export const fixtureAdminDataSource: AdminDataSource = {
  mode: "fixture",
  getDashboard: () => MOCK_ADMIN_DASHBOARD,
  listUsers: () => MOCK_ADMIN_USERS,
  listWorkspaces: () => MOCK_ADMIN_WORKSPACES,
  listAuditLogs: () => MOCK_AUDIT_LOGS,
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
