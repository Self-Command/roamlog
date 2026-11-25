import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  AI_DEFAULT_REASONING_EFFORT,
  UuidV7Schema,
  type AiChatModel,
  type AiChatModelsResponse,
  type AiReasoningEffort,
  type ProviderModelCapabilities,
} from "@roamlog/contracts";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  ProviderRuntimeService,
  type ProviderRuntime,
} from "../providers/provider-runtime.service.js";
import { AiUpstreamError } from "./adapters/http.js";
import {
  AI_SETTINGS_SOURCE,
  type AiProtocol,
  type AiSettings,
  type AiSettingsSource,
} from "./ai.settings.js";

const AI_PROTOCOLS: ReadonlySet<string> = new Set<AiProtocol>([
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
]);
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ALLOWED_MODELS = 20;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const REASONING_EFFORTS: ReadonlySet<string> = new Set<AiReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
]);

export interface AiProviderModel {
  readonly modelId: string;
  readonly displayName: string;
  readonly ownedBy: string | null;
  readonly isDefault: boolean;
  readonly capabilities: ProviderModelCapabilities;
}

export interface AiProviderCandidate {
  readonly runtime: ProviderRuntime;
  readonly settings: AiSettings;
  readonly model: AiProviderModel;
}

export interface AiStreamFailoverFrame<TEvent> {
  readonly candidate: AiProviderCandidate;
  readonly event: TEvent;
}

export interface AiStreamFailoverResult<TOutcome> {
  readonly candidate: AiProviderCandidate;
  readonly outcome: TOutcome;
}

interface ProviderCatalogEntry {
  readonly runtime: ProviderRuntime;
  readonly models: readonly AiProviderModel[];
  readonly defaultModel: string | null;
  readonly legacySettings: AiSettings | null;
  /** Platform fallback when this provider has no explicit reasoning choice. */
  readonly platformReasoningEffort?: AiReasoningEffort;
}

