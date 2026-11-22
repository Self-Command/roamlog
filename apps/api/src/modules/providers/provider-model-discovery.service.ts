import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  ProviderModelCapabilitiesSchema,
  ProviderModelDiscoveryRequestSchema,
  ProviderModelDiscoveryResponseSchema,
  type ProviderDiscoveredModel,
  type ProviderModelCapabilities,
  type ProviderModelDiscoveryRequest,
  type ProviderModelDiscoveryResponse,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  optionalProviderPresetDefinition,
  parseProviderConfig,
  requireProviderAdapter,
} from "./provider-catalog.js";
import type {
  ProviderAdapter,
  ProviderAdapterDefinition,
  ProviderPresetDefinition,
} from "./provider-contracts.js";
import { ProviderEgressGuard } from "./provider-egress.js";
import { ProviderProblemException, providerProblem } from "./provider-errors.js";
import { ProviderRuntimeService } from "./provider-runtime.service.js";
import { ProviderSecretService } from "./provider-secret.service.js";

const DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_MODELS = 200;
const ANTHROPIC_VERSION = "2023-06-01";

export type DiscoverProviderModelsInput = ProviderModelDiscoveryRequest;

interface ProviderDiscoveryRow {
  id: string;
  group: string;
  adapter: string;
  preset: string | null;
  config: unknown;
  version: number;
  deletedAt: Date | null;
}

interface SavedDiscoveryContext {
  row: ProviderDiscoveryRow;
  adapter: ProviderAdapterDefinition;
  preset: ProviderPresetDefinition;
  baseUrl: string;
  apiKey: string | null;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function modelRows(payload: Record<string, unknown>): readonly Record<string, unknown>[] {
  const rows = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];
  return rows.map(jsonObject).filter((row): row is Record<string, unknown> => row !== null);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export function parseProviderCatalog(
  payload: unknown,
  _adapter: ProviderAdapter,
): readonly ProviderDiscoveredModel[] {
  const object = jsonObject(payload);
  if (!object) {
    throw providerProblem(
      "PROVIDER_MODELS_DISCOVERY_FAILED",
      "The provider did not return a JSON model catalog.",
    );
  }

  const models: ProviderDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const row of modelRows(object)) {
    const rawId = text(row.id, 200) ?? text(row.name, 200);
    if (!rawId || seen.has(rawId)) {
      continue;
    }
    seen.add(rawId);
    const publishedName =
      text(row.display_name, 160) ?? text(row.displayName, 160) ?? text(row.name, 160);
    models.push({
      modelId: rawId,
      displayName: publishedName ?? rawId,
      ownedBy: text(row.owned_by, 80) ?? text(row.ownedBy, 80),
      capabilities: {},
    });
    if (models.length >= MAX_MODELS) {
      break;
    }
  }
  return models;
}

