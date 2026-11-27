import { Inject, Injectable } from "@nestjs/common";
import {
  ProviderDraftProbeRequestSchema,
  ProviderProbeResponseSchema,
  type ProviderDraftProbeRequest,
  type ProviderGroup,
  type ProviderProbeCheck,
  type ProviderProbeResponse,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { uuidV7FromString } from "../admin/admin-ids.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  optionalProviderPresetDefinition,
  parseProviderConfig,
  requireProviderAdapter,
} from "./provider-catalog.js";
import type { ProviderAdapterDefinition, ProviderPresetDefinition } from "./provider-contracts.js";
import { ProviderEgressGuard } from "./provider-egress.js";
import { ProviderProblemException, providerProblem } from "./provider-errors.js";
import { ProviderSecretService } from "./provider-secret.service.js";

const PROBE_TIMEOUT_MS = 5_000;
const MAX_PROBE_BYTES = 256 * 1_024;
const RESEND_PROBE_URL = "https://api.resend.com/domains";

interface ProbeCandidate {
  readonly providerId: string | null;
  readonly group: ProviderGroup;
  readonly adapter: ProviderAdapterDefinition;
  readonly preset: ProviderPresetDefinition;
  readonly config: Record<string, unknown>;
  readonly secrets: Readonly<Record<string, string>>;
}

function check(
  name: string,
  status: ProviderProbeCheck["status"],
  latencyMs: number | null = null,
  code: string | null = null,
  message: string | null = null,
): ProviderProbeCheck {
  return { name, status, latencyMs, code, message };
}

function urlOf(value: unknown): URL | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function appendPath(base: URL, suffix: string): URL {
  const target = new URL(base.toString());
  target.pathname = `${target.pathname.replace(/\/+$/u, "")}/${suffix.replace(/^\/+/u, "")}`;
  return target;
}

function authHeaders(
  secrets: Readonly<Record<string, string>>,
  preset: ProviderPresetDefinition,
): Record<string, string> {
  const apiKey = secrets.apiKey;
  if (!apiKey) {
    return {};
  }
  if (preset.authHeader === "anthropic") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  if (preset.authHeader === "bearer") {
    return { authorization: `Bearer ${apiKey}` };
  }
  return {};
}

function requiredSecretsPresent(candidate: ProbeCandidate): string[] {
  return candidate.adapter.secretFields
    .filter((field) => field.required && !candidate.secrets[field.key])
    .map((field) => field.key);
}

function smtpProbeCode(error: unknown, startedAt: number): string {
  const failure = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    responseCode?: unknown;
  };
  const code = typeof failure.code === "string" ? failure.code.trim().toUpperCase() : "";
  const status = typeof failure.responseCode === "number" ? failure.responseCode : undefined;
  if (code === "EAUTH" || status === 530 || status === 535) {
    return "AUTH_FAILED";
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    Date.now() - startedAt >= PROBE_TIMEOUT_MS
  ) {
    return "PROVIDER_PROBE_TIMEOUT";
  }
  return "PROVIDER_PROBE_FAILED";
}