interface ProviderModelRow {
  modelId: string;
  displayName: string;
  ownedBy: string | null;
  enabled: boolean;
  isDefault: boolean;
  capabilities: unknown;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function reasoningEffort(value: unknown): AiReasoningEffort | undefined {
  return typeof value === "string" && REASONING_EFFORTS.has(value)
    ? (value as AiReasoningEffort)
    : undefined;
}

function capabilitiesOf(value: unknown): ProviderModelCapabilities {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const source = value as Record<string, unknown>;
  return {
    ...(typeof source.vision === "boolean" ? { vision: source.vision } : {}),
    ...(typeof source.reasoning === "boolean" ? { reasoning: source.reasoning } : {}),
    ...(typeof source.tools === "boolean" ? { tools: source.tools } : {}),
  };
}

function providerModel(row: ProviderModelRow, defaultModel: string | null): AiProviderModel {
  return {
    modelId: row.modelId,
    displayName: row.displayName,
    ownedBy: row.ownedBy,
    isDefault: row.isDefault || row.modelId === defaultModel,
    capabilities: capabilitiesOf(row.capabilities),
  };
}

function unavailable(message = "No eligible AI provider is configured."): HttpException {
  return new HttpException(
    { code: "AI_PROVIDERS_UNAVAILABLE", message },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function modelNotAllowed(): HttpException {
  return new HttpException(
    {
      code: "AI_MODEL_NOT_ALLOWED",
      message: "That model is not enabled for this workspace.",
    },
    HttpStatus.BAD_REQUEST,
  );
}

@Injectable()
export class AiProviderRouter {
  constructor(
    @Inject(ProviderRuntimeService) private readonly runtimes: ProviderRuntimeService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_SETTINGS_SOURCE) private readonly legacySettings: AiSettingsSource,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  /**
   * Ordered provider candidates for one request.
   *
   * The router never invents a model choice: an explicit request must match an
   * enabled provider model, and the default path requires a saved default. A
   * provider with multiple discovered models but no default is a draft, not a
   * runnable route.
   */
  async candidates(model?: string): Promise<readonly AiProviderCandidate[]> {
    const entries = await this.resolveProviders();
    if (entries.length === 0) {
      throw unavailable();
    }

    const requested = model?.trim() || null;
    const candidates: AiProviderCandidate[] = [];
    for (const entry of entries) {
      const selected = requested
        ? entry.models.find((entryModel) => entryModel.modelId === requested)
        : entry.models.find((entryModel) => entryModel.isDefault);
      if (!selected) {
        continue;
      }
      const settings = this.settingsFor(entry, selected, requested ?? selected.modelId);
      if (!settings.configured) {
        continue;
      }
      candidates.push({ runtime: entry.runtime, settings, model: selected });
    }

    if (candidates.length > 0) {
      return Object.freeze(candidates);
    }
    if (requested) {
      throw modelNotAllowed();
    }
    throw unavailable("AI providers are configured but none has a default model.");
  }

  /** The model selector's union, in provider priority order. */
  async chatModels(): Promise<AiChatModelsResponse> {
    const entries = await this.resolveProviders();
    const seen = new Set<string>();
    const models: AiChatModel[] = [];
    let defaultModel: string | null = null;

    for (const entry of entries) {
      const entryDefault = entry.models.find((model) => model.isDefault)?.modelId ?? null;
      if (defaultModel === null && entryDefault) {
        defaultModel = entryDefault;
      }
      for (const model of entry.models) {
        if (seen.has(model.modelId)) {
          continue;
        }
        seen.add(model.modelId);
        models.push({
          id: model.modelId,
          name: model.displayName.slice(0, 80),
          provider: (model.ownedBy ?? entry.runtime.preset ?? entry.runtime.adapter).slice(0, 40),
          reasoning: entry.runtime.adapter !== "anthropic-messages",
          vision: model.capabilities.vision === true,
        });
        if (models.length >= MAX_ALLOWED_MODELS) {
          break;
        }
      }
      if (models.length >= MAX_ALLOWED_MODELS) {
        break;
      }
    }

    if (models.length === 0 || defaultModel === null) {
      throw unavailable();
    }
    return {
      models,
      defaultModel,
      reasoningSupported: models.some((model) => model.reasoning),
    };
  }

  /**
   * Runs one attempt per ordered candidate. Only transport-level failures and
   * upstream 408/429/5xx are eligible for the next provider; auth/model/request
   * errors are surfaced instead of being hidden by failover.
   */
  async runWithFailover<T>(
    candidates: readonly AiProviderCandidate[],
    attempt: (candidate: AiProviderCandidate, attempt: number) => Promise<T>,
    maxAttempts?: number,
  ): Promise<T> {
    const limit = await this.attemptLimit(candidates.length, maxAttempts);
    let lastError: unknown;
    for (let index = 0; index < limit; index += 1) {
      const candidate = candidates[index];
      if (!candidate) {
        break;
      }
      try {
        const result = await attempt(candidate, index + 1);
        if (index > 0) {
          this.logger.log(
            {
              event: "ai.provider_failover_succeeded",
              providerId: candidate.runtime.id,
              adapter: candidate.runtime.adapter,
              preset: candidate.runtime.preset,
              model: candidate.settings.model,
              attempt: index + 1,
            },
            "ai.provider_failover_succeeded",
          );
        }
        return result;
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryable(error) && index + 1 < limit;
        this.logger.warn(
          {
            event: "ai.provider_attempt_failed",
            providerId: candidate.runtime.id,
            adapter: candidate.runtime.adapter,
            preset: candidate.runtime.preset,
            model: candidate.settings.model,
            attempt: index + 1,
            willRetry: retryable,
            ...this.failureDetail(error),
          },
          "ai.provider_attempt_failed",
        );
        if (!retryable) {
          throw error;
        }
      }
    }
    throw lastError ?? unavailable();
  }

  /**
   * Streams the first eligible provider but withholds every event until the
   * attempt is committed.
   *
   * `meta` and progress frames are buffered. A transport failure before the
   * first committed event discards the buffer and moves to the next provider.
   * Once a committed event has been yielded, the caller sees exactly one
   * terminal error path from `streamChat`; the user message is never replayed.
   */
  async *streamWithFailover<TEvent, TOutcome>(
    candidates: readonly AiProviderCandidate[],
    attempt: (
      candidate: AiProviderCandidate,
      attempt: number,
    ) => AsyncGenerator<TEvent, TOutcome, void>,
    isCommitted: (event: TEvent) => boolean,
    options: { signal?: AbortSignal; maxAttempts?: number } = {},
  ): AsyncGenerator<AiStreamFailoverFrame<TEvent>, AiStreamFailoverResult<TOutcome>, void> {
    const limit = await this.attemptLimit(candidates.length, options.maxAttempts);
    let lastError: unknown;

    for (let index = 0; index < limit; index += 1) {
      this.throwIfAborted(options.signal);
      const candidate = candidates[index];
      if (!candidate) {
        break;
      }

      const iterator = attempt(candidate, index + 1);
      const buffered: TEvent[] = [];
      let committed = false;
      let finished = false;

      try {
        for (;;) {
          this.throwIfAborted(options.signal);
          const next = await iterator.next();
          if (next.done) {
            finished = true;
            if (!committed) {
              for (const event of buffered) {
                yield { candidate, event };
              }
            }
            if (index > 0) {
              this.logger.log(
                {
                  event: "ai.provider_stream_failover_succeeded",
                  providerId: candidate.runtime.id,
                  adapter: candidate.runtime.adapter,
                  preset: candidate.runtime.preset,
                  model: candidate.settings.model,
                  attempt: index + 1,
                },
                "ai.provider_stream_failover_succeeded",
              );
            }
            return { candidate, outcome: next.value };
          }

          const event = next.value;
          if (!committed && isCommitted(event)) {
            committed = true;
            for (const bufferedEvent of buffered) {
              yield { candidate, event: bufferedEvent };
            }
            buffered.length = 0;
          }
          if (committed) {
            yield { candidate, event };
          } else {
            buffered.push(event);
          }
        }
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) {
          throw error;
        }
        if (committed) {
          throw error;
        }
        const retryable = this.isRetryable(error) && index + 1 < limit;
        this.logger.warn(
          {
            event: "ai.provider_stream_attempt_failed",
            providerId: candidate.runtime.id,
            adapter: candidate.runtime.adapter,
            preset: candidate.runtime.preset,
            model: candidate.settings.model,
            attempt: index + 1,
            willRetry: retryable,
            ...this.failureDetail(error),
          },
          "ai.provider_stream_attempt_failed",
        );
        if (!retryable) {
          throw error;
        }
      } finally {
        if (!finished) {
          try {
            await iterator.return(undefined as TOutcome);
          } catch {
            // The attempt already failed; its cleanup error must not replace it.
          }
        }
      }
    }

    throw lastError ?? unavailable();
  }

  isRetryable(error: unknown): boolean {
    if (error instanceof AiUpstreamError) {
      if (error.kind === "timeout" || error.kind === "network") {
        return true;
      }
      if (error.kind === "http") {
        const status = error.httpStatus ?? 0;
        return (
          status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
        );
      }
      return false;
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
    }
    return (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    );
  }

  private async resolveProviders(): Promise<readonly ProviderCatalogEntry[]> {
    const group = await this.runtimes.resolveGroup("ai");
    if (group.providers.length === 0) {
      return Object.freeze([]);
    }
    const platformDefaults = await this.legacySettings.resolve();

    const databaseIds = group.providers
      .map((provider) => provider.id)
      .filter((id) => UuidV7Schema.safeParse(id).success);
    const rows =
      databaseIds.length === 0
        ? []
        : await this.prisma.client.providerModel.findMany({
            where: {
              providerId: { in: databaseIds },
              enabled: true,
            },
            select: {
              providerId: true,
              modelId: true,
              displayName: true,
              ownedBy: true,
              enabled: true,
              isDefault: true,
              capabilities: true,
            },
            orderBy: [{ isDefault: "desc" }, { modelId: "asc" }],
          });
    const byProvider = new Map<string, ProviderModelRow[]>();
    for (const row of rows) {
      const list = byProvider.get(row.providerId) ?? [];
      list.push(row);
      byProvider.set(row.providerId, list);
    }

    const entries: ProviderCatalogEntry[] = [];
    for (const runtime of group.providers) {
      if (!AI_PROTOCOLS.has(runtime.adapter)) {
        continue;
      }
      const config = runtime.config;
      const defaultModel = safeString(config.defaultModel);
      const legacy = runtime.id === "legacy:ai" ? platformDefaults : null;
      const stored = byProvider.get(runtime.id) ?? [];
      const models = stored.map((row) => providerModel(row, defaultModel));
      if (models.length === 0 && defaultModel) {
        models.push({
          modelId: defaultModel,
          displayName: defaultModel,
          ownedBy: runtime.preset,
          isDefault: true,
          capabilities: { vision: legacy?.vision === true },
        });
      }
      if (legacy) {
        const legacyModels = legacy.allowedModels.map((modelId) => ({
          modelId,
          displayName: modelId,
          ownedBy: runtime.preset,
          isDefault: modelId === legacy.model,
          capabilities: { vision: legacy.vision === true },
        }));
        entries.push({
          runtime,
          models: legacyModels.length > 0 ? legacyModels : models,
          defaultModel: legacy.model || defaultModel,
          legacySettings: legacy,
          platformReasoningEffort:
            legacy.reasoningEffort ?? AI_DEFAULT_REASONING_EFFORT,
        });
        continue;
      }
      entries.push({
        runtime,
        models,
        defaultModel,
        legacySettings: null,
        platformReasoningEffort:
          platformDefaults.reasoningEffort ?? AI_DEFAULT_REASONING_EFFORT,
      });
    }
    return Object.freeze(entries);
  }

  private async attemptLimit(candidateCount: number, maxAttempts?: number): Promise<number> {
    let budget = maxAttempts;
    if (budget === undefined) {
      try {
        budget = (await this.runtimes.resolveGroup("ai")).policy.maxAttempts;
      } catch {
        budget = DEFAULT_MAX_ATTEMPTS;
      }
    }
    return Math.max(1, Math.min(candidateCount, Math.max(1, budget)));
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException("The AI stream was aborted.", "AbortError");
    }
  }

  private settingsFor(
    entry: ProviderCatalogEntry,
    selected: AiProviderModel,
    model: string,
  ): AiSettings {
    const config = entry.runtime.config;
    const allowed = [...new Set([...entry.models.map((item) => item.modelId), model])].slice(
      0,
      MAX_ALLOWED_MODELS,
    );
    if (entry.legacySettings) {
      return {
        ...entry.legacySettings,
        protocol: entry.runtime.adapter as AiProtocol,
        model,
        allowedModels: allowed.length > 0 ? allowed : [model],
        configured: true,
        vision: selected.capabilities.vision === true,
      };
    }
    return {
      protocol: entry.runtime.adapter as AiProtocol,
      baseUrl: safeString(config.baseUrl),
      apiKey: safeString(entry.runtime.secrets.apiKey),
      model,
      allowedModels: allowed.length > 0 ? allowed : [model],
      timeoutMs: safeInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS),
      maxOutputTokens: safeInteger(config.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
      dailyQuota: 0,
      vision: selected.capabilities.vision === true,
      configured: Boolean(safeString(config.baseUrl) && model),
      reasoningEffort:
        reasoningEffort(config.reasoningEffort) ??
        entry.platformReasoningEffort ??
        AI_DEFAULT_REASONING_EFFORT,
    };
  }

  private failureDetail(error: unknown): { code: string; status?: number } {
    if (error instanceof AiUpstreamError) {
      return {
        code: `AI_UPSTREAM_${error.kind.toUpperCase()}`,
        ...(error.httpStatus === undefined ? {} : { status: error.httpStatus }),
      };
    }
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const code =
        typeof response === "object" &&
        response !== null &&
        "code" in response &&
        typeof response.code === "string"
          ? response.code
          : "HTTP_EXCEPTION";
      return { code, status: error.getStatus() };
    }
    return { code: error instanceof Error ? error.name : "UNKNOWN" };
  }
}
