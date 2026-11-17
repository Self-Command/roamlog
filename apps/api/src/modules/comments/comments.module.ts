import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { ActivitiesModule } from "../activities/activities.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { CommentsController } from "./comments.controller.js";
import { CommentsTenantGuard } from "./comments-tenant.guard.js";
import { CommentsRepository } from "./comments.repository.js";
import { CommentsService } from "./comments.service.js";

@Module({
  imports: [AccessControlModule, ActivitiesModule, NotificationsModule, RealtimeModule],
  controllers: [CommentsController],
  providers: [CommentsRepository, CommentsService, CommentsTenantGuard],
})
export class CommentsModule {}
