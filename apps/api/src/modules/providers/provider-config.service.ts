import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  ProviderConnectionSchema,
  ProviderGroupResponseSchema,
  ProviderHealthStatusSchema,
  ProviderGroupSchema,
  type CreateProviderRequest,
  type ProviderConnection,
  type ProviderGroup,
  type ProviderGroupResponse,
  type ProviderRoutingMode,
  type ProviderSecretState,
  type UpdateProviderRequest,
} from "@roamlog/contracts";
import { Prisma } from "@roamlog/db";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  optionalProviderPresetDefinition,
  parseProviderConfig,
  providerCatalogResponse,
  providerSecretField,
  requireProviderAdapter,
} from "./provider-catalog.js";
import { providerProblem } from "./provider-errors.js";
import { ProviderRuntimeService } from "./provider-runtime.service.js";
import { ProviderSecretService } from "./provider-secret.service.js";

export type ProviderCreateInput = CreateProviderRequest;
export type ProviderUpdateInput = UpdateProviderRequest;

type ProviderConfigClient = Pick<
  PrismaService["client"],
  | "providerConnection"
  | "providerGroupPolicy"
  | "providerSecret"
  | "providerSecretHistory"
  | "auditLog"
>;

interface ProviderRow {
  id: string;
  group: string;
  adapter: string;
  preset: string | null;
  label: string;
  enabled: boolean;
  priority: number;
  config: unknown;
  version: number;
  healthStatus: string;
  consecutiveFailures: number;
  cooldownUntil: Date | null;
  lastCheckedAt: Date | null;
  lastErrorCode: string | null;
  legacyKey: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface PolicyRow {
  group: string;
  routingMode: string;
  maxAttempts: number;
  cooldownSeconds: number;
  config: unknown;
  version: number;
  updatedById: string | null;
  updatedAt: Date;
  createdAt: Date;
}

const GROUP_DEFAULTS: Readonly<
  Record<
    ProviderGroup,
    {
      routingMode: ProviderRoutingMode;
      maxAttempts: number;
      cooldownSeconds: number;
    }
  >
> = Object.freeze({
  ai: { routingMode: "priority", maxAttempts: 3, cooldownSeconds: 30 },
  places: { routingMode: "merge", maxAttempts: 3, cooldownSeconds: 30 },
  mail: { routingMode: "single", maxAttempts: 1, cooldownSeconds: 0 },
  storage: { routingMode: "single", maxAttempts: 1, cooldownSeconds: 0 },
});

function groupLabel(group: ProviderGroup): string {
  return providerCatalogResponse().groups.find((entry) => entry.group === group)?.label ?? group;
}

function allowedRoutingModes(group: ProviderGroup): readonly ProviderRoutingMode[] {
  return (
    providerCatalogResponse().groups.find((entry) => entry.group === group)?.routingModes ?? []
  );
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw providerProblem("PROVIDER_CONFIG_INVALID", "The provider configuration is invalid.");
  }
  return value as Record<string, unknown>;
}

function requiredSecretFields(adapter: string) {
  return requireProviderAdapter(adapter).secretFields.filter((field) => field.required);
}

function validateSecretFields(adapter: string, fields: readonly string[]): void {
  for (const field of fields) {
    if (!providerSecretField(adapter, field)) {
      throw providerProblem(
        "PROVIDER_SECRET_FIELD_UNKNOWN",
        `The provider adapter does not support the secret field "${field}".`,
      );
    }
  }
}

function assertRequiredSecrets(adapter: string, presentFields: ReadonlySet<string>): void {
  const missing = requiredSecretFields(adapter).filter((field) => !presentFields.has(field.key));
  if (missing.length > 0) {
    throw providerProblem(
      "PROVIDER_CONFIG_INVALID",
      "Required provider credentials are missing.",
      missing.map((field) => ({
        field: field.key,
        code: "REQUIRED_SECRET_MISSING",
        message: `${field.label} is required.`,
      })),
    );
  }
}

