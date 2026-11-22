import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ProviderSecretFieldSchema, type ProviderSecretState } from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SecretBox, SecretBoxError } from "../settings/secret-box.js";

const HISTORY_TTL_MS = 24 * 60 * 60 * 1_000;

type ProviderSecretClient = Pick<
  PrismaService["client"],
  "providerConnection" | "providerSecret" | "providerSecretHistory" | "auditLog"
>;

export interface ReplaceProviderSecretInput {
  readonly providerId: string;
  readonly field: string;
  readonly value: string;
  readonly expectedVersion: number;
  readonly actor: AuthenticatedActor;
}

function providerNotFound(): NotFoundException {
  return new NotFoundException({
    code: "PROVIDER_NOT_FOUND",
    message: "The provider was not found.",
  });
}

function versionConflict(): ConflictException {
  return new ConflictException({
    code: "PROVIDER_VERSION_CONFLICT",
    message: "The provider changed since it was loaded. Reload and try again.",
  });
}

function secretsUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: "PROVIDER_SECRETS_UNAVAILABLE",
    message: "Provider secrets are unavailable. Check the encryption key configuration.",
  });
}

function lastFour(value: string): string | null {
  return value.length > 0 ? value.slice(-4) : null;
}

function secretAad(providerId: string, field: string): string {
  return `provider:${providerId}:${field}`;
}

@Injectable()
export class ProviderSecretService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async listStates(providerId: string): Promise<ProviderSecretState[]> {
    const provider = await this.prisma.client.providerConnection.findUnique({
      where: { id: providerId },
      select: { id: true, deletedAt: true },
    });
    if (!provider || provider.deletedAt !== null) {
      throw providerNotFound();
    }

    const rows = await this.prisma.client.providerSecret.findMany({
      where: { providerId },
      orderBy: { field: "asc" },
      select: { field: true, last4: true, version: true },
    });
    return rows.map((row) => ({
      field: row.field,
      hasValue: true,
      last4: row.last4,
      version: row.version,
    }));
  }

  async resolvePlaintext(providerId: string): Promise<Readonly<Record<string, string>>> {
    const provider = await this.prisma.client.providerConnection.findUnique({
      where: { id: providerId },
      select: { id: true, deletedAt: true },
    });
    if (!provider || provider.deletedAt !== null) {
      throw providerNotFound();
    }

    const rows = await this.prisma.client.providerSecret.findMany({
      where: { providerId },
      select: { field: true, ciphertext: true },
    });
    if (rows.length === 0) {
      return {};
    }

    const box = this.box();
    const values: Record<string, string> = {};
    for (const row of rows) {
      try {
        values[row.field] = box.decrypt(secretAad(providerId, row.field), row.ciphertext);
      } catch (error) {
        if (error instanceof SecretBoxError) {
          throw secretsUnavailable();
        }
        throw error;
      }
    }
    return values;
  }

  async replace(
    input: ReplaceProviderSecretInput,
    client?: ProviderSecretClient,
  ): Promise<ProviderSecretState> {
    const field = ProviderSecretFieldSchema.safeParse(input.field);
    if (!field.success) {
      throw new BadRequestException({
        code: "PROVIDER_SECRET_FIELD_UNKNOWN",
        message: "The provider secret field is invalid.",
      });
    }
    if (!input.value || input.value.length > 4_096) {
      throw new BadRequestException({
        code: "PROVIDER_CONFIG_INVALID",
        message: "Provider secrets must contain between 1 and 4096 characters.",
      });
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new BadRequestException({
        code: "PROVIDER_CONFIG_INVALID",
        message: "The expected provider version is invalid.",
      });
    }

    const now = new Date();
    const encrypted = this.box().encrypt(secretAad(input.providerId, field.data), input.value);
    const execute = (transaction: ProviderSecretClient) =>
      this.replaceInTransaction(transaction, input, field.data, encrypted, now);

    const state = client
      ? await execute(client)
      : await this.prisma.client.$transaction((transaction) => execute(transaction));

    if (!client) {
      void this.cleanupExpired(now).catch(() => undefined);
    }
    return state;
  }

  async cleanupExpired(now = new Date(), client?: ProviderSecretClient): Promise<number> {
    const writer = client ?? this.prisma.client;
    const deleted = await writer.providerSecretHistory.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return deleted.count;
  }

  private async replaceInTransaction(
    client: ProviderSecretClient,
    input: ReplaceProviderSecretInput,
    field: string,
    encrypted: ReturnType<SecretBox["encrypt"]>,
    now: Date,
  ): Promise<ProviderSecretState> {
    const provider = await client.providerConnection.findUnique({
      where: { id: input.providerId },
      select: { id: true, version: true, deletedAt: true },
    });
    if (!provider || provider.deletedAt !== null) {
      throw providerNotFound();
    }
    if (provider.version !== input.expectedVersion) {
      throw versionConflict();
    }

    const existing = await client.providerSecret.findUnique({
      where: {
        providerId_field: {
          providerId: input.providerId,
          field,
        },
      },
      select: {
        ciphertext: true,
        last4: true,
        keyVersion: true,
      },
    });
    if (existing) {
      await client.providerSecretHistory.create({
        data: {
          providerId: input.providerId,
          field,
          ciphertext: existing.ciphertext,
          last4: existing.last4,
          keyVersion: existing.keyVersion,
          replacedAt: now,
          expiresAt: new Date(now.getTime() + HISTORY_TTL_MS),
        },
      });
    }

    const secret = await client.providerSecret.upsert({
      where: {
        providerId_field: {
          providerId: input.providerId,
          field,
        },
      },
      create: {
        providerId: input.providerId,
        field,
        ciphertext: encrypted.ciphertext,
        last4: lastFour(input.value),
        keyVersion: encrypted.keyVersion,
      },
      update: {
        ciphertext: encrypted.ciphertext,
        last4: lastFour(input.value),
        keyVersion: encrypted.keyVersion,
        version: { increment: 1 },
      },
      select: {
        field: true,
        last4: true,
        version: true,
      },
    });

    const bumped = await client.providerConnection.updateMany({
      where: {
        id: input.providerId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: {
        version: { increment: 1 },
        updatedById: input.actor.user.id,
      },
    });
    if (bumped.count !== 1) {
      throw versionConflict();
    }

    await this.audit.record(
      {
        actorId: input.actor.user.id,
        actorType: "admin",
        action: "admin.provider.secret_replaced",
        targetType: "provider",
        targetId: input.providerId,
        ip: input.actor.ip ?? undefined,
        userAgent: input.actor.userAgent ?? undefined,
        metadata: {
          field: secret.field,
          last4: secret.last4,
          version: secret.version,
        },
      },
      client,
    );

    return {
      field: secret.field,
      hasValue: true,
      last4: secret.last4,
      version: secret.version,
    };
  }

  private box(): SecretBox {
    try {
      return SecretBox.fromEnvironment({
        CONFIG_ENCRYPTION_KEY: this.config.configEncryptionKey,
        CONFIG_ENCRYPTION_KEYS: this.config.configEncryptionKeys,
      });
    } catch (error) {
      if (error instanceof SecretBoxError) {
        throw secretsUnavailable();
      }
      throw error;
    }
  }
}
