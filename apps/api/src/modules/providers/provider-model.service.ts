import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  ProviderModelSchema,
  UpdateProviderModelRequestSchema,
  type ProviderModel,
} from "@roamlog/contracts";
import { Prisma } from "@roamlog/db";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { providerProblem } from "./provider-errors.js";
import { ProviderRuntimeService } from "./provider-runtime.service.js";

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class ProviderModelService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional()
    @Inject(ProviderRuntimeService)
    private readonly runtime?: ProviderRuntimeService,
  ) {}

  async update(
    actor: AuthenticatedActor,
    providerId: string,
    modelId: string,
    rawInput: unknown,
  ): Promise<ProviderModel> {
    const input = parseRequest(UpdateProviderModelRequestSchema, rawInput);
    const provider = await this.prisma.client.providerConnection.findUnique({
      where: { id: providerId },
      select: { id: true, group: true, version: true, deletedAt: true },
    });
    if (!provider || provider.deletedAt !== null) {
      throw providerProblem("PROVIDER_NOT_FOUND");
    }
    if (provider.group !== "ai") {
      throw providerProblem(
        "PROVIDER_CONFIG_INVALID",
        "Provider models can only be configured for AI providers.",
      );
    }
    if (provider.version !== input.expectedVersion) {
      throw providerProblem("PROVIDER_VERSION_CONFLICT");
    }

    const model = await this.prisma.client.providerModel.findUnique({
      where: { providerId_modelId: { providerId, modelId } },
    });
    if (!model) {
      throw providerProblem("PROVIDER_NOT_FOUND", "The provider model was not found.");
    }
    if (input.enabled === false && (input.isDefault ?? model.isDefault)) {
      throw providerProblem(
        "PROVIDER_CONFIG_INVALID",
        "Choose another default model before disabling this model.",
      );
    }

    const changedFields = [
      ...(input.enabled !== undefined && input.enabled !== model.enabled ? ["enabled"] : []),
      ...(input.isDefault !== undefined && input.isDefault !== model.isDefault
        ? ["isDefault"]
        : []),
      ...(input.capabilities !== undefined ? ["capabilities"] : []),
    ];
    if (changedFields.length === 0) {
      return this.present(model);
    }

    const updated = await this.prisma.client.$transaction(async (transaction) => {
      if (input.isDefault === true) {
        await transaction.providerModel.updateMany({
          where: { providerId, isDefault: true, NOT: { id: model.id } },
          data: { isDefault: false },
        });
      }

      const next = await transaction.providerModel.update({
        where: { id: model.id },
        data: {
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
          ...(input.capabilities === undefined
            ? {}
            : { capabilities: input.capabilities as Prisma.InputJsonValue }),
        },
      });

      const bumped = await transaction.providerConnection.updateMany({
        where: { id: providerId, version: input.expectedVersion, deletedAt: null },
        data: { version: { increment: 1 }, updatedById: actor.user.id },
      });
      if (bumped.count !== 1) {
        throw providerProblem("PROVIDER_VERSION_CONFLICT");
      }

      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.provider.model_updated",
          targetType: "provider",
          targetId: providerId,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: {
            group: "ai",
            modelId: next.modelId,
            changedFields,
          },
        },
        transaction,
      );
      return next;
    });

    await this.runtime?.invalidate("ai");
    return this.present(updated);
  }

  private present(row: {
    id: string;
    providerId: string;
    modelId: string;
    displayName: string;
    ownedBy: string | null;
    enabled: boolean;
    isDefault: boolean;
    capabilities: unknown;
    discoveredAt: Date;
    updatedAt: Date;
  }): ProviderModel {
    return ProviderModelSchema.parse({
      id: row.id,
      providerId: row.providerId,
      modelId: row.modelId,
      displayName: row.displayName,
      ownedBy: row.ownedBy,
      enabled: row.enabled,
      isDefault: row.isDefault,
      capabilities: jsonObject(row.capabilities),
      discoveredAt: row.discoveredAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
