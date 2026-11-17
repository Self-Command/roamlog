import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IdempotencyKeySchema } from "@roamlog/contracts";

import {
  CurrentActor,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { ExportsService } from "./exports.service.js";

@Controller()
@UseGuards(SessionGuard, VerifiedEmailGuard)
export class ExportsController {
  constructor(
    @Inject(ExportsService) private readonly exports: ExportsService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Post("exports")
  @HttpCode(202)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Query() query: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      return this.exports.create(actor, body, query);
    }
    const key = parseRequest(IdempotencyKeySchema, idempotencyKey);
    return this.idempotency.run(`export:create:${actor.user.id}`, key, () =>
      this.exports.create(actor, body, query),
    );
  }

  @Get("exports")
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: unknown) {
    return this.exports.list(actor, query);
  }

  @Get("exports/:exportId")
  get(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("exportId") exportId: string,
  ) {
    return this.exports.get(actor, exportId);
  }

  @Delete("exports/:exportId")
  @HttpCode(200)
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("exportId") exportId: string,
  ) {
    return this.exports.remove(actor, exportId);
  }
}
