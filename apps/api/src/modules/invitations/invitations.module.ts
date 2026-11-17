import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { InvitationAcceptanceController } from "./invitation-acceptance.controller.js";
import { InvitationAcceptanceService } from "./invitation-acceptance.service.js";
import { INVITATION_CLOCK, defaultInvitationClock } from "./invitation-clock.js";
import { InvitationQueryService } from "./invitation-query.service.js";
import { InvitationTokenRedactionGuard } from "./invitation-token-redaction.guard.js";
import { InvitationsService } from "./invitations.service.js";
import { WorkspaceInvitationsController } from "./workspace-invitations.controller.js";

@Module({
  imports: [AccessControlModule, AuditModule, AuthModule, IdempotencyModule],
  controllers: [WorkspaceInvitationsController, InvitationAcceptanceController],
  providers: [
    InvitationTokenRedactionGuard,
    InvitationsService,
    InvitationAcceptanceService,
    InvitationQueryService,
    { provide: INVITATION_CLOCK, useValue: defaultInvitationClock },
  ],
  exports: [InvitationsService, InvitationAcceptanceService, InvitationQueryService],
})
export class InvitationsModule {}