function providerHealth(row: ProviderRow) {
  const status = ProviderHealthStatusSchema.safeParse(row.healthStatus);
  if (!status.success) {
    throw providerProblem("PROVIDER_CONFIG_INVALID", "The provider health status is invalid.");
  }
  return {
    status: status.data,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
  };
}

function presentConnection(
  row: ProviderRow,
  secrets: readonly ProviderSecretState[],
): ProviderConnection {
  return ProviderConnectionSchema.parse({
    id: row.id,
    group: row.group,
    adapter: row.adapter,
    preset: row.preset,
    label: row.label,
    enabled: row.enabled,
    priority: row.priority,
    config: jsonObject(row.config),
    version: row.version,
    secrets: [...secrets],
    health: providerHealth(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function secretStates(
  rows: readonly {
    providerId: string;
    field: string;
    last4: string | null;
    version: number;
  }[],
): Map<string, ProviderSecretState[]> {
  const result = new Map<string, ProviderSecretState[]>();
  for (const row of rows) {
    const entries = result.get(row.providerId) ?? [];
    entries.push({
      field: row.field,
      hasValue: true,
      last4: row.last4,
      version: row.version,
    });
    result.set(row.providerId, entries);
  }
  for (const entries of result.values()) {
    entries.sort((left, right) => left.field.localeCompare(right.field));
  }
  return result;
}

@Injectable()
export class ProviderConfigService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProviderSecretService) private readonly secrets: ProviderSecretService,
    @Optional()
    @Inject(ProviderRuntimeService)
    private readonly runtime?: ProviderRuntimeService,
  ) {}

  async getGroup(group: ProviderGroup): Promise<ProviderGroupResponse> {
    this.assertGroup(group);
    const [policy, rows] = await Promise.all([
      this.prisma.client.providerGroupPolicy.findUnique({ where: { group } }),
      this.prisma.client.providerConnection.findMany({
        where: { group, deletedAt: null },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const ids = rows.map((row) => row.id);
    const secretRows =
      ids.length > 0
        ? await this.prisma.client.providerSecret.findMany({
            where: { providerId: { in: ids } },
            select: {
              providerId: true,
              field: true,
              last4: true,
              version: true,
            },
          })
        : [];
    const byProvider = secretStates(secretRows);
    const defaults = GROUP_DEFAULTS[group];
    const response = {
      group,
      label: groupLabel(group),
      routingMode: policy?.routingMode ?? defaults.routingMode,
      maxAttempts: policy?.maxAttempts ?? defaults.maxAttempts,
      cooldownSeconds: policy?.cooldownSeconds ?? defaults.cooldownSeconds,
      version: policy?.version ?? 1,
      providers: rows.map((row) => presentConnection(row, byProvider.get(row.id) ?? [])),
    };
    return ProviderGroupResponseSchema.parse(response);
  }

  async patchPolicy(
    actor: AuthenticatedActor,
    group: ProviderGroup,
    input: {
      routingMode: ProviderRoutingMode;
      maxAttempts: number;
      cooldownSeconds: number;
      expectedVersion: number;
    },
  ): Promise<ProviderGroupResponse> {
    this.assertGroup(group);
    if (!allowedRoutingModes(group).includes(input.routingMode)) {
      throw providerProblem(
        "PROVIDER_CONFIG_INVALID",
        `The routing mode "${input.routingMode}" is not supported for ${group}.`,
      );
    }

    await this.prisma.client.$transaction(async (transaction) => {
      const current = await transaction.providerGroupPolicy.findUnique({ where: { group } });
      if ((current?.version ?? 1) !== input.expectedVersion) {
        throw providerProblem("PROVIDER_VERSION_CONFLICT");
      }

      if (current) {
        const updated = await transaction.providerGroupPolicy.updateMany({
          where: { group, version: input.expectedVersion },
          data: {
            routingMode: input.routingMode,
            maxAttempts: input.maxAttempts,
            cooldownSeconds: input.cooldownSeconds,
            version: { increment: 1 },
            updatedById: actor.user.id,
          },
        });
        if (updated.count !== 1) {
          throw providerProblem("PROVIDER_VERSION_CONFLICT");
        }
      } else {
        await transaction.providerGroupPolicy.create({
          data: {
            group,
            routingMode: input.routingMode,
            maxAttempts: input.maxAttempts,
            cooldownSeconds: input.cooldownSeconds,
            version: 2,
            updatedById: actor.user.id,
          },
        });
      }

      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.provider.policy_updated",
          targetType: "provider_group",
          targetId: group,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: {
            group,
            routingMode: input.routingMode,
            maxAttempts: input.maxAttempts,
            cooldownSeconds: input.cooldownSeconds,
          },
        },
        transaction,
      );
    });

    const response = await this.getGroup(group);
    await this.invalidate(group);
    return response;
  }

  async create(actor: AuthenticatedActor, input: ProviderCreateInput): Promise<ProviderConnection> {
    this.assertGroup(input.group);
    const adapter = requireProviderAdapter(input.adapter);
    if (adapter.group !== input.group) {
      throw providerProblem(
        "PROVIDER_CONFIG_INVALID",
        "The selected adapter does not belong to this provider group.",
      );
    }
    const preset = input.preset ?? null;
    optionalProviderPresetDefinition(input.adapter, preset);
    const config = parseProviderConfig(input.adapter, input.config);
    const secretFields = Object.keys(input.secrets ?? {});
    validateSecretFields(input.adapter, secretFields);
    const enabled = input.enabled ?? true;
    if (enabled) {
      assertRequiredSecrets(input.adapter, new Set(secretFields));
    }

    const id = await this.prisma.client.$transaction(async (transaction) => {
      const policy = await this.ensurePolicy(transaction, input.group);
      if (
        input.expectedGroupVersion !== undefined &&
        policy.version !== input.expectedGroupVersion
      ) {
        throw providerProblem("PROVIDER_ORDER_CONFLICT");
      }
      await this.assertSingleActive(transaction, input.group, enabled);

      const highest = await transaction.providerConnection.findFirst({
        where: { group: input.group, deletedAt: null },
        orderBy: { priority: "desc" },
        select: { priority: true },
      });
      const created = await transaction.providerConnection.create({
        data: {
          group: input.group,
          adapter: input.adapter,
          preset,
          label: input.label,
          enabled,
          priority: input.priority ?? (highest?.priority ?? 0) + 10,
          config: config as Prisma.InputJsonValue,
          createdById: actor.user.id,
          updatedById: actor.user.id,
        },
      });

      let version = created.version;
      for (const [field, value] of Object.entries(input.secrets ?? {})) {
        await this.secrets.replace(
          {
            providerId: created.id,
            field,
            value,
            expectedVersion: version,
            actor,
          },
          transaction,
        );
        version += 1;
      }

      await this.bumpGroupVersion(transaction, input.group, actor);
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.provider.created",
          targetType: "provider",
          targetId: created.id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: {
            group: input.group,
            adapter: input.adapter,
            preset,
            priority: created.priority,
            enabled,
            secretFields,
          },
        },
        transaction,
      );
      return created.id;
    });

    const created = await this.requireProvider(id);
    await this.invalidate(input.group);
    return created;
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    input: ProviderUpdateInput,
  ): Promise<ProviderConnection> {
    if (Object.prototype.hasOwnProperty.call(input, "secrets")) {
      throw providerProblem(
        "PROVIDER_CONFIG_INVALID",
        "Provider secrets must be changed through the dedicated secret endpoint.",
      );
    }

    await this.prisma.client.$transaction(async (transaction) => {
      const existing = await transaction.providerConnection.findUnique({ where: { id } });
      if (!existing || existing.deletedAt !== null) {
        throw providerProblem("PROVIDER_NOT_FOUND");
      }
      if (existing.version !== input.expectedVersion) {
        throw providerProblem("PROVIDER_VERSION_CONFLICT");
      }

      const adapter = input.adapter ?? existing.adapter;
      const definition = requireProviderAdapter(adapter);
      if (definition.group !== existing.group) {
        throw providerProblem(
          "PROVIDER_CONFIG_INVALID",
          "The selected adapter does not belong to this provider group.",
        );
      }
      const preset = input.preset !== undefined ? input.preset : existing.preset;
      optionalProviderPresetDefinition(adapter, preset);
      const config = parseProviderConfig(adapter, input.config ?? existing.config);
      const enabled = input.enabled ?? existing.enabled;
      const priority = input.priority ?? existing.priority;
      const label = input.label ?? existing.label;

      if (enabled) {
        const rows = await transaction.providerSecret.findMany({
          where: { providerId: id },
          select: { field: true },
        });
        assertRequiredSecrets(adapter, new Set(rows.map((row) => row.field)));
      }
      await this.assertSingleActive(transaction, existing.group, enabled, id);

      const changedFields: string[] = [];
      if (adapter !== existing.adapter) changedFields.push("adapter");
      if (preset !== existing.preset) changedFields.push("preset");
      if (label !== existing.label) changedFields.push("label");
      if (enabled !== existing.enabled) changedFields.push("enabled");
      if (priority !== existing.priority) changedFields.push("priority");
      if (JSON.stringify(config) !== JSON.stringify(jsonObject(existing.config))) {
        changedFields.push("config");
      }

      if (changedFields.length === 0) {
        return;
      }

      const updated = await transaction.providerConnection.updateMany({
        where: { id, version: input.expectedVersion, deletedAt: null },
        data: {
          adapter,
          preset,
          label,
          enabled,
          priority,
          config: config as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedById: actor.user.id,
        },
      });
      if (updated.count !== 1) {
        throw providerProblem("PROVIDER_VERSION_CONFLICT");
      }
      if (changedFields.includes("priority")) {
        await this.bumpGroupVersion(transaction, existing.group, actor);
      }

      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.provider.updated",
          targetType: "provider",
          targetId: id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: {
            group: existing.group,
            adapter,
            preset,
            priority,
            enabled,
            changedFields,
          },
        },
        transaction,
      );
    });

    const updated = await this.requireProvider(id);
    await this.invalidate(updated.group);
    return updated;
  }

  async remove(
    actor: AuthenticatedActor,
    id: string,
    expectedVersion?: number,
  ): Promise<{ message: string }> {
    await this.prisma.client.$transaction(async (transaction) => {
      const existing = await transaction.providerConnection.findUnique({ where: { id } });
      if (!existing || existing.deletedAt !== null) {
        throw providerProblem("PROVIDER_NOT_FOUND");
      }
      const version = expectedVersion ?? existing.version;
      if (existing.version !== version) {
        throw providerProblem("PROVIDER_VERSION_CONFLICT");
      }
      const now = new Date();
      const removed = await transaction.providerConnection.updateMany({
        where: { id, version, deletedAt: null },
        data: {
          deletedAt: now,
          version: { increment: 1 },
          updatedById: actor.user.id,
        },
      });
      if (removed.count !== 1) {
        throw providerProblem("PROVIDER_VERSION_CONFLICT");
      }

      const group = ProviderGroupSchema.parse(existing.group);
      await this.bumpGroupVersion(transaction, group, actor);
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.provider.deleted",
          targetType: "provider",
          targetId: id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: {
            group,
            adapter: existing.adapter,
            preset: existing.preset,
            label: existing.label,
          },
        },
        transaction,
      );
    });
    const row = await this.prisma.client.providerConnection.findUnique({
      where: { id },
      select: { group: true },
    });
    if (row) {
      await this.invalidate(ProviderGroupSchema.parse(row.group));
    }
    return { message: "Provider deleted." };
  }

  async reorder(
    actor: AuthenticatedActor,
    group: ProviderGroup,
    ids: readonly string[],
    expectedGroupVersion: number,
  ): Promise<ProviderGroupResponse> {
    this.assertGroup(group);
    if (new Set(ids).size !== ids.length) {
      throw providerProblem(
        "PROVIDER_CONFIG_INVALID",
        "A provider reorder request cannot contain duplicates.",
      );
    }

    await this.prisma.client.$transaction(async (transaction) => {
      const policy = await this.ensurePolicy(transaction, group);
      if (policy.version !== expectedGroupVersion) {
        throw providerProblem("PROVIDER_ORDER_CONFLICT");
      }
      const providers = await transaction.providerConnection.findMany({
        where: { group, deletedAt: null },
      });
      const currentIds = new Set(providers.map((row) => row.id));
      if (ids.length !== currentIds.size || ids.some((id) => !currentIds.has(id))) {
        throw providerProblem(
          "PROVIDER_CONFIG_INVALID",
          "The reorder request must include every provider in the group.",
        );
      }
      for (const [index, id] of ids.entries()) {
        const updated = await transaction.providerConnection.updateMany({
          where: { id, group, deletedAt: null },
          data: { priority: (index + 1) * 10, updatedById: actor.user.id },
        });
        if (updated.count !== 1) {
          throw providerProblem("PROVIDER_ORDER_CONFLICT");
        }
      }
      await this.bumpGroupVersion(transaction, group, actor, expectedGroupVersion);
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.provider.reordered",
          targetType: "provider_group",
          targetId: group,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: {
            group,
            providerIds: [...ids],
            previousVersion: expectedGroupVersion,
            version: expectedGroupVersion + 1,
          },
        },
        transaction,
      );
    });
    const response = await this.getGroup(group);
    await this.invalidate(group);
    return response;
  }

  async groupForProvider(id: string): Promise<ProviderGroup> {
    const row = await this.prisma.client.providerConnection.findUnique({
      where: { id },
      select: { group: true, deletedAt: true },
    });
    if (!row || row.deletedAt !== null) {
      throw providerProblem("PROVIDER_NOT_FOUND");
    }
    return ProviderGroupSchema.parse(row.group);
  }

  private assertGroup(group: ProviderGroup): void {
    if (!ProviderGroupSchema.safeParse(group).success) {
      throw providerProblem("PROVIDER_GROUP_NOT_FOUND");
    }
  }

  private async invalidate(group: ProviderGroup): Promise<void> {
    await this.runtime?.invalidate(group);
  }

  private async requireProvider(id: string): Promise<ProviderConnection> {
    const row = await this.prisma.client.providerConnection.findUnique({ where: { id } });
    if (!row || row.deletedAt !== null) {
      throw providerProblem("PROVIDER_NOT_FOUND");
    }
    const secretRows = await this.prisma.client.providerSecret.findMany({
      where: { providerId: id },
      select: { providerId: true, field: true, last4: true, version: true },
    });
    return presentConnection(row, secretStates(secretRows).get(id) ?? []);
  }

  private async ensurePolicy(
    client: ProviderConfigClient,
    group: ProviderGroup,
  ): Promise<PolicyRow> {
    const existing = await client.providerGroupPolicy.findUnique({ where: { group } });
    if (existing) {
      return existing;
    }
    const defaults = GROUP_DEFAULTS[group];
    return client.providerGroupPolicy.create({
      data: {
        group,
        routingMode: defaults.routingMode,
        maxAttempts: defaults.maxAttempts,
        cooldownSeconds: defaults.cooldownSeconds,
        version: 1,
      },
    });
  }

  private async bumpGroupVersion(
    client: ProviderConfigClient,
    group: ProviderGroup,
    actor: AuthenticatedActor,
    expectedVersion?: number,
  ): Promise<number> {
    const policy = await this.ensurePolicy(client, group);
    if (expectedVersion !== undefined && policy.version !== expectedVersion) {
      throw providerProblem("PROVIDER_ORDER_CONFLICT");
    }
    const updated = await client.providerGroupPolicy.updateMany({
      where: { group, version: policy.version },
      data: { version: { increment: 1 }, updatedById: actor.user.id },
    });
    if (updated.count !== 1) {
      throw providerProblem("PROVIDER_ORDER_CONFLICT");
    }
    return policy.version + 1;
  }

  private async assertSingleActive(
    client: ProviderConfigClient,
    group: ProviderGroup,
    enabled: boolean,
    excludeId?: string,
  ): Promise<void> {
    if (!enabled || (group !== "mail" && group !== "storage")) {
      return;
    }
    const active = await client.providerConnection.count({
      where: {
        group,
        enabled: true,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (active > 0) {
      throw providerProblem("PROVIDER_ACTIVE_CONFLICT");
    }
  }
}