function discoveryEndpoint(baseUrl: string, preset: ProviderPresetDefinition): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw providerProblem("PROVIDER_CONFIG_INVALID", "Enter a valid provider base URL.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw providerProblem(
      "PROVIDER_CONFIG_INVALID",
      "Provider base URLs must be HTTP(S) without credentials, a query string, or a fragment.",
    );
  }

  const suffix = preset.discoveryPath ?? "/models";
  const pathname = url.pathname.replace(/\/+$/u, "");
  if (!pathname.endsWith(suffix)) {
    url.pathname = `${pathname}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
  }
  return url;
}

async function readLimitedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw providerProblem(
      "PROVIDER_MODELS_RESPONSE_TOO_LARGE",
      "The provider model catalog is too large.",
    );
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw providerProblem(
          "PROVIDER_MODELS_RESPONSE_TOO_LARGE",
          "The provider model catalog is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0) {
    return "";
  }
  return new TextDecoder().decode(
    chunks.length === 1
      ? (chunks[0] ?? new Uint8Array())
      : Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
  );
}

function authHeaders(key: string | null, preset: ProviderPresetDefinition): Record<string, string> {
  if (!key) {
    return {};
  }
  if (preset.authHeader === "anthropic") {
    return {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }
  if (preset.authHeader === "bearer") {
    return { authorization: `Bearer ${key}` };
  }
  return {};
}

function safeDiscoveryError(error: unknown): ProviderProblemException {
  if (error instanceof ProviderProblemException) {
    return error;
  }
  return providerProblem(
    "PROVIDER_MODELS_DISCOVERY_FAILED",
    "The provider model catalog request failed.",
  );
}

@Injectable()
export class ProviderModelDiscoveryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProviderSecretService) private readonly secrets: ProviderSecretService,
    @Inject(ProviderEgressGuard) private readonly egress: ProviderEgressGuard,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional()
    @Inject(ProviderRuntimeService)
    private readonly runtime?: ProviderRuntimeService,
  ) {}

  async discoverDraft(
    _actor: AuthenticatedActor,
    rawInput: DiscoverProviderModelsInput,
  ): Promise<ProviderModelDiscoveryResponse> {
    const input = parseRequest(ProviderModelDiscoveryRequestSchema, rawInput);
    if (input.group !== "ai") {
      throw providerProblem(
        "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED",
        "Model discovery is only available for AI providers.",
      );
    }
    const adapter = requireProviderAdapter(input.adapter);
    const preset =
      optionalProviderPresetDefinition(adapter.adapter, input.preset) ?? adapter.presets[0];
    if (!preset) {
      throw providerProblem(
        "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED",
        "This provider adapter has no discovery preset.",
      );
    }
    if (preset.modelDiscovery === "manual-only") {
      throw providerProblem(
        "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED",
        "This provider requires a manually entered model ID.",
      );
    }
    if (!input.baseUrl) {
      throw providerProblem("PROVIDER_CONFIG_INVALID", "A provider Base URL is required.");
    }

    const models = await this.discoverModels({
      adapter,
      preset,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey ?? null,
    });
    return ProviderModelDiscoveryResponseSchema.parse({
      models: [...models],
      fetchedAt: new Date().toISOString(),
      manualEntryRequired: models.length === 0 && preset.manualModelAllowed,
    });
  }

  async refreshSaved(
    actor: AuthenticatedActor,
    providerId: string,
    expectedVersion?: number,
  ): Promise<ProviderModelDiscoveryResponse> {
    const context = await this.savedContext(providerId);
    if (expectedVersion !== undefined && context.row.version !== expectedVersion) {
      throw providerProblem("PROVIDER_VERSION_CONFLICT");
    }
    try {
      const models = await this.discoverModels(context);
      const previous = await this.prisma.client.providerModel.findMany({
        where: { providerId },
        select: { modelId: true, isDefault: true, capabilities: true },
      });
      const previousDefault = previous.find((model) => model.isDefault);
      const fetchedAt = new Date();
      if (previousDefault && !models.some((model) => model.modelId === previousDefault.modelId)) {
        throw providerProblem(
          "PROVIDER_MODEL_DEFAULT_REQUIRED",
          "The saved default model was not returned by the provider. Choose a new default model.",
          [
            {
              field: "defaultModel",
              code: "PROVIDER_MODEL_DEFAULT_REQUIRED",
              message: "Choose a default model before enabling this provider.",
            },
          ],
        );
      }
      const storedCapabilities = new Map<string, ProviderModelCapabilities>();
      for (const model of previous) {
        const parsed = ProviderModelCapabilitiesSchema.safeParse(model.capabilities);
        if (parsed.success) {
          storedCapabilities.set(model.modelId, parsed.data);
        }
      }
      const modelsWithCapabilities = models.map((model) => ({
        ...model,
        capabilities: storedCapabilities.get(model.modelId) ?? {},
      }));

      await this.prisma.client.$transaction(async (transaction) => {
        for (const model of models) {
          await transaction.providerModel.upsert({
            where: {
              providerId_modelId: {
                providerId,
                modelId: model.modelId,
              },
            },
            create: {
              providerId,
              modelId: model.modelId,
              displayName: model.displayName,
              ownedBy: model.ownedBy,
              capabilities: {},
              discoveredAt: fetchedAt,
            },
            update: {
              displayName: model.displayName,
              ownedBy: model.ownedBy,
              discoveredAt: fetchedAt,
            },
          });
        }
        const updated = await transaction.providerConnection.updateMany({
          where: { id: providerId, version: context.row.version, deletedAt: null },
          data: {
            lastCheckedAt: fetchedAt,
            lastErrorCode: null,
            healthStatus: "healthy",
            consecutiveFailures: 0,
            cooldownUntil: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw providerProblem("PROVIDER_VERSION_CONFLICT");
        }
        await this.audit.record(
          {
            actorId: actor.user.id,
            actorType: "admin",
            action: "admin.provider.models_refreshed",
            targetType: "provider",
            targetId: providerId,
            ip: actor.ip ?? undefined,
            userAgent: actor.userAgent ?? undefined,
            metadata: {
              adapter: context.adapter.adapter,
              preset: context.preset.preset,
              modelCount: models.length,
            },
          },
          transaction,
        );
      });
      await this.runtime?.invalidate("ai");

      return ProviderModelDiscoveryResponseSchema.parse({
        models: modelsWithCapabilities,
        fetchedAt: fetchedAt.toISOString(),
        manualEntryRequired: models.length === 0 && context.preset.manualModelAllowed,
      });
    } catch (error) {
      const safe = safeDiscoveryError(error);
      if (safe.code !== "PROVIDER_MODEL_DEFAULT_REQUIRED") {
        await this.recordFailure(providerId, safe.code);
      }
      throw safe;
    }
  }

  private async savedContext(providerId: string): Promise<SavedDiscoveryContext> {
    const row = await this.prisma.client.providerConnection.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        group: true,
        adapter: true,
        preset: true,
        config: true,
        version: true,
        deletedAt: true,
      },
    });
    if (!row || row.deletedAt !== null) {
      throw providerProblem("PROVIDER_NOT_FOUND", "The provider was not found.");
    }
    if (row.group !== "ai") {
      throw providerProblem(
        "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED",
        "Model discovery is only available for AI providers.",
      );
    }

    const adapter = requireProviderAdapter(row.adapter);
    const preset =
      optionalProviderPresetDefinition(adapter.adapter, row.preset) ?? adapter.presets[0];
    if (!preset || preset.modelDiscovery === "manual-only") {
      throw providerProblem(
        "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED",
        "This provider requires a manually entered model ID.",
      );
    }

    const config = parseProviderConfig(row.adapter, row.config) as {
      baseUrl: string;
    };
    const secrets = await this.secrets.resolvePlaintext(providerId);
    return {
      row,
      adapter,
      preset,
      baseUrl: config.baseUrl,
      apiKey: secrets.apiKey ?? null,
    };
  }

  private async discoverModels(
    context: Pick<SavedDiscoveryContext, "adapter" | "preset" | "baseUrl" | "apiKey">,
  ): Promise<readonly ProviderDiscoveredModel[]> {
    const endpoint = discoveryEndpoint(context.baseUrl, context.preset);
    await this.egress.assertAllowed(endpoint);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            ...authHeaders(context.apiKey, context.preset),
          },
        });
      } catch {
        if (controller.signal.aborted) {
          throw providerProblem(
            "PROVIDER_MODELS_DISCOVERY_TIMEOUT",
            "The provider model catalog request timed out.",
          );
        }
        throw providerProblem(
          "PROVIDER_MODELS_DISCOVERY_FAILED",
          "The provider could not be reached. Check the base URL and network access.",
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw providerProblem(
          "PROVIDER_MODELS_DISCOVERY_FAILED",
          "The provider rejected the API key.",
        );
      }
      if (response.status === 404) {
        throw providerProblem(
          "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED",
          "This Base URL does not expose a supported model catalog.",
        );
      }
      if (response.status === 429) {
        throw providerProblem(
          "PROVIDER_LIMIT_REACHED",
          "The provider rate-limited the model catalog request.",
        );
      }
      if (!response.ok) {
        throw providerProblem(
          "PROVIDER_MODELS_DISCOVERY_FAILED",
          "The provider model catalog request failed.",
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(await readLimitedBody(response)) as unknown;
      } catch (error) {
        if (error instanceof ProviderProblemException) {
          throw error;
        }
        if (controller.signal.aborted) {
          throw providerProblem(
            "PROVIDER_MODELS_DISCOVERY_TIMEOUT",
            "The provider model catalog request timed out.",
          );
        }
        throw providerProblem(
          "PROVIDER_MODELS_DISCOVERY_FAILED",
          "The provider did not return a JSON model catalog.",
        );
      }
      return parseProviderCatalog(payload, context.adapter.adapter);
    } finally {
      clearTimeout(timer);
    }
  }

  private async recordFailure(providerId: string, code: string): Promise<void> {
    try {
      await this.prisma.client.providerConnection.updateMany({
        where: { id: providerId, deletedAt: null },
        data: {
          lastCheckedAt: new Date(),
          lastErrorCode: code.slice(0, 80),
          healthStatus: "degraded",
          consecutiveFailures: { increment: 1 },
        },
      });
    } catch {
      // Discovery failure is the primary error; health persistence is best effort.
    }
  }
}
