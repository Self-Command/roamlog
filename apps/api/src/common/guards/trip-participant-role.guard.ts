import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { UuidV7Schema } from "@roamlog/contracts";

import { PrismaService } from "../../modules/prisma/prisma.service.js";
import type { AuthenticatedRequest } from "./actor-context.js";

/**
 * Resolves the actor's *effective* role for trip-scoped requests.
 *
 * Workspace permissions are keyed on `WorkspaceMembershipAccess.role`, but a
 * Workspace `viewer` may be promoted to `editor` for one specific trip through
 * `TripParticipant.role`. This guard runs after `TenantGuard` has resolved
 * `request.workspaceMembership` and, when the route carries a `:tripId` param,
 * replaces that membership with a new object whose `role` is `"editor"`.
 *
 * Replacing the object (never mutating the original) is what makes the existing
 * `PermissionService.assertCan(membership.role, ...)` call sites — and the
 * `RolesGuard` that runs before the controller — honour the promotion without
 * touching any of them.
 *
 * Safety properties:
 * - Routes without `:tripId` pass through untouched (workspace-level routes).
 * - Only a Workspace `viewer` can be upgraded; owner/admin/editor keep their
 *   base role and existing behaviour.
 * - The participant row is matched together with `trip.workspaceId`, so a
 *   participant row from another trip or another Workspace cannot widen access.
 * - A missing row or a failed lookup keeps the base role and never throws; the
 *   business layer keeps owning the 404/403 semantics.
 */
@Injectable()
export class TripParticipantRoleGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tripId = request.params?.tripId;
    const membership = request.workspaceMembership;
    const user = request.user;

    if (
      typeof tripId !== "string" ||
      !UuidV7Schema.safeParse(tripId).success ||
      !membership ||
      !user ||
      membership.role !== "viewer"
    ) {
      return true;
    }

    try {
      const participant = await this.prisma.client.tripParticipant.findFirst({
        where: {
          tripId,
          userId: user.id,
          // A declined invite is not participation; it must not inherit edit
          // rights if the row still carries `role: "editor"`.
          status: { not: "declined" },
          // The participant row and the trip must both belong to the Workspace
          // the membership was resolved for. This makes a cross-Workspace
          // `:tripId` impossible to upgrade even if a stray participant row
          // exists for it.
          workspaceId: membership.workspaceId,
          trip: {
            workspaceId: membership.workspaceId,
            deletedAt: null,
          },
        },
        select: { role: true },
      });

      if (participant?.role === "editor") {
        // New object on purpose: the membership resolved by `TenantGuard` is
        // shared with any downstream reader, and the stored Workspace role must
        // stay untouched.
        request.workspaceMembership = { ...membership, role: "editor" };
      }
    } catch {
      // Authorization must fail closed: a broken lookup leaves the viewer role
      // in place, which is exactly what the permission matrix already enforces.
    }

    return true;
  }
}
