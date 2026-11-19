import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
import {
  MailSettingsConsumer,
  type MailRuntime,
  type MailSettingsSource,
} from "../settings/mail-settings.consumer.js";

/** A cached SMTP transport is rebuilt after this long, even if config is unchanged. */
export const MAIL_TRANSPORT_TTL_MS = 30_000;

/** Resend requests are bounded so an unreachable API cannot hang an auth request. */
export const RESEND_TIMEOUT_MS = 10_000;

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
  readonly idempotencyKey?: string;
}

export type MailFailureCode =
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "CONNECTION_FAILED"
  | "REJECTED"
  | "UNKNOWN";

export interface MailFailureDetails {
  readonly provider?: "smtp" | "resend";
  readonly status?: number;
  /** Retryable matches the worker's classification (EAUTH/EENVELOPE are final). */
  readonly retryable?: boolean;
}

/**
 * Transport failure with a stable, operator-facing code.
 *
 * Messages are deliberately fixed strings: nodemailer/Resend errors can echo
 * the recipient address, so raw provider text never leaves this module.
 */
export class MailDeliveryError extends Error {
  readonly code: MailFailureCode;
  readonly retryable: boolean;
  readonly provider?: "smtp" | "resend";
  readonly status?: number;

  constructor(
    code: MailFailureCode,
    message: string,
    details: MailFailureDetails = {},
  ) {
    super(message);
    this.name = "MailDeliveryError";
    this.code = code;
    this.retryable = details.retryable ?? false;
    this.provider = details.provider;
    this.status = details.status;
  }
}

export interface MailSendResult {
  readonly provider: "smtp" | "resend";
  readonly latencyMs: number;
  readonly providerId?: string;
}

interface SmtpTransportLike {
  sendMail(input: Record<string, unknown>): Promise<{ messageId?: string; response?: string }>;
  close?(): void;
}

/** Answers that repeat identically until configuration or content changes. */
const PERMANENT_SMTP_CODES = new Set(["EAUTH", "EENVELOPE", "EMESSAGE", "ECONFIG"]);

/** Transport-level failures worth another attempt (worker parity). */
const RETRYABLE_SMTP_CODES = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EAI_AGAIN",
  "EPIPE",
  "ECONNRESET",
  "EDNS",
  "ETLS",
]);

interface SmtpFailure {
  retryable: boolean;
  code?: string;
  status?: number;
}

function classifySmtpFailure(error: unknown): SmtpFailure {
  const failure = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    responseCode?: unknown;
  };
  const code =
    typeof failure.code === "string" && failure.code.trim()
      ? failure.code.trim().slice(0, 64)
      : undefined;
  const status =
    typeof failure.responseCode === "number" && Number.isFinite(failure.responseCode)
      ? failure.responseCode
      : undefined;

  if (code !== undefined && PERMANENT_SMTP_CODES.has(code)) {
    return { retryable: false, code, status };
  }
  if (code !== undefined && RETRYABLE_SMTP_CODES.has(code)) {
    return { retryable: true, code, status };
  }
  if (status !== undefined) {
    // A 4xx reply is a relay policy answer; a 5xx reply is the relay itself.
    return { retryable: !(status >= 400 && status < 500), code, status };
  }
  // Unclassified failures stay retryable: permanent only when proven permanent.
  return { retryable: true, code };
}

function failureCode(failure: SmtpFailure): MailFailureCode {
  if (failure.code === "EAUTH") {
    return "AUTH_FAILED";
  }
  if (failure.code === "EENVELOPE") {
    return "REJECTED";
  }
  if (failure.retryable) {
    return "CONNECTION_FAILED";
  }
  return "REJECTED";
}