@Injectable()
export class ProviderProbeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProviderSecretService) private readonly secrets: ProviderSecretService,
    @Inject(ProviderEgressGuard) private readonly egress: ProviderEgressGuard,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async probeDraft(actor: AuthenticatedActor, rawInput: unknown): Promise<ProviderProbeResponse> {
    const input = parseRequest(ProviderDraftProbeRequestSchema, rawInput);
    const candidate = this.draftCandidate(input);
    const checks = await this.runChecks(candidate);
    await this.auditProbe(actor, candidate, null, checks);
    return this.response(null, checks);
  }

  async probeSaved(
    actor: AuthenticatedActor,
    providerId: string,
    expectedVersion: number,
  ): Promise<ProviderProbeResponse> {
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
      throw providerProblem("PROVIDER_NOT_FOUND");
    }
    if (row.version !== expectedVersion) {
      throw providerProblem("PROVIDER_VERSION_CONFLICT");
    }

    const adapter = requireProviderAdapter(row.adapter);
    const preset =
      optionalProviderPresetDefinition(adapter.adapter, row.preset) ?? adapter.presets[0];
    if (!preset) {
      throw providerProblem("PROVIDER_ADAPTER_UNSUPPORTED");
    }
    const candidate: ProbeCandidate = {
      providerId,
      group: adapter.group,
      adapter,
      preset,
      config: parseProviderConfig(row.adapter, row.config),
      secrets: await this.secrets.resolvePlaintext(providerId),
    };
    const checks = await this.runChecks(candidate);
    const failed = checks.find((entry) => entry.status === "fail");
    const updated = await this.prisma.client.providerConnection.updateMany({
      where: { id: providerId, version: expectedVersion, deletedAt: null },
      data: {
        healthStatus: failed ? "unhealthy" : "healthy",
        lastCheckedAt: new Date(),
        lastErrorCode: failed?.code ?? null,
        consecutiveFailures: failed ? { increment: 1 } : 0,
        cooldownUntil: failed ? new Date(Date.now() + 30_000) : null,
      },
    });
    if (updated.count !== 1) {
      throw providerProblem("PROVIDER_VERSION_CONFLICT");
    }
    await this.auditProbe(actor, candidate, providerId, checks);
    return this.response(providerId, checks);
  }

  private draftCandidate(input: ProviderDraftProbeRequest): ProbeCandidate {
    const adapter = requireProviderAdapter(input.adapter);
    if (adapter.group !== input.group) {
      throw providerProblem(
        "PROVIDER_CONFIG_INVALID",
        "The selected adapter does not belong to this provider group.",
      );
    }
    const preset =
      optionalProviderPresetDefinition(input.adapter, input.preset) ?? adapter.presets[0];
    if (!preset) {
      throw providerProblem("PROVIDER_ADAPTER_UNSUPPORTED");
    }
    return {
      providerId: null,
      group: input.group,
      adapter,
      preset,
      config: parseProviderConfig(input.adapter, input.config),
      secrets: Object.freeze({ ...(input.secrets ?? {}) }),
    };
  }

  private async runChecks(candidate: ProbeCandidate): Promise<ProviderProbeCheck[]> {
    const checks: ProviderProbeCheck[] = [check("Adapter", "pass"), check("Configuration", "pass")];
    const missingSecrets = requiredSecretsPresent(candidate);
    checks.push(
      missingSecrets.length === 0
        ? check("Credentials", "pass")
        : check(
            "Credentials",
            "fail",
            null,
            "PROVIDER_SECRET_FIELD_UNKNOWN",
            `Missing required credential: ${missingSecrets.join(", ")}.`,
          ),
    );

    if (candidate.group === "ai") {
      await this.probeAi(candidate, checks);
    } else if (candidate.group === "places") {
      await this.probePlaces(candidate, checks);
    } else if (candidate.group === "mail") {
      await this.probeMail(candidate, checks, missingSecrets);
    } else {
      checks.push(
        check(
          "Storage",
          "skip",
          null,
          null,
          "Configuration and credentials are validated; use the storage test endpoint after activation.",
        ),
      );
    }
    return checks;
  }

  private async probeMail(
    candidate: ProbeCandidate,
    checks: ProviderProbeCheck[],
    missingSecrets: readonly string[],
  ): Promise<void> {
    if (missingSecrets.length > 0) {
      checks.push(
        check(
          "Delivery",
          "skip",
          null,
          null,
          "Delivery was not attempted because required credentials are missing.",
        ),
      );
      return;
    }

    if (candidate.adapter.adapter === "resend") {
      const apiKey = candidate.secrets.apiKey?.trim();
      if (!apiKey) {
        checks.push(
          check("Delivery", "fail", null, "AUTH_FAILED", "The Resend API key is missing."),
        );
        return;
      }
      checks.push(await this.probeResend(apiKey));
      return;
    }

    if (candidate.adapter.adapter !== "smtp") {
      checks.push(
        check(
          "Delivery",
          "fail",
          null,
          "PROVIDER_CONFIG_INVALID",
          "The mail adapter is not supported.",
        ),
      );
      return;
    }

    const host = typeof candidate.config.host === "string" ? candidate.config.host.trim() : "";
    const port = typeof candidate.config.port === "number" ? candidate.config.port : Number.NaN;
    const user = typeof candidate.config.user === "string" ? candidate.config.user.trim() : "";
    const password = candidate.secrets.password?.trim();
    if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
      checks.push(
        check(
          "Delivery",
          "fail",
          null,
          "PROVIDER_CONFIG_INVALID",
          "The SMTP host or port is invalid.",
        ),
      );
      return;
    }
    if (user && !password) {
      checks.push(check("Delivery", "fail", null, "AUTH_FAILED", "The SMTP password is missing."));
      return;
    }

    checks.push(
      await this.probeSmtp({
        host,
        port,
        secure: candidate.config.secure === true || port === 465,
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
      }),
    );
  }

  private async probeSmtp(input: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
  }): Promise<ProviderProbeCheck> {
    const startedAt = Date.now();
    let transport: { verify(): Promise<boolean>; close?(): void } | undefined;
    try {
      const packageName = "nodemailer";
      const { createTransport } = (await import(packageName)) as {
        createTransport: (options: Record<string, unknown>) => {
          verify(): Promise<boolean>;
          close?(): void;
        };
      };
      transport = createTransport({
        host: input.host,
        port: input.port,
        secure: input.secure,
        connectionTimeout: PROBE_TIMEOUT_MS,
        greetingTimeout: PROBE_TIMEOUT_MS,
        socketTimeout: PROBE_TIMEOUT_MS,
        ...(input.user ? { auth: { user: input.user, pass: input.password ?? "" } } : {}),
      });
      await transport.verify();
      return check("Delivery", "pass", Date.now() - startedAt);
    } catch (error) {
      return check(
        "Delivery",
        "fail",
        Date.now() - startedAt,
        smtpProbeCode(error, startedAt),
        "The SMTP server rejected the connection or credentials.",
      );
    } finally {
      try {
        transport?.close?.();
      } catch {
        // A probe transport that refuses to close does not affect the result.
      }
    }
  }

  private async probeResend(apiKey: string): Promise<ProviderProbeCheck> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(RESEND_PROBE_URL, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
      });
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        return check(
          "Delivery",
          "fail",
          Date.now() - startedAt,
          "AUTH_FAILED",
          "The Resend API key was rejected.",
        );
      }
      if (response.status === 429) {
        return check(
          "Delivery",
          "fail",
          Date.now() - startedAt,
          "PROVIDER_LIMIT_REACHED",
          "Resend rate-limited the probe request.",
        );
      }
      if (!response.ok) {
        return check(
          "Delivery",
          "fail",
          Date.now() - startedAt,
          "PROVIDER_PROBE_FAILED",
          "The Resend API rejected the probe request.",
        );
      }
      return check("Delivery", "pass", Date.now() - startedAt);
    } catch {
      return check(
        "Delivery",
        "fail",
        Date.now() - startedAt,
        "PROVIDER_PROBE_TIMEOUT",
        "The Resend probe could not complete in time.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async probeAi(candidate: ProbeCandidate, checks: ProviderProbeCheck[]): Promise<void> {
    const baseUrl = urlOf(candidate.config.baseUrl);
    if (!baseUrl) {
      checks.push(check("Models", "fail", null, "PROVIDER_CONFIG_INVALID", "Base URL is invalid."));
      return;
    }
    await this.egress.assertAllowed(baseUrl);
    const endpoint = appendPath(baseUrl, "models");
    checks.push(
      await this.httpCheck("Models", endpoint, authHeaders(candidate.secrets, candidate.preset)),
    );
  }

  private async probePlaces(
    candidate: ProbeCandidate,
    checks: ProviderProbeCheck[],
  ): Promise<void> {
    const baseUrl = urlOf(candidate.config.baseUrl);
    if (!baseUrl) {
      checks.push(check("Search", "fail", null, "PROVIDER_CONFIG_INVALID", "Base URL is invalid."));
      return;
    }
    await this.egress.assertAllowed(baseUrl);

    let endpoint: URL;
    if (candidate.adapter.adapter === "tencent") {
      endpoint = appendPath(baseUrl, "place/v1/suggestion");
      endpoint.searchParams.set("keyword", "Beijing");
      endpoint.searchParams.set("region", "全国");
      endpoint.searchParams.set("key", candidate.secrets.apiKey ?? "");
    } else if (candidate.adapter.adapter === "geoapify") {
      endpoint = new URL(baseUrl.toString());
      endpoint.searchParams.set("text", "Paris");
      endpoint.searchParams.set("limit", "1");
      endpoint.searchParams.set("apiKey", candidate.secrets.apiKey ?? "");
    } else {
      endpoint = new URL(baseUrl.toString());
      endpoint.searchParams.set("q", "Paris");
      endpoint.searchParams.set("limit", "1");
    }
    checks.push(await this.httpCheck("Search", endpoint, { accept: "application/json" }));
  }

  private async httpCheck(
    name: string,
    endpoint: URL,
    headers: Record<string, string>,
  ): Promise<ProviderProbeCheck> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: { accept: "application/json", ...headers },
      });
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > MAX_PROBE_BYTES) {
        await response.body?.cancel();
        return check(
          name,
          "fail",
          Date.now() - startedAt,
          "PROVIDER_MODELS_RESPONSE_TOO_LARGE",
          "The provider response was too large.",
        );
      }
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        return check(
          name,
          "fail",
          Date.now() - startedAt,
          "PROVIDER_PROBE_FAILED",
          "The provider rejected the credentials.",
        );
      }
      if (response.status === 429) {
        return check(
          name,
          "fail",
          Date.now() - startedAt,
          "PROVIDER_LIMIT_REACHED",
          "The provider rate-limited the test request.",
        );
      }
      if (!response.ok) {
        return check(
          name,
          "fail",
          Date.now() - startedAt,
          "PROVIDER_PROBE_FAILED",
          `The provider returned HTTP ${response.status}.`,
        );
      }
      return check(name, "pass", Date.now() - startedAt);
    } catch (error) {
      if (controller.signal.aborted) {
        return check(
          name,
          "fail",
          Date.now() - startedAt,
          "PROVIDER_PROBE_TIMEOUT",
          "The provider did not answer in time.",
        );
      }
      if (error instanceof ProviderProblemException) {
        return check(name, "fail", Date.now() - startedAt, error.code, error.safeMessage);
      }
      return check(
        name,
        "fail",
        Date.now() - startedAt,
        "PROVIDER_PROBE_FAILED",
        "The provider could not be reached.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private response(providerId: string | null, checks: readonly ProviderProbeCheck[]) {
    return ProviderProbeResponseSchema.parse({
      ok: checks.every((entry) => entry.status !== "fail"),
      providerId,
      testedAt: new Date().toISOString(),
      checks: [...checks],
    });
  }

  private async auditProbe(
    actor: AuthenticatedActor,
    candidate: ProbeCandidate,
    providerId: string | null,
    checks: readonly ProviderProbeCheck[],
  ): Promise<void> {
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.provider.probed",
      targetType: "provider",
      targetId: providerId ?? uuidV7FromString("provider-draft-probe"),
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: {
        group: candidate.group,
        adapter: candidate.adapter.adapter,
        preset: candidate.preset.preset,
        ok: checks.every((entry) => entry.status !== "fail"),
        checks: checks.map((entry) => `${entry.name}:${entry.status}`),
      },
    });
  }
}
