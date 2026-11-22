import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ProviderModelDiscoveryRequestSchema,
  ProviderVersionQuerySchema,
  UpdateProviderModelRequestSchema,
  type ProviderModelDiscoveryRequest,
  type UpdateProviderModelRequest,
} from "@roamlog/contracts";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { RequireAdminAction } from "../admin/admin.decorator.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { ProviderModelDiscoveryService } from "./provider-model-discovery.service.js";
import { ProviderModelService } from "./provider-model.service.js";

@Controller("admin")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class ProviderModelsController {
  constructor(
    @Inject(ProviderModelDiscoveryService)
    private readonly discovery: ProviderModelDiscoveryService,
    @Inject(ProviderModelService) private readonly models: ProviderModelService,
  ) {}

  @Post("provider-models/discover")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:write")
  discover(@CurrentActor() actor: AuthenticatedActor, @Body() body: unknown) {
    const input = parseRequest(
      ProviderModelDiscoveryRequestSchema,
      body,
    ) as ProviderModelDiscoveryRequest;
    return input.providerId
      ? this.discovery.refreshSaved(actor, input.providerId, input.expectedVersion)
      : this.discovery.discoverDraft(actor, input);
  }

  @Post("providers/:id/models/refresh")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:write")
  refresh(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    const { expectedVersion } = parseRequest(ProviderVersionQuerySchema, query);
    return this.discovery.refreshSaved(actor, id, expectedVersion);
  }

  @Patch("providers/:id/models/:modelId")
  @RequireAdminAction("admin:settings:write")
  updateModel(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Param("modelId") modelId: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(
      UpdateProviderModelRequestSchema,
      body,
    ) as UpdateProviderModelRequest;
    return this.models.update(actor, id, modelId, input);
  }
}
