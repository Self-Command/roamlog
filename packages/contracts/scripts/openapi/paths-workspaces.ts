import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

const InvitationTokenParamsSchema = z.object({
  token: z.string().min(16).max(256),
});

export function registerWorkspacePaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces",
    operationId: "createWorkspace",
    tag: "Workspaces",
    summary: "Create a Workspace",
    body: c.CreateWorkspaceRequestSchema,
    response: c.WorkspaceSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces",
    operationId: "listWorkspaces",
    tag: "Workspaces",
    summary: "List Workspaces for the current user",
    response: c.WorkspaceListResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}",
    operationId: "getWorkspace",
    tag: "Workspaces",
    summary: "Get one Workspace",
    params: c.WorkspaceParamsSchema,
    response: c.WorkspaceSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/workspaces/{workspaceId}",
    operationId: "updateWorkspace",
    tag: "Workspaces",
    summary: "Update Workspace settings",
    params: c.WorkspaceParamsSchema,
    body: c.UpdateWorkspaceRequestSchema,
    response: c.WorkspaceSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/workspaces/{workspaceId}",
    operationId: "deleteWorkspace",
    tag: "Workspaces",
    summary: "Soft-delete a Workspace",
    params: c.WorkspaceParamsSchema,
    status: 200,
    response: c.DeleteWorkspaceResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/members",
    operationId: "listWorkspaceMembers",
    tag: "Members",
    summary: "List Workspace members",
    params: c.WorkspaceParamsSchema,
    query: c.WorkspaceMemberQuerySchema,
    response: c.WorkspaceMemberPageSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/invitations",
    operationId: "inviteWorkspaceMember",
    tag: "Invitations",
    summary: "Invite a member to a Workspace",
    params: c.WorkspaceParamsSchema,
    body: c.InviteMemberRequestSchema,
    response: c.InvitationSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/invitations",
    operationId: "listWorkspaceInvitations",
    tag: "Invitations",
    summary: "List Workspace invitations",
    params: c.WorkspaceParamsSchema,
    query: c.InvitationListQuerySchema,
    response: c.InvitationPageSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/workspaces/{workspaceId}/invitations/{invitationId}",
    operationId: "revokeWorkspaceInvitation",
    tag: "Invitations",
    summary: "Revoke a Workspace invitation",
    params: c.InvitationParamsSchema,
    status: 200,
    response: c.RevokeInvitationResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/invitations/{token}/accept",
    operationId: "acceptInvitation",
    tag: "Invitations",
    summary: "Accept an invitation token",
    params: InvitationTokenParamsSchema,
    body: c.AcceptInvitationRequestSchema,
    status: 200,
    response: c.AcceptInvitationResponseSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/workspaces/{workspaceId}/members/{memberId}",
    operationId: "updateWorkspaceMember",
    tag: "Members",
    summary: "Change a member role or status",
    params: c.MemberParamsSchema,
    body: c.UpdateMemberRequestSchema,
    response: c.UpdateMemberResponseSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/workspaces/{workspaceId}/members/{memberId}",
    operationId: "removeWorkspaceMember",
    tag: "Members",
    summary: "Remove a member from a Workspace",
    params: c.MemberParamsSchema,
    status: 200,
    response: c.DeleteMemberResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/transfer-ownership",
    operationId: "transferWorkspaceOwnership",
    tag: "Members",
    summary: "Transfer Workspace ownership",
    params: c.WorkspaceParamsSchema,
    body: c.TransferOwnershipRequestSchema,
    status: 200,
    response: c.TransferOwnershipResponseSchema,
    errors: [400, 401, 403, 404, 409, 422, 429, 500],
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/audit",
    operationId: "listWorkspaceAudit",
    tag: "Members",
    summary: "List Workspace audit entries",
    params: c.WorkspaceParamsSchema,
    query: c.WorkspaceAuditQuerySchema,
    response: c.WorkspaceAuditPageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/activity",
    operationId: "listWorkspaceActivity",
    tag: "Workspaces",
    summary: "List Workspace activity",
    params: c.WorkspaceParamsSchema,
    query: c.WorkspaceActivityQuerySchema,
    response: c.WorkspaceActivityPageSchema,
  });
}
