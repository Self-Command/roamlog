import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { RolesGuard } from "../guards/roles.guard.js";
import { SessionGuard } from "../guards/session.guard.js";
import { TenantGuard } from "../guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../guards/verified-email.guard.js";
import type { WorkspaceMembershipAccess } from "../services/workspace-access.service.js";
import {
  makeUserRecord,
  USER_ADMIN_ID,
  USER_OWNER_ID,
  USER_VIEWER_ID,
  WORKSPACE_A_ID,
  WORKSPACE_B_ID,
} from "../../../test/identity-fixtures.js";

function contextFor(
  overrides: Record<string, unknown> = {},
  permission?: { action: string; resource: string },
): ExecutionContext {
  const request = {
    headers: { cookie: "roamlog.session_token=test" },
    params: { workspaceId: WORKSPACE_A_ID },
    ip: "127.0.0.1",
    ...overrides,
  };
  const handler = function protectedHandler(): void {};
  if (permission) {
    Reflect.defineMetadata("roamlog:permission", permission, handler);
  }
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => handler,
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function membership(role: WorkspaceMembershipAccess["role"]): WorkspaceMembershipAccess {
  return {
    id: `01942f30-1200-7000-8000-${role === "owner" ? "000000000201" : "000000000204"}`,
    workspaceId: WORKSPACE_A_ID,
    userId: USER_OWNER_ID,
    role,
    status: "active",
    joinedAt: new Date("2026-11-17T08:00:00.000Z"),
    invitedById: null,
    createdAt: new Date("2026-11-17T08:00:00.000Z"),
    updatedAt: new Date("2026-11-17T08:00:00.000Z"),
    workspaceName: "Atlas Studio",
  };
}

describe("SessionGuard and tenant guards", () => {
  function setup(user: Record<string, unknown> | null = makeUserRecord()) {
    const auth = {
      resolveSession: vi
        .fn()
        .mockResolvedValue(
          user ? { sessionId: "01942f30-1200-7000-8000-000000000401", userId: user.id } : null,
        ),
    };
    const prisma = {
      client: {
        user: {
          findUnique: vi.fn().mockResolvedValue(user),
        },
      },
    };
    const access = {
      requireMembership: vi.fn().mockResolvedValue(membership("viewer")),
    };
    const tripParticipantRole = { canActivate: vi.fn().mockResolvedValue(true) };
    return {
      auth,
      prisma,
      access,
      tripParticipantRole,
      session: new SessionGuard(auth as never, prisma as never),
      verified: new VerifiedEmailGuard(),
    };
  }

  it("rejects requests without a Better Auth session", async () => {
    const { session } = setup(null);
    await expect(session.canActivate(contextFor())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects unverified users before protected product actions", async () => {
    const { session, verified } = setup(makeUserRecord(USER_OWNER_ID, { emailVerified: false }));
    const context = contextFor();
    await session.canActivate(context);
    expect(() => verified.canActivate(context)).toThrow(ForbiddenException);
  });

  it("returns 404 when a valid Workspace UUID belongs to another tenant", async () => {
    const { session, access, tripParticipantRole } = setup();
    access.requireMembership.mockRejectedValueOnce(
      new NotFoundException({ code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" }),
    );
    const tenant = new TenantGuard(
      session,
      new VerifiedEmailGuard(),
      access as never,
      tripParticipantRole as never,
    );

    await expect(
      tenant.canActivate(contextFor({ params: { workspaceId: WORKSPACE_B_ID } })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("blocks a Viewer from writing through RolesGuard", async () => {
    const { session, access, tripParticipantRole } = setup(makeUserRecord(USER_VIEWER_ID));
    access.requireMembership.mockResolvedValue(membership("viewer"));
    const tenant = new TenantGuard(
      session,
      new VerifiedEmailGuard(),
      access as never,
      tripParticipantRole as never,
    );
    const roles = new RolesGuard();
    const context = contextFor({}, { action: "workspace:update", resource: "workspace" });

    await tenant.canActivate(context);
    expect(() => roles.canActivate(context)).toThrow(ForbiddenException);
  });

  it("allows an Admin to update Workspace settings but not transfer ownership", async () => {
    const { session, access, tripParticipantRole } = setup(makeUserRecord(USER_ADMIN_ID));
    access.requireMembership.mockResolvedValue(membership("admin"));
    const tenant = new TenantGuard(
      session,
      new VerifiedEmailGuard(),
      access as never,
      tripParticipantRole as never,
    );
    const roles = new RolesGuard();

    const updateContext = contextFor({}, { action: "workspace:update", resource: "workspace" });
    await tenant.canActivate(updateContext);
    expect(roles.canActivate(updateContext)).toBe(true);

    const transferContext = contextFor(
      {},
      { action: "workspace:transfer-ownership", resource: "workspace" },
    );
    await tenant.canActivate(transferContext);
    expect(() => roles.canActivate(transferContext)).toThrow(ForbiddenException);
  });
});
