import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

export function registerAdminPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/metrics",
    operationId: "getAdminMetrics",
    tag: "Admin",
    summary: "Get platform metrics",
    response: c.AdminMetricsSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/users",
    operationId: "listAdminUsers",
    tag: "Admin",
    summary: "List platform users",
    query: c.AdminUserQuerySchema,
    response: c.AdminUserPageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/users/{id}",
    operationId: "getAdminUser",
    tag: "Admin",
    summary: "Get a platform user",
    params: c.AdminIdParamsSchema,
    response: c.AdminUserDetailSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/admin/users/{id}",
    operationId: "updateAdminUser",
    tag: "Admin",
    summary: "Update user status or platform role",
    params: c.AdminIdParamsSchema,
    body: c.UpdateAdminUserRequestSchema,
    response: c.AdminUserDetailSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/users/{id}/force-logout",
    operationId: "forceLogoutAdminUser",
    tag: "Admin",
    summary: "Force-logout a user",
    params: c.AdminIdParamsSchema,
    status: 200,
    response: c.ForceLogoutResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/users/{id}/reset-2fa",
    operationId: "resetAdminUserTwoFactor",
    tag: "Admin",
    summary: "Reset a user's TOTP two-factor enrollment",
    params: c.AdminIdParamsSchema,
    status: 200,
    response: c.ResetTwoFactorResponseSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/admin/users/{id}",
    operationId: "deleteAdminUser",
    tag: "Admin",
    summary: "Soft-delete a user",
    params: c.AdminIdParamsSchema,
    status: 200,
    response: c.AdminDeleteResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/users/export",
    operationId: "exportAdminUsersCsv",
    tag: "Admin",
    summary: "Export filtered platform users as CSV",
    description:
      "Returns a UTF-8 CSV attachment with columns: id, email, emailVerified, name, platformRole, status, createdAt, lastActiveAt, deletedAt.",
    query: c.AdminUserExportQuerySchema,
    response: c.AdminUserCsvResponseSchema,
    responseContentType: "text/csv",
    responseDescription: "Platform user CSV attachment.",
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/workspaces",
    operationId: "listAdminWorkspaces",
    tag: "Admin",
    summary: "List platform Workspaces",
    query: c.AdminWorkspaceQuerySchema,
    response: c.AdminWorkspacePageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/workspaces/{id}",
    operationId: "getAdminWorkspace",
    tag: "Admin",
    summary: "Get a platform Workspace",
    params: c.AdminIdParamsSchema,
    response: c.AdminWorkspaceDetailSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/admin/workspaces/{id}",
    operationId: "updateAdminWorkspace",
    tag: "Admin",
    summary: "Update Workspace status, plan, or ownership",
    params: c.AdminIdParamsSchema,
    body: c.UpdateAdminWorkspaceRequestSchema,
    response: c.AdminWorkspaceDetailSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/admin/workspaces/{id}",
    operationId: "deleteAdminWorkspace",
    tag: "Admin",
    summary: "Soft-delete a Workspace",
    params: c.AdminIdParamsSchema,
    status: 200,
    response: c.AdminDeleteResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/workspaces/export",
    operationId: "exportAdminWorkspacesCsv",
    tag: "Admin",
    summary: "Export filtered platform Workspaces as CSV",
    description:
      "Returns a UTF-8 CSV attachment with columns: id, name, slug, ownerId, plan, status, defaultCurrency, timezone, memberCount, tripCount, entryCount, mediaBytes, createdAt, updatedAt, deletedAt.",
    query: c.AdminWorkspaceExportQuerySchema,
    response: c.AdminWorkspaceCsvResponseSchema,
    responseContentType: "text/csv",
    responseDescription: "Platform Workspace CSV attachment.",
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/trips",
    operationId: "listAdminTrips",
    tag: "Admin",
    summary: "List trips for moderation",
    query: c.AdminContentQuerySchema,
    response: c.AdminTripPageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/entries",
    operationId: "listAdminEntries",
    tag: "Admin",
    summary: "List journal entries for moderation",
    query: c.AdminContentQuerySchema,
    response: c.AdminEntryPageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/comments",
    operationId: "listAdminComments",
    tag: "Admin",
    summary: "List comments for moderation",
    query: c.AdminContentQuerySchema,
    response: c.AdminCommentPageSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/admin/content/{type}/{id}",
    operationId: "deleteAdminContent",
    tag: "Admin",
    summary: "Remove content from public and member views",
    params: c.AdminContentParamsSchema,
    status: 200,
    response: c.AdminContentRestoreResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/content/{type}/{id}/restore",
    operationId: "restoreAdminContent",
    tag: "Admin",
    summary: "Restore moderated content",
    params: c.AdminContentParamsSchema,
    status: 200,
    response: c.AdminContentRestoreResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/media",
    operationId: "listAdminMedia",
    tag: "Admin",
    summary: "List media for moderation",
    query: c.AdminMediaQuerySchema,
    response: c.AdminMediaPageSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/admin/media/{id}",
    operationId: "deleteAdminMedia",
    tag: "Admin",
    summary: "Remove a media object",
    params: c.AdminIdParamsSchema,
    status: 200,
    response: c.AdminDeleteResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/audit",
    operationId: "listAdminAudit",
    tag: "Admin",
    summary: "List platform audit logs",
    query: c.AdminAuditQuerySchema,
    response: c.AdminAuditPageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/audit/export",
    operationId: "exportAdminAuditCsv",
    tag: "Admin",
    summary: "Export filtered platform audit logs as CSV",
    description:
      "Returns a UTF-8 CSV attachment with columns: id, createdAt, actorType, actorId, action, targetType, targetId, workspaceId, ip, userAgent, metadata.",
    query: c.AdminAuditExportQuerySchema,
    response: c.AdminAuditCsvResponseSchema,
    responseContentType: "text/csv",
    responseDescription: "Audit log CSV attachment.",
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/flags",
    operationId: "listAdminFlags",
    tag: "Admin",
    summary: "List feature flags",
    response: c.AdminFlagListResponseSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/admin/flags/{key}",
    operationId: "updateAdminFlag",
    tag: "Admin",
    summary: "Update a feature flag",
    params: c.AdminFlagParamsSchema,
    body: c.UpdateFeatureFlagRequestSchema,
    response: c.FeatureFlagSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/emails",
    operationId: "listAdminEmails",
    tag: "Admin",
    summary: "List email delivery logs",
    query: c.AdminEmailQuerySchema,
    response: c.AdminEmailPageSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/emails/{id}/resend",
    operationId: "resendAdminEmail",
    tag: "Admin",
    summary: "Resend a transactional email",
    params: c.AdminIdParamsSchema,
    status: 200,
    idempotent: true,
    response: c.ResendEmailResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/jobs",
    operationId: "listAdminJobs",
    tag: "Admin",
    summary: "List queue jobs",
    query: c.AdminJobQuerySchema,
    response: c.AdminJobPageSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/jobs/{queue}/{jobId}/retry",
    operationId: "retryAdminJob",
    tag: "Admin",
    summary: "Retry a failed queue job",
    params: c.AdminJobParamsSchema,
    status: 200,
    response: c.RetryJobResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/jobs/{queue}/pause",
    operationId: "pauseAdminQueue",
    tag: "Admin",
    summary: "Pause a BullMQ queue",
    params: c.AdminQueueParamsSchema,
    status: 200,
    response: c.PauseAdminQueueResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/jobs/{queue}/resume",
    operationId: "resumeAdminQueue",
    tag: "Admin",
    summary: "Resume a BullMQ queue",
    params: c.AdminQueueParamsSchema,
    status: 200,
    response: c.ResumeAdminQueueResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/jobs/{queue}/clear",
    operationId: "clearAdminQueue",
    tag: "Admin",
    summary: "Clear failed jobs from a BullMQ queue",
    description: "Permanently removes failed jobs while preserving waiting and active jobs.",
    params: c.AdminQueueParamsSchema,
    status: 200,
    response: c.ClearAdminQueueResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/system",
    operationId: "getAdminSystem",
    tag: "Admin",
    summary: "Get system health and queue state",
    response: c.AdminSystemSchema,
  });
}
