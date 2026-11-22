import { Body, Controller, Get, Inject, Param, Patch, Put, UseGuards } from "@nestjs/common";
import {
  ReorderProvidersRequestSchema,
  UpdateProviderPolicyRequestSchema,
  type ProviderGroup,
  type ReorderProvidersRequest,
  type UpdateProviderPolicyRequest,
} from "@roamlog/contracts";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { RequireAdminAction } from "../admin/admin.decorator.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { ProviderConfigService } from "./provider-config.service.js";

@Controller("admin/provider-groups")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class ProviderGroupsController {
  constructor(@Inject(ProviderConfigService) private readonly providers: ProviderConfigService) {}

  @Get(":group")
  @RequireAdminAction("admin:settings:read")
  get(@Param("group") group: string) {
    return this.providers.getGroup(group as ProviderGroup);
  }

  @Patch(":group")
  @RequireAdminAction("admin:settings:write")
  updatePolicy(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("group") group: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(UpdateProviderPolicyRequestSchema, body);
    return this.providers.patchPolicy(
      actor,
      group as ProviderGroup,
      input as UpdateProviderPolicyRequest,
    );
  }

  @Put(":group/order")
  @RequireAdminAction("admin:settings:write")
  reorder(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("group") group: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(ReorderProvidersRequestSchema, body);
    return this.providers.reorder(
      actor,
      group as ProviderGroup,
      (input as ReorderProvidersRequest).ids,
      (input as ReorderProvidersRequest).expectedGroupVersion,
    );
  }
}
