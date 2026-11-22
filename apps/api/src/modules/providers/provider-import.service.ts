import { Inject, Injectable } from "@nestjs/common";
import type { CreateProviderRequest, ProviderConnection, ProviderGroup } from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { AuditService } from "../audit/audit.service.js";
import { SecretBox, SecretBoxError } from "../settings/secret-box.js";
import {
  parseProviderConfig,
  providerAdapterDefinition,
  providerPresetDefinition,
} from "./provider-catalog.js";
import { ProviderConfigService } from "./provider-config.service.js";
import { ProviderSecretService } from "./provider-secret.service.js";

export interface ProviderImportInput {
  readonly group: ProviderGroup;
  readonly adapter: string;
  readonly preset: string;
  readonly label: string;
  readonly priority?: number;
  readonly secret: string;
  readonly replaceSecret: boolean;
  readonly dryRun: boolean;
}

export interface ProviderImportResult {
  readonly status: "created" | "updated" | "unchanged" | "dry_run";
  readonly providerId: string | null;
  readonly adapter: string;
  readonly preset: string | null;
  readonly label: string;
  readonly last4: string | null;
  readonly priority: number | null;
}

function lastFour(value: string): string | null {
  return value.length > 0 ? value.slice(-4) : null;
}

export function assertProviderImportKeyring(environment: {
  CONFIG_ENCRYPTION_KEY?: string;
  CONFIG_ENCRYPTION_KEYS?: string;
}): void {
  try {
    SecretBox.fromEnvironment(environment);
  } catch (error) {
    if (error instanceof SecretBoxError) {
      throw new Error("Provider secret keyring is unavailable or invalid.", { cause: error });
    }
    throw error;
  }
}

function defaultRegions(adapter: string): readonly string[] {
  if (adapter === "tencent") {
    return ["cn"];
  }
  if (adapter === "photon") {
    return ["cn", "global"];
  }
  return ["global"];
}

export function buildProviderImportConfig(
  adapter: string,
  preset: string,
): Record<string, unknown> {
  const definition = providerAdapterDefinition(adapter);
  if (!definition) {
    throw new Error(`Unsupported provider adapter "${adapter}".`);
  }
  const presetDefinition = providerPresetDefinition(adapter, preset);
  if (!presetDefinition) {
    throw new Error(`Preset "${preset}" is not valid for adapter "${adapter}".`);
  }

  const config: Record<string, unknown> = {};
  for (const field of definition.configFields) {
    if (field.default !== undefined) {
      config[field.key] = structuredClone(field.default);
    }
  }
  if (config.baseUrl === undefined && presetDefinition.defaultBaseUrl) {
    config.baseUrl = presetDefinition.defaultBaseUrl;
  }
  if (config.regions === undefined) {
    config.regions = [...defaultRegions(adapter)];
  }

  const missing = definition.configFields
    .filter((field) => field.required && config[field.key] === undefined)
    .map((field) => field.key);
  if (missing.length > 0) {
    throw new Error(
      `Provider "${adapter}" requires configuration fields that are not available to this key importer: ${missing.join(", ")}. Configure them in Admin first.`,
    );
  }
  return parseProviderConfig(adapter, config);
}

function importSecretField(adapter: string, preset: string): string {
  const definition = providerAdapterDefinition(adapter);
  if (!definition) {
    throw new Error(`Unsupported provider adapter "${adapter}".`);
  }
  if (!providerPresetDefinition(adapter, preset)) {
    throw new Error(`Preset "${preset}" is not valid for adapter "${adapter}".`);
  }
  if (definition.secretFields.length !== 1) {
    throw new Error(
      `Provider "${adapter}" requires ${definition.secretFields.length} secret fields; this importer accepts exactly one.`,
    );
  }
  const field = definition.secretFields[0];
  if (!field) {
    throw new Error(`Provider "${adapter}" does not expose a secret field.`);
  }
  return field.key;
}

@Injectable()
export class ProviderImportService {
  constructor(
    @Inject(ProviderConfigService) private readonly providers: ProviderConfigService,
    @Inject(ProviderSecretService) private readonly secrets: ProviderSecretService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async importProvider(
    actor: AuthenticatedActor,
    input: ProviderImportInput,
  ): Promise<ProviderImportResult> {
    const secretField = importSecretField(input.adapter, input.preset);
    const config = buildProviderImportConfig(input.adapter, input.preset);
    const group = await this.providers.getGroup(input.group);
    const existing = group.providers.find(
      (provider) =>
        provider.adapter === input.adapter &&
        provider.label === input.label &&
        provider.preset === input.preset,
    );

    if (input.dryRun) {
      return {
        status: "dry_run",
        providerId: existing?.id ?? null,
        adapter: input.adapter,
        preset: input.preset,
        label: input.label,
        last4: lastFour(input.secret),
        priority: input.priority ?? existing?.priority ?? null,
      };
    }

    if (existing) {
      const existingSecret = existing.secrets.find(
        (secret) => secret.field === secretField && secret.hasValue,
      );
      if (existingSecret && !input.replaceSecret) {
        return {
          status: "unchanged",
          providerId: existing.id,
          adapter: existing.adapter,
          preset: existing.preset,
          label: existing.label,
          last4: existingSecret.last4,
          priority: existing.priority,
        };
      }

      const secret = await this.secrets.replace({
        providerId: existing.id,
        field: secretField,
        value: input.secret,
        expectedVersion: existing.version,
        actor,
      });
      await this.recordImport(actor, input, existing, secretField, secret.last4, false);
      return {
        status: "updated",
        providerId: existing.id,
        adapter: existing.adapter,
        preset: existing.preset,
        label: existing.label,
        last4: secret.last4,
        priority: existing.priority,
      };
    }

    const createInput: CreateProviderRequest = {
      group: input.group,
      adapter: input.adapter,
      preset: input.preset,
      label: input.label,
      enabled: true,
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      config,
      secrets: { [secretField]: input.secret },
    };
    const created = await this.providers.create(actor, createInput);
    const createdSecret = created.secrets.find((secret) => secret.field === secretField);
    await this.recordImport(actor, input, created, secretField, createdSecret?.last4 ?? null, true);
    return {
      status: "created",
      providerId: created.id,
      adapter: created.adapter,
      preset: created.preset,
      label: created.label,
      last4: createdSecret?.last4 ?? lastFour(input.secret),
      priority: created.priority,
    };
  }

  private async recordImport(
    actor: AuthenticatedActor,
    input: ProviderImportInput,
    provider: ProviderConnection,
    secretField: string,
    last4: string | null,
    created: boolean,
  ): Promise<void> {
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.provider.secret_imported",
      targetType: "provider",
      targetId: provider.id,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: {
        group: input.group,
        adapter: provider.adapter,
        preset: provider.preset,
        label: provider.label,
        field: secretField,
        last4,
        priority: provider.priority,
        created,
        replaced: !created,
      },
    });
  }
}
