import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { UuidV7Schema } from "@roamlog/contracts";

import { WorkspaceAccessService } from "../services/workspace-access.service.js";
import type { AuthenticatedRequest } from "./actor-context.js";
import { SessionGuard } from "./session.guard.js";
import { TripParticipantRoleGuard } from "./trip-participant-role.guard.js";
import { VerifiedEmailGuard } from "./verified-email.guard.js";

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(SessionGuard) private readonly sessionGuard: SessionGuard,
    @Inject(VerifiedEmailGuard) private readonly verifiedEmailGuard: VerifiedEmailGuard,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(TripParticipantRoleGuard)
    private readonly tripParticipantRoleGuard: TripParticipantRoleGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessionGuard.canActivate(context);
    this.verifiedEmailGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const parsedWorkspaceId = UuidV7Schema.safeParse(request.params.workspaceId);
    if (!parsedWorkspaceId.success || !request.user) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A valid Workspace id is required.",
        errors: [{ field: "workspaceId", code: "INVALID_INPUT", message: "Expected a UUIDv7." }],
      });
    }

    const membership = await this.access.requireMembership(request.user.id, parsedWorkspaceId.data);
    request.workspaceMembership = membership;
    request.workspaceId = membership.workspaceId;
    // Trip-scoped requests get their effective role resolved from
    // `TripParticipant` after the Workspace membership is known. The guard is a
    // no-op for workspace-level routes (no `:tripId` param).
    await this.tripParticipantRoleGuard.canActivate(context);
    return true;
  }
}
