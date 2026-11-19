import { createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { User } from "@roamlog/contracts";
import type { Request } from "express";

import type { WorkspaceMembershipAccess } from "../services/workspace-access.service.js";

export interface AuthSessionContext {
  sessionId: string;
  userId: string;
  expiresAt: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: User;
  authSession?: AuthSessionContext;
  workspaceMembership?: WorkspaceMembershipAccess;
  /**
   * Effective platform actions resolved by `AdminGuard`. Admin services use it
   * for defense-in-depth assertions so the permission-matrix override layer
   * governs the inner check as well as the guard.
   */
  adminActions?: ReadonlySet<string>;
}

export interface AuthenticatedActor {
  user: User;
  ip: string | null;
  userAgent: string | null;
  /** Present only on Admin API requests that passed `AdminGuard`. */
  platformActions?: ReadonlySet<string>;
}

function requestIp(request: AuthenticatedRequest): string | null {
  const value = request.ip?.trim();
  return value ? value.slice(0, 64) : null;
}

function requestUserAgent(request: AuthenticatedRequest): string | null {
  const value = request.header("user-agent")?.trim();
  return value ? value.slice(0, 500) : null;
}

export function actorFromRequest(request: AuthenticatedRequest): AuthenticatedActor {
  if (!request.user) {
    throw new Error("Authenticated request is missing its user context");
  }
  return {
    user: request.user,
    ip: requestIp(request),
    userAgent: requestUserAgent(request),
    ...(request.adminActions ? { platformActions: request.adminActions } : {}),
  };
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedActor => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return actorFromRequest(request);
  },
);

export const CurrentWorkspaceMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WorkspaceMembershipAccess => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.workspaceMembership) {
      throw new Error("Workspace request is missing its membership context");
    }
    return request.workspaceMembership;
  },
);
