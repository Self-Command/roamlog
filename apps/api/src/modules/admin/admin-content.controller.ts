import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "./admin.guard.js";
import { RequireAdminAction } from "./admin.decorator.js";
import { AdminContentService } from "./admin-content.service.js";
import { AdminMediaService } from "./admin-media.service.js";

@Controller("admin")
@UseGuards(SessionGuard, AdminGuard)
export class AdminContentController {
  constructor(
    @Inject(AdminContentService) private readonly content: AdminContentService,
    @Inject(AdminMediaService) private readonly media: AdminMediaService,
  ) {}

  @Get("trips")
  @RequireAdminAction("admin:content:read")
  listTrips(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.content.listTrips(actor, query);
  }

  @Get("entries")
  @RequireAdminAction("admin:content:read")
  listEntries(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.content.listEntries(actor, query);
  }

  @Get("comments")
  @RequireAdminAction("admin:content:read")
  listComments(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.content.listComments(actor, query);
  }

  @Delete("content/:type/:id")
  @RequireAdminAction("admin:content:delete")
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("type") type: string,
    @Param("id") id: string,
  ) {
    return this.content.remove(actor, type, id);
  }

  @Post("content/:type/:id/restore")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:content:restore")
  restore(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("type") type: string,
    @Param("id") id: string,
  ) {
    return this.content.restore(actor, type, id);
  }

  @Get("media")
  @RequireAdminAction("admin:media:read")
  listMedia(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.media.list(actor, query);
  }

  @Delete("media/:id")
  @RequireAdminAction("admin:media:delete")
  removeMedia(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.media.remove(actor, id);
  }
}
