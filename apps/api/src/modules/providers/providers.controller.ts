import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  CreateProviderRequestSchema,
  ProviderDraftProbeRequestSchema,
  ProviderSecretRevealRequestSchema,
  ProviderSecretRevealResponseSchema,
  ProviderVersionQuerySchema,
  ReplaceProviderSecretRequestSchema,
  UpdateProviderRequestSchema,
  type CreateProviderRequest,
  type ProviderDraftProbeRequest,
  type ProviderSecretRevealResponse,
  type ReplaceProviderSecretRequest,
  type UpdateProviderRequest,
} from "@roamlog/contracts";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { RequireAdminAction } from "../admin/admin.decorator.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { AuditService } from "../audit/audit.service.js";
import { providerProblem } from "./provider-errors.js";
import { ProviderConfigService } from "./provider-config.service.js";
import { ProviderProbeService } from "./provider-probe.service.js";
import { ProviderRuntimeService } from "./provider-runtime.service.js";
import { ProviderSecretService } from "./provider-secret.service.js";

@Controller("admin/providers")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class ProvidersController {
  constructor(
    @Inject(ProviderConfigService) private readonly providers: ProviderConfigService,
    @Inject(ProviderSecretService) private readonly secrets: ProviderSecretService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProviderProbeService) private readonly probes: ProviderProbeService,
    @Optional()
    @Inject(ProviderRuntimeService)
    private readonly runtime?: ProviderRuntimeService,
  ) {}

  @Post()
  @RequireAdminAction("admin:settings:write")
  create(@CurrentActor() actor: AuthenticatedActor, @Body() body: unknown) {
    const input = parseRequest(CreateProviderRequestSchema, body);
    return this.providers.create(actor, input as CreateProviderRequest);
  }

  @Post("probe")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:write")
  probeDraft(@CurrentActor() actor: AuthenticatedActor, @Body() body: unknown) {
    const input = parseRequest(ProviderDraftProbeRequestSchema, body);
    return this.probes.probeDraft(actor, input as ProviderDraftProbeRequest);
  }

  @Post(":id/probe")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:write")
  probeSaved(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    const { expectedVersion } = parseRequest(ProviderVersionQuerySchema, query);
    return this.probes.probeSaved(actor, id, expectedVersion);
  }

  @Patch(":id")
  @RequireAdminAction("admin:settings:write")
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(UpdateProviderRequestSchema, body);
    return this.providers.update(actor, id, input as UpdateProviderRequest);
  }

  @Delete(":id")
  @RequireAdminAction("admin:settings:write")
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    const { expectedVersion } = parseRequest(ProviderVersionQuerySchema, query);
    return this.providers.remove(actor, id, expectedVersion);
  }

  @Put(":id/secrets/:field")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:write")
  async replaceSecret(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Param("field") field: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(ReplaceProviderSecretRequestSchema, body);
    const state = await this.secrets.replace({
      providerId: id,
      field,
      value: (input as ReplaceProviderSecretRequest).value,
      expectedVersion: (input as ReplaceProviderSecretRequest).expectedVersion,
      actor,
    });
    await this.runtime?.invalidate(await this.providers.groupForProvider(id));
    return state;
  }

  @Post(":id/secrets/:field/reveal")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:write")
  async revealSecret(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Param("field") field: string,
    @Body() body: unknown,
  ): Promise<ProviderSecretRevealResponse> {
    parseRequest(ProviderSecretRevealRequestSchema, body);
    const values = await this.secrets.resolvePlaintext(id);
    const value = values[field];
    if (value === undefined) {
      throw providerProblem("PROVIDER_SECRET_FIELD_UNKNOWN");
    }

    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.provider.secret_revealed",
      targetType: "provider",
      targetId: id,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: { field, last4: value.length > 0 ? value.slice(-4) : null },
    });

    return ProviderSecretRevealResponseSchema.parse({
      field,
      value,
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
    });
  }
}
