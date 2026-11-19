import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { UuidV7Schema } from "@roamlog/contracts";

import { PrismaService } from "../../modules/prisma/prisma.service.js";
import { CONTENT_TENANT_RESOURCE } from "../../modules/trips/content-tenant.decorator.js";
import type { AuthenticatedRequest } from "./actor-context.js";

/**
 * Resolves the actor's *effective* role for trip-scoped requests.
 *
 * Workspace permissions are keyed on `WorkspaceMembershipAccess.role`, but a
 * Workspace `viewer` may be promoted to `editor` for one specific trip through
 * `TripParticipant.role`. This guard runs after `TenantGuard` has resolved
 * `request.workspaceMembership` and replaces that membership with a new object
 * whose `role` is `"editor"` when the actor is a joined trip editor.
 *
 * The trip may be addressed directly (`:tripId`) or through a sub-resource
 * (`:stopId`, `:itemId`, `:entryId`, `:expenseId`, `:mediaId`). Sub-resource
 * routes do not carry the owning trip, so the guard resolves it with exactly one
 * `select: { tripId: true }` lookup against that sub-resource table before
 * running the same participant check.
 *
 * Replacing the object (never mutating the original) is what makes the existing
 * `PermissionService.assertCan(membership.role, ...)` call sites — and the
 * `RolesGuard` that runs before the controller — honour the promotion without
 * touching any of them.
 *
 * Safety properties:
 * - Routes without a trip-scoped id pass through untouched.
 * - Only a Workspace `viewer` can be upgraded; owner/admin/editor keep their
 *   base role, and the extra lookup never runs for them.
 * - Only `status: "joined"` participants are promoted; an `invited` row has not
 *   accepted the invitation yet and keeps the base `viewer` role.
 * - Every lookup is scoped by `workspaceId` and `trip.deletedAt: null`, so a
 *   sub-resource from another trip or another Workspace cannot widen access.
 * - A missing row, a media row with no trip, or a failed lookup keeps the base
 *   role and never throws; the business layer keeps owning the 404/403
 *   semantics.
 */
@Injectable()
export class TripParticipantRoleGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const membership = request.workspaceMembership;
    const user = request.user;

    if (!membership || !user || membership.role !== "viewer") {
      return true;
    }

    try {
      const tripId = await this.resolveTripId(context, request, membership.workspaceId);
      if (!tripId) {
        return true;
      }

      const participant = await this.prisma.client.tripParticipant.findFirst({
        where: {
          tripId,
          userId: user.id,
          // `invited` means the invitation has not been accepted yet; only a
          // joined participant may inherit edit rights from `role: "editor"`.
          status: "joined",
          // The participant row and the trip must both belong to the Workspace
          // the membership was resolved for. This makes a cross-Workspace id
          // impossible to upgrade even if a stray participant row exists.
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

  /**
   * Returns the trip owning the id in the route, or `null` when the route is not
   * trip-scoped. May perform at most one sub-resource query.
   */
  private async resolveTripId(
    context: ExecutionContext,
    request: AuthenticatedRequest,
    workspaceId: string,
  ): Promise<string | null> {
    const params = request.params ?? {};

    const tripId = this.uuid(params.tripId);
    if (tripId) {
      return tripId;
    }

    const stopId = this.uuid(params.stopId);
    if (stopId) {
      const stop = await this.prisma.client.stop.findFirst({
        where: {
          id: stopId,
          deletedAt: null,
          workspaceId,
          trip: { workspaceId, deletedAt: null },
        },
        select: { tripId: true },
      });
      return stop?.tripId ?? null;
    }

    const entryId = this.uuid(params.entryId);
    if (entryId) {
      const entry = await this.prisma.client.journalEntry.findFirst({
        where: {
          id: entryId,
          deletedAt: null,
          workspaceId,
          trip: { workspaceId, deletedAt: null },
        },
        select: { tripId: true },
      });
      return entry?.tripId ?? null;
    }

    const expenseId = this.uuid(params.expenseId);
    if (expenseId) {
      const expense = await this.prisma.client.expense.findFirst({
        where: {
          id: expenseId,
          deletedAt: null,
          workspaceId,
          trip: { workspaceId, deletedAt: null },
        },
        select: { tripId: true },
      });
      return expense?.tripId ?? null;
    }

    const mediaId = this.uuid(params.mediaId);
    if (mediaId) {
      // `Media.tripId` is nullable: workspace-level media is not trip content and
      // must never grant a trip role.
      const media = await this.prisma.client.media.findFirst({
        where: {
          id: mediaId,
          deletedAt: null,
          workspaceId,
          trip: { workspaceId, deletedAt: null },
        },
        select: { tripId: true },
      });
      return media?.tripId ?? null;
    }

    const itemId = this.uuid(params.itemId);
    if (itemId) {
      // `:itemId` is shared by packing and itinerary routes; the ContentTenant
      // metadata (or the matched route path) tells the two apart without an
      // extra lookup.
      if (this.isItineraryRoute(context, request)) {
        const item = await this.prisma.client.itineraryItem.findFirst({
          where: {
            id: itemId,
            deletedAt: null,
            workspaceId,
            trip: { workspaceId, deletedAt: null },
          },
          select: { tripId: true },
        });
        return item?.tripId ?? null;
      }

      const item = await this.prisma.client.packingItem.findFirst({
        where: {
          id: itemId,
          deletedAt: null,
          workspaceId,
          trip: { workspaceId, deletedAt: null },
        },
        select: { tripId: true },
      });
      return item?.tripId ?? null;
    }

    return null;
  }

  private isItineraryRoute(context: ExecutionContext, request: AuthenticatedRequest): boolean {
    const resource = Reflect.getMetadata(CONTENT_TENANT_RESOURCE, context.getHandler());
    if (resource === "itinerary") {
      return true;
    }
    if (resource !== undefined) {
      return false;
    }

    const routePath = (request as AuthenticatedRequest & { route?: { path?: unknown } }).route
      ?.path;
    const path = typeof routePath === "string" ? routePath : request.path;
    return typeof path === "string" && path.includes("/itinerary/");
  }

  private uuid(value: string | string[] | undefined): string | null {
    return typeof value === "string" && UuidV7Schema.safeParse(value).success ? value : null;
  }
}
