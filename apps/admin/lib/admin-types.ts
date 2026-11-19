import type {
  AdminMetrics,
  AuditLog,
  PlatformRole,
} from "@roamlog/contracts";

export type AdminConsoleRole = Exclude<PlatformRole, "user">;

export interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: AdminConsoleRole;
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

export { ADMIN_ROLE_LABELS } from "./labels";

export const ADMIN_CONSOLE_ROLES: AdminConsoleRole[] = [
  "support",
  "analyst",
  "admin",
  "super_admin",
];

export function isAdminConsoleRole(value: string): value is AdminConsoleRole {
  return ADMIN_CONSOLE_ROLES.includes(value as AdminConsoleRole);
}
