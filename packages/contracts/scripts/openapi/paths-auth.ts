import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

export function registerAuthPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/auth/{path}",
    operationId: "authGetHandler",
    tag: "Auth",
    summary: "Handle Better Auth GET routes",
    description:
      "Catch-all for Better Auth handlers: OAuth callbacks, verification links, session reads, and password reset redirects.",
    params: c.AuthHandlerParamsSchema,
    response: c.AuthHandlerResponseSchema,
    public: true,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/auth/{path}",
    operationId: "authPostHandler",
    tag: "Auth",
    summary: "Handle Better Auth POST routes",
    description:
      "Catch-all for Better Auth handlers: registration, login, OAuth start, verification, password reset, and 2FA.",
    params: c.AuthHandlerParamsSchema,
    body: c.AuthHandlerRequestSchema,
    response: c.AuthHandlerResponseSchema,
    public: true,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/me",
    operationId: "getMe",
    tag: "Me",
    summary: "Get the current user profile",
    response: c.MeResponseSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/me",
    operationId: "updateMe",
    tag: "Me",
    summary: "Update the current user profile",
    body: c.UpdateMeRequestSchema,
    response: c.MeResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/me/appearance",
    operationId: "getMyAppearance",
    tag: "Me",
    summary: "Get the current user's resolved appearance",
    response: c.ResolvedAppearanceSchema,
    errors: [401, 403, 500],
  });
  registerOperation(registry, {
    method: "put",
    path: "/v1/me/appearance",
    operationId: "updateMyAppearance",
    tag: "Me",
    summary: "Update the current user's appearance overrides",
    body: c.UpdateAppearancePreferenceSchema,
    status: 200,
    response: c.ResolvedAppearanceSchema,
    errors: [400, 401, 403, 422, 500],
    idempotent: true,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/me/appearance",
    operationId: "resetMyAppearance",
    tag: "Me",
    summary: "Reset the current user's appearance overrides",
    status: 200,
    response: c.ResolvedAppearanceSchema,
    errors: [401, 403, 500],
    idempotent: true,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/me/workspaces",
    operationId: "listMyWorkspaces",
    tag: "Me",
    summary: "List Workspaces available to the current user",
    response: c.MyWorkspacesResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/me/notifications",
    operationId: "listMyNotifications",
    tag: "Me",
    summary: "List the current user's notifications",
    query: c.MyNotificationsQuerySchema,
    response: c.NotificationPageSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/me/notifications/{id}/read",
    operationId: "markNotificationRead",
    tag: "Me",
    summary: "Mark one notification as read",
    params: c.NotificationParamsSchema,
    response: c.MarkNotificationReadResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/me/notifications/read-all",
    operationId: "markAllNotificationsRead",
    tag: "Me",
    summary: "Mark all notifications as read",
    status: 200,
    response: c.ReadAllNotificationsResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/me/notification-preferences",
    operationId: "getNotificationPreferences",
    tag: "Me",
    summary: "List notification preferences",
    response: c.NotificationPreferencesResponseSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/me/notification-preferences",
    operationId: "updateNotificationPreferences",
    tag: "Me",
    summary: "Update notification preferences",
    body: c.UpdateNotificationPreferencesRequestSchema,
    response: c.NotificationPreferencesResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/me/sessions",
    operationId: "listMySessions",
    tag: "Me",
    summary: "List active sessions",
    response: c.SessionListResponseSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/me/sessions/{id}",
    operationId: "revokeMySession",
    tag: "Me",
    summary: "Revoke one of the current user's sessions",
    params: c.SessionParamsSchema,
    status: 200,
    response: c.MessageResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/me/export",
    operationId: "exportMyAccount",
    tag: "Me",
    summary: "Queue an account export",
    body: c.CreateAccountExportRequestSchema,
    status: 202,
    response: c.ExportSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/me",
    operationId: "deleteMyAccount",
    tag: "Me",
    summary: "Request deletion of the current account",
    body: c.DeleteMeRequestSchema,
    status: 200,
    response: c.DeleteMeResponseSchema,
  });
}
