import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { PresenceService } from "./presence.service.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { RealtimePublisher } from "./realtime.publisher.js";

@Module({
  imports: [AccessControlModule],
  providers: [PresenceService, RealtimePublisher, RealtimeGateway],
  exports: [PresenceService, RealtimePublisher],
})
export class RealtimeModule {}
