import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { UuidV7Schema } from "@roamlog/contracts";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  CONTENT_TENANT_RESOURCE,
  type ContentTenantResource,
} from "./content-tenant.decorator.js";

const ERROR_CODES: Record<ContentTenantResource, string> = {
  trip: "TRIP_NOT_FOUND",
  stop: "STOP_NOT_FOUND",
  itinerary: "ITINERARY_ITEM_NOT_FOUND",
  entry: "ENTRY_NOT_FOUND",
};

@Injectable()
export class ContentTenantGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionGuard) private readonly sessionGuard: SessionGuard,
    @Inject(VerifiedEmailGuard) private readonly verifiedEmailGuard: VerifiedEmailGuard,
    @Inject(TenantGuard) private readonly tenantGuard: TenantGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessionGuard.canActivate(context);
    this.verifiedEmailGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const resource = (Reflect.getMetadata(CONTENT_TENANT_RESOURCE, context.getHandler()) ??
      "trip") as ContentTenantResource;
    const id = this.resourceId(resource, request.params);
    if (!id || !UuidV7Schema.safeParse(id).success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A valid content id is required.",
      });
    }
    const workspaceId = await this.resolveWorkspace(resource, id);
    if (!workspaceId) {
      throw new NotFoundException({
        code: ERROR_CODES[resource],
        message: "The requested content was not found.",
      });
    }

    request.params.workspaceId = workspaceId;
    return this.tenantGuard.canActivate(context);
  }

  private resourceId(
    resource: ContentTenantResource,
    params: AuthenticatedRequest["params"],
  ): string | undefined {
    switch (resource) {
      case "trip":
        return this.param(params.tripId);
      case "stop":
        return this.param(params.stopId);
      case "itinerary":
        return this.param(params.itemId);
      case "entry":
        return this.param(params.entryId);
    }
  }

  private param(value: string | string[] | undefined): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private async resolveWorkspace(
    resource: ContentTenantResource,
    id: string | undefined,
  ): Promise<string | null> {
    if (!id) {
      return null;
    }

    switch (resource) {
      case "trip": {
        const trip = await this.prisma.client.trip.findFirst({
          where: { id, deletedAt: null },
          select: { workspaceId: true },
        });
        return trip?.workspaceId ?? null;
      }
      case "stop": {
        const stop = await this.prisma.client.stop.findFirst({
          where: { id, deletedAt: null, trip: { deletedAt: null } },
          select: { workspaceId: true },
        });
        return stop?.workspaceId ?? null;
      }
      case "itinerary": {
        const item = await this.prisma.client.itineraryItem.findFirst({
          where: { id, deletedAt: null, trip: { deletedAt: null } },
          select: { workspaceId: true },
        });
        return item?.workspaceId ?? null;
      }
      case "entry": {
        const entry = await this.prisma.client.journalEntry.findFirst({
          where: { id, deletedAt: null, trip: { deletedAt: null } },
          select: { workspaceId: true },
        });
        return entry?.workspaceId ?? null;
      }
    }
  }
}