function failureMessage(code: MailFailureCode): string {
  switch (code) {
    case "AUTH_FAILED":
      return "SMTP authentication was rejected. Check the SMTP username and app password.";
    case "CONNECTION_FAILED":
      return "Could not reach the mail relay. Check the SMTP host and port.";
    case "REJECTED":
      return "The mail relay rejected the message. Check the sender address and recipient.";
    case "NOT_CONFIGURED":
      return "Mail delivery is not configured. Set the mail provider, transport and from address first.";
    default:
      return "Mail delivery failed.";
  }
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

/** Recipient visibility is limited to the domain; full addresses never reach logs. */
export function recipientDomain(to: string): string {
  const at = to.lastIndexOf("@");
  const domain = at >= 0 ? to.slice(at + 1) : "";
  const trimmed = domain.trim().toLowerCase();
  return /^[a-z0-9.-]+$/u.test(trimmed) ? trimmed : "invalid";
}

function transportFingerprint(runtime: Extract<MailRuntime, { configured: true; provider: "smtp" }>): string {
  const secret = runtime.password
    ? createHash("sha256").update(runtime.password, "utf8").digest("hex").slice(0, 16)
    : "-";
  return [runtime.host, String(runtime.port), runtime.secure ? "tls" : "starttls", runtime.user ?? "-", secret].join("|");
}

/**
 * Sends transactional mail with the transport the admin console currently has.
 *
 * The runtime is resolved on every send (SettingsService itself caches for 5s),
 * and an SMTP transport is reused for at most 30s so a settings change reaches
 * the next request without a restart.
 */
@Injectable()
export class MailService {
  private cachedTransport:
    | { fingerprint: string; createdAt: number; transport: SmtpTransportLike }
    | undefined;

  /** Overridable in tests; production uses the platform fetch. */
  protected fetchImpl: typeof fetch = fetch;

  constructor(
    @Inject(MailSettingsConsumer) private readonly settings: MailSettingsSource,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async resolveRuntime(): Promise<MailRuntime> {
    return this.settings.resolve();
  }

  async isConfigured(): Promise<boolean> {
    return (await this.settings.resolve()).configured;
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    const startedAt = Date.now();
    const runtime = await this.settings.resolve();

    if (!runtime.configured) {
      this.logger.warn(
        {
          event: "mail.not_configured",
          provider: runtime.provider,
          missing: runtime.missing,
        },
        "mail.not_configured",
      );
      throw new MailDeliveryError("NOT_CONFIGURED", failureMessage("NOT_CONFIGURED"), {
        provider: runtime.provider,
        retryable: false,
      });
    }

    const result =
      runtime.provider === "smtp"
        ? await this.sendViaSmtp(runtime, message)
        : await this.sendViaResend(runtime, message);

    const latencyMs = Math.max(0, Date.now() - startedAt);
    this.logger.log(
      {
        event: "mail.sent",
        provider: runtime.provider,
        latencyMs,
        toDomain: recipientDomain(message.to),
        ...(result.providerId ? { providerId: result.providerId } : {}),
      },
      "mail.sent",
    );

    return { provider: runtime.provider, latencyMs, ...(result.providerId ? { providerId: result.providerId } : {}) };
  }

  private async sendViaSmtp(
    runtime: Extract<MailRuntime, { configured: true; provider: "smtp" }>,
    message: MailMessage,
  ): Promise<{ providerId?: string }> {
    const transport = await this.smtpTransport(runtime);
    try {
      const info = await transport.sendMail({
        from: runtime.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
        ...(message.idempotencyKey
          ? { headers: { "X-Roamlog-Idempotency-Key": message.idempotencyKey } }
          : {}),
      });
      return { providerId: info.messageId || message.idempotencyKey };
    } catch (error) {
      const failure = classifySmtpFailure(error);
      const code = failureCode(failure);
      this.logger.warn(
        {
          event: "mail.rejected",
          provider: "smtp",
          code: failure.code,
          ...(failure.status === undefined ? {} : { status: failure.status }),
          retryable: failure.retryable,
        },
        "mail.rejected",
      );
      throw new MailDeliveryError(code, failureMessage(code), {
        provider: "smtp",
        retryable: failure.retryable,
        ...(failure.status === undefined ? {} : { status: failure.status }),
      });
    }
  }

  private async sendViaResend(
    runtime: Extract<MailRuntime, { configured: true; provider: "resend" }>,
    message: MailMessage,
  ): Promise<{ providerId?: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.apiKey}`,
          "content-type": "application/json",
          ...(message.idempotencyKey ? { "idempotency-key": message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: runtime.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
        }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch {
      // The provider error can echo the address and request body; only the class
      // is retained.
      this.logger.warn(
        { event: "mail.rejected", provider: "resend", reason: "network", retryable: true },
        "mail.rejected",
      );
      throw new MailDeliveryError(
        "CONNECTION_FAILED",
        "Could not reach the Resend API within 10 seconds.",
        { provider: "resend", retryable: true },
      );
    }

    if (!response.ok) {
      const retryable = isRetryableStatus(response.status);
      const code: MailFailureCode =
        response.status === 401 || response.status === 403
          ? "AUTH_FAILED"
          : retryable
            ? "CONNECTION_FAILED"
            : "REJECTED";
      this.logger.warn(
        {
          event: "mail.rejected",
          provider: "resend",
          status: response.status,
          retryable,
        },
        "mail.rejected",
      );
      throw new MailDeliveryError(code, failureMessage(code), {
        provider: "resend",
        status: response.status,
        retryable,
      });
    }

    let providerId: string | undefined;
    try {
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id === "string" && body.id) {
        providerId = body.id;
      }
    } catch {
      // A non-JSON success body still means the provider accepted the message.
    }
    return { providerId };
  }

  private async smtpTransport(
    runtime: Extract<MailRuntime, { configured: true; provider: "smtp" }>,
  ): Promise<SmtpTransportLike> {
    const fingerprint = transportFingerprint(runtime);
    const now = Date.now();
    const cached = this.cachedTransport;
    if (
      cached &&
      cached.fingerprint === fingerprint &&
      now - cached.createdAt < MAIL_TRANSPORT_TTL_MS
    ) {
      return cached.transport;
    }

    if (cached) {
      try {
        cached.transport.close?.();
      } catch {
        // A stale transport that refuses to close is harmless.
      }
    }

    const transport = await this.createSmtpTransport(runtime);
    this.cachedTransport = { fingerprint, createdAt: now, transport };
    return transport;
  }

  /** Kept separate so tests can substitute a fake transport without a network. */
  protected async createSmtpTransport(
    runtime: Extract<MailRuntime, { configured: true; provider: "smtp" }>,
  ): Promise<SmtpTransportLike> {
    const packageName = "nodemailer";
    const { createTransport } = (await import(packageName)) as {
      createTransport: (options: Record<string, unknown>) => SmtpTransportLike;
    };
    return createTransport({
      host: runtime.host,
      port: runtime.port,
      // 465 is implicit TLS; 587 and every other port negotiate STARTTLS.
      secure: runtime.secure,
      // Anonymous relays exist, so auth is only sent when a username is set.
      ...(runtime.user
        ? { auth: { user: runtime.user, pass: runtime.password ?? "" } }
        : {}),
    });
  }
}