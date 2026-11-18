import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CreateFeatureFlagRequestSchema,
  JsonObjectSchema,
  UpdateFeatureFlagRequestSchema,
  UuidV7Schema,
  type CreateFeatureFlagRequest,
  type FeatureFlag,
  type MessageResponse,
  type UpdateFeatureFlagRequest,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AuditService } from "../audit/audit.service.js";
import { assertAdminAction } from "../admin/admin-access.js";
import { uuidV7FromString } from "../admin/admin-ids.js";
import { presentFeatureFlag } from "../admin/admin.presenters.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class FeatureFlagsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<FeatureFlag[]> {
    const rows = await this.prisma.client.featureFlag.findMany({
      orderBy: { key: "asc" },
    });
    return rows.map(presentFeatureFlag);
  }

  async update(
    actor: AuthenticatedActor,
    key: string,
    rawBody: unknown,
  ): Promise<FeatureFlag> {
    assertAdminAction(actor, "admin:flags:update");
    const body = parseRequest(UpdateFeatureFlagRequestSchema, rawBody);
    const rules = body.rules === undefined ? undefined : validateRules(body.rules);

    const existing = await this.prisma.client.featureFlag.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException({
        code: "FEATURE_FLAG_NOT_FOUND",
        message: "The feature flag was not found.",
      });
    }

    const updated = await this.prisma.client.featureFlag.update({
      where: { key },
      data: {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.rolloutPercentage !== undefined
          ? { rolloutPercentage: body.rolloutPercentage }
          : {}),
        ...(rules !== undefined ? { rules: rules as never } : {}),
        updatedById: actor.user.id,
      },
    });

    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.feature_flag.updated",
      targetType: "feature_flag",
      targetId: uuidV7FromString(`feature-flag:${key}`),
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: {
        key,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.rolloutPercentage !== undefined
          ? { rolloutPercentage: body.rolloutPercentage }
          : {}),
      },
    });

    return presentFeatureFlag(updated);
  }

  async create(actor: AuthenticatedActor, rawBody: unknown): Promise<FeatureFlag> {
    assertAdminAction(actor, "admin:flags:update");
    const body: CreateFeatureFlagRequest = parseRequest(CreateFeatureFlagRequestSchema, rawBody);
    const rules = body.rules === undefined ? {} : validateRules(body.rules);

    const existing = await this.prisma.client.featureFlag.findUnique({ where: { key: body.key } });
    if (existing) {
      throw new ConflictException({
        code: "FEATURE_FLAG_EXISTS",
        message: "A feature flag with this key already exists.",
        key: body.key,
      });
    }

    let created: Parameters<typeof presentFeatureFlag>[0];
    try {
      created = await this.prisma.client.featureFlag.create({
        data: {
          key: body.key,
          description: body.description,
          enabled: body.enabled,
          rolloutPercentage: body.rolloutPercentage,
          rules: rules as never,
          updatedById: actor.user.id,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: "FEATURE_FLAG_EXISTS",
          message: "A feature flag with this key already exists.",
          key: body.key,
        });
      }
      throw error;
    }

    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.feature_flag.created",
      targetType: "feature_flag",
      targetId: uuidV7FromString(`feature-flag:${body.key}`),
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: {
        key: body.key,
        enabled: body.enabled,
        rolloutPercentage: body.rolloutPercentage,
      },
    });

    return presentFeatureFlag(created);
  }

  async remove(actor: AuthenticatedActor, key: string): Promise<MessageResponse> {
    assertAdminAction(actor, "admin:flags:update");

    const existing = await this.prisma.client.featureFlag.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException({
        code: "FEATURE_FLAG_NOT_FOUND",
        message: "The feature flag was not found.",
      });
    }

    await this.prisma.client.featureFlag.delete({ where: { key } });

    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.feature_flag.deleted",
      targetType: "feature_flag",
      targetId: uuidV7FromString(`feature-flag:${key}`),
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: { key },
    });

    return { message: `Feature flag ${key} was deleted.` };
  }

  async isEnabledFor(key: string, workspaceId?: string): Promise<boolean> {
    const flag = await this.prisma.client.featureFlag.findUnique({ where: { key } });
    if (!flag || !flag.enabled) {
      return false;
    }

    const rules = jsonObject(flag.rules);
    const allowlist = workspaceIds(rules);
    if (workspaceId && allowlist && !allowlist.includes(workspaceId)) {
      return false;
    }
    if (!workspaceId && allowlist && allowlist.length > 0) {
      return false;
    }

    return rolloutBucket(`${key}:${workspaceId ?? ""}`) < flag.rolloutPercentage;
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function workspaceIds(rules: Record<string, unknown>): string[] | undefined {
  const value = rules.workspaceIds ?? rules.workspaceAllowlist ?? rules.workspaces;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function validateRules(rawRules: Record<string, unknown>): Record<string, unknown> {
  const parsed = JsonObjectSchema.safeParse(rawRules);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "Feature flag rules must be a JSON object.",
    });
  }

  for (const field of ["workspaceIds", "workspaceAllowlist", "workspaces"] as const) {
    const ids = parsed.data[field];
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        ids.some((id) => typeof id !== "string" || !UuidV7Schema.safeParse(id).success))
    ) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: `rules.${field} must be an array of UUIDv7 Workspace IDs.`,
        errors: [
          {
            field: `rules.${field}`,
            code: "INVALID_INPUT",
            message: "Expected an array of UUIDv7 identifiers.",
          },
        ],
      });
    }
  }

  return parsed.data;
}

function rolloutBucket(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) % 100;
  }
  return Math.abs(hash);
}

/** Prisma unique-constraint violation, matched without importing the client. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export type { CreateFeatureFlagRequest, UpdateFeatureFlagRequest };
