import { createRequire } from "node:module";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { UnrecoverableError } from "bullmq";

import type { WorkerLogger } from "./logger.js";
import type {
  EmailRenderer,
  EmailSender,
  ImageProcessor,
  WorkerDependencies,
  WorkerLoggerLike,
  WorkerStorage,
} from "./jobs/types.js";
import { encodeBlurhash } from "./jobs/blurhash.js";
import { mediaVariantKey } from "./jobs/media.js";

const require = createRequire(import.meta.url);

export function createWorkerDependencies(logger: WorkerLogger): WorkerDependencies {
  // Fails the boot, not a mail job, when a trimmed image cannot resolve SMTP.
  assertSmtpClientAvailable();
  return {
    db: createDatabase(),
    storage: createStorage(),
    images: createImageProcessor(),
    email: {
      send: createEmailSender(logger),
      render: createEmailRenderer(),
    },
    now: () => new Date(),
    logger,
  };
}

function createDatabase(): WorkerDependencies["db"] {
  try {
    const module = require("@roamlog/db") as {
      createPrismaClient?: (options: { connectionString: string }) => unknown;
    };
    if (typeof module.createPrismaClient !== "function") {
      throw new Error("@roamlog/db did not export createPrismaClient");
    }
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is required by the worker");
    }
    return module.createPrismaClient({ connectionString }) as WorkerDependencies["db"];
  } catch (error) {
    throw new Error(
      `Worker cannot start without @roamlog/db. Add workspace dependencies and run pnpm install. ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

export function createStorage(): WorkerStorage {
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) {
    throw new Error("S3_BUCKET is required by the worker");
  }
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "",
    },
  });

  return {
    async getObject(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = (await result.Body?.transformToByteArray()) ?? new Uint8Array();
      return {
        bytes,
        contentType: result.ContentType ?? "application/octet-stream",
      };
    },
    async putObject(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export function createImageProcessor(): ImageProcessor {
  return {
    async process({ bytes, mediaKey }) {
      let sharp: any;
      try {
        const module = (await import("sharp" as string)) as any;
        sharp = module.default ?? module;
      } catch (error) {
        throw new Error(
          `sharp is not installed in @roamlog/worker: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      const source = Buffer.from(bytes);
      const metadata = await sharp(source, { failOn: "error" }).rotate().metadata();
      const width = Number(metadata.width ?? 0);
      const height = Number(metadata.height ?? 0);
      const variants: Array<{
        name: string;
        key: string;
        mimeType: string;
        size: number;
        width: number;
        bytes: Uint8Array;
      }> = [];

      for (const [name, targetWidth] of [
        ["thumb", 400],
        ["medium", 1200],
        ["large", 2400],
      ] as const) {
        const resized = sharp(source)
          .rotate()
          .resize({ width: targetWidth, withoutEnlargement: true });
        const webp = await resized.clone().webp({ quality: 82 }).toBuffer();
        variants.push({
          name,
          key: mediaVariantKey(mediaKey, name, "image/webp"),
          mimeType: "image/webp",
          size: webp.byteLength,
          width: Math.min(targetWidth, width || targetWidth),
          bytes: webp,
        });

        const jpeg = await resized.clone().jpeg({ quality: 84, mozjpeg: true }).toBuffer();
        variants.push({
          name: `${name}Jpeg`,
          key: mediaVariantKey(mediaKey, `${name}-fallback`, "image/jpeg"),
          mimeType: "image/jpeg",
          size: jpeg.byteLength,
          width: Math.min(targetWidth, width || targetWidth),
          bytes: jpeg,
        });
      }

      let blurhash: string | null;
      try {
        const raw = await sharp(source)
          .rotate()
          .resize(4, 4, { fit: "fill" })
          .raw()
          .toBuffer({ resolveWithObject: true });
        blurhash = encodeBlurhash(raw.data, raw.info.width, raw.info.height, raw.info.channels);
      } catch {
        blurhash = null;
      }

      return { width, height, blurhash, variants };
    },
  };
}

function parseEmailAddress(raw: string): { Email: string; Name?: string } {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!match) {
    return { Email: raw.trim() };
  }
  return {
    Email: match[2] ?? raw.trim(),
    ...(match[1]?.trim() ? { Name: match[1].trim() } : {}),
  };
}

function mailpitUrl(): string {
  const configured = process.env.MAILPIT_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const port = process.env.MAILPIT_UI_PORT?.trim() || "8025";
  return `http://127.0.0.1:${port}`;
}

/**
 * Mail transports this worker can actually speak. SMTP is real mail since
 * `nodemailer` is a `@roamlog/worker` dependency; the loader below still guards
 * against image builds that prune it.
 */
export type WorkerEmailTransport = "resend" | "smtp" | "mailpit";

/** Minimal nodemailer surface, typed locally like the API's SMTP adapter. */
interface SmtpModule {
  createTransport(options: Record<string, unknown>): SmtpTransport;
}

interface SmtpTransport {
  sendMail(input: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string; response?: string }>;
}

interface EmailFailureDetails {
  transport: WorkerEmailTransport | "unknown";
  status?: number;
}

/**
 * A transient delivery failure. BullMQ retries it with the configured backoff.
 * The message carries only the transport and HTTP status: response bodies and
 * credentials are never copied into the error, because the email job persists
 * `error.message` onto the email log and log sink.
 */
export class EmailDeliveryError extends Error {
  readonly transport: EmailFailureDetails["transport"];
  readonly status?: number;

  constructor(message: string, details: EmailFailureDetails, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmailDeliveryError";
    this.transport = details.transport;
    this.status = details.status;
  }
}

/**
 * A permanent delivery failure (bad credentials, unverified domain, wrong
 * transport for this deployment). Rethrown as BullMQ `UnrecoverableError` so
 * the job fails once instead of burning every retry.
 */
export class NonRetryableEmailError extends UnrecoverableError {
  readonly transport: EmailFailureDetails["transport"];
  readonly status?: number;

  constructor(message: string, details: EmailFailureDetails) {
    super(message);
    this.name = "NonRetryableEmailError";
    this.transport = details.transport;
    this.status = details.status;
  }
}

/** Statuses worth another attempt. 4xx client errors are configuration bugs. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

/**
 * Production gate. `APP_ENV` is authoritative and compose sets it explicitly
 * for the production stack; the `NODE_ENV` fallback keeps the legacy
 * staging/server override pair on its previous behaviour.
 */
function isProductionDeployment(): boolean {
  const appEnvironment = process.env.APP_ENV?.trim().toLowerCase();
  if (appEnvironment) {
    return appEnvironment === "production";
  }
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

function resolveTransport(): WorkerEmailTransport {
  const configured = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!configured) {
    return "smtp";
  }
  if (configured === "resend" || configured === "smtp" || configured === "mailpit") {
    return configured;
  }
  throw new NonRetryableEmailError(
    `Unsupported EMAIL_PROVIDER value ("${configured.slice(0, 32)}"); expected resend, smtp, or mailpit`,
    { transport: "unknown" },
  );
}

/** Sender address, with a production refusal for local-only domains. */
function senderAddress(): string {
  const configured = process.env.EMAIL_FROM?.trim() || "Roamlog <hello@roamlog.app>";
  if (!isProductionDeployment()) {
    return configured;
  }
  const address = parseEmailAddress(configured).Email.toLowerCase();
  const domain = address.includes("@") ? address.slice(address.lastIndexOf("@") + 1) : "";
  if (!domain) {
    throw new NonRetryableEmailError(
      "EMAIL_FROM must contain a routable email address in production",
      { transport: "unknown" },
    );
  }
  if (domain === "local" || domain === "localhost" || domain.endsWith(".local")) {
    throw new NonRetryableEmailError("EMAIL_FROM must not use a .local domain in production", {
      transport: "unknown",
    });
  }
  return configured;
}

const SMTP_REBUILD_HINT = "rebuild the worker image so EMAIL_PROVIDER=smtp has an SMTP client";

/**
 * Resolve `nodemailer` once per process. The check is separate from the import
 * so a pruned image produces this message instead of a bare
 * `ERR_MODULE_NOT_FOUND` surfacing from inside a BullMQ retry.
 */
let smtpModulePromise: Promise<SmtpModule> | undefined;

function loadSmtpModule(): Promise<SmtpModule> {
  if (smtpModulePromise) {
    return smtpModulePromise;
  }
  const loading = (async (): Promise<SmtpModule> => {
    if (!isResolvable("nodemailer")) {
      throw new NonRetryableEmailError(
        `nodemailer is not resolvable from the worker runtime; ${SMTP_REBUILD_HINT}`,
        { transport: "smtp" },
      );
    }
    try {
      // A variable specifier keeps this a runtime import: the worker must not
      // hard-fail at module load when the image trims the package.
      const specifier = "nodemailer";
      return (await import(specifier)) as SmtpModule;
    } catch {
      // The cause is deliberately dropped: loader errors can echo image paths.
      throw new NonRetryableEmailError(
        `nodemailer failed to load in the worker runtime; ${SMTP_REBUILD_HINT}`,
        { transport: "smtp" },
      );
    }
  })();
  smtpModulePromise = loading;
  return loading;
}

function isResolvable(specifier: string): boolean {
  try {
    require.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot-time gate, called through `createWorkerDependencies`. It resolves the
 * package path only; `nodemailer` itself is imported on the first SMTP send.
 */
export function assertSmtpClientAvailable(): void {
  const configured = process.env.EMAIL_PROVIDER?.trim().toLowerCase() || "smtp";
  if (configured !== "smtp" || isResolvable("nodemailer")) {
    return;
  }
  throw new NonRetryableEmailError(
    `nodemailer is not resolvable from the worker runtime; ${SMTP_REBUILD_HINT}`,
    { transport: "smtp" },
  );
}

/** Transport-level failures worth another attempt. */
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

/** Answers that repeat identically until configuration or content changes. */
const PERMANENT_SMTP_CODES = new Set(["EAUTH", "EENVELOPE", "EMESSAGE", "ECONFIG"]);

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

/** SMTP reply code from `info.response`; only the leading digits are kept. */
function smtpReplyCode(response: unknown): number | undefined {
  if (typeof response !== "string") {
    return undefined;
  }
  const match = /^(\d{3})\b/u.exec(response.trim());
  const raw = match?.[1];
  return raw === undefined ? undefined : Number(raw);
}

function smtpHost(): string {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    throw new NonRetryableEmailError(
      "SMTP_HOST is required to send worker email when EMAIL_PROVIDER=smtp",
      { transport: "smtp" },
    );
  }
  return host;
}

function smtpPort(): number {
  const configured = process.env.SMTP_PORT?.trim();
  if (!configured) {
    return 587;
  }
  const port = Number.parseInt(configured, 10);
  if (!/^\d{1,5}$/u.test(configured) || port <= 0 || port > 65_535) {
    throw new NonRetryableEmailError(
      "SMTP_PORT must be an integer between 1 and 65535 when EMAIL_PROVIDER=smtp",
      { transport: "smtp" },
    );
  }
  return port;
}

async function sendViaSmtp(
  message: Parameters<EmailSender>[0],
  logger?: WorkerLoggerLike,
): Promise<{ providerId: string }> {
  const host = smtpHost();
  const port = smtpPort();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD ?? "";
  const from = senderAddress();
  const smtp = await loadSmtpModule();

  const transport = smtp.createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 and every other port negotiate STARTTLS.
    secure: port === 465,
    // Anonymous relays exist, so auth is only sent when a username is set.
    ...(user ? { auth: { user, pass: password } } : {}),
  });

  let info: { messageId?: string; response?: string };
  try {
    info = await transport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: { "X-Roamlog-Idempotency-Key": message.idempotencyKey },
    });
  } catch (error) {
    const failure = classifySmtpFailure(error);
    // Only the SMTP code or reply class travels onward: nodemailer responses
    // can echo the recipient address and the email job persists error.message.
    const reason = failure.code ?? (failure.status === undefined ? "" : `status ${failure.status}`);
    const text = reason
      ? `SMTP relay rejected the message (${reason})`
      : "SMTP relay rejected the message";
    logger?.warn(
      { event: "email.rejected", transport: "smtp", status: failure.status },
      "email rejected by smtp relay",
    );
    throw failure.retryable
      ? new EmailDeliveryError(text, { transport: "smtp", status: failure.status })
      : new NonRetryableEmailError(text, { transport: "smtp", status: failure.status });
  }

  const providerId = info.messageId || message.idempotencyKey;
  logger?.info(
    {
      event: "email.sent",
      transport: "smtp",
      status: smtpReplyCode(info.response),
      providerId,
    },
    "email delivered",
  );
  return { providerId };
}

async function sendViaMailpit(
  message: Parameters<EmailSender>[0],
  logger?: WorkerLoggerLike,
): Promise<{ providerId: string }> {
  if (isProductionDeployment()) {
    throw new NonRetryableEmailError(
      "EMAIL_PROVIDER=mailpit is disabled in production; use resend",
      { transport: "mailpit" },
    );
  }

  let response: Response;
  try {
    response = await fetch(`${mailpitUrl()}/api/v1/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: parseEmailAddress(senderAddress()),
        To: [parseEmailAddress(message.to)],
        Subject: message.subject,
        HTML: message.html,
        Text: message.text,
        Tags: ["roamlog-worker"],
        Headers: {
          "X-Roamlog-Idempotency-Key": message.idempotencyKey,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new EmailDeliveryError(
      `Mailpit request failed before a response (${
        error instanceof Error ? error.name : "UnknownError"
      })`,
      { transport: "mailpit" },
      { cause: error },
    );
  }

  if (!response.ok) {
    const retryable = isRetryableStatus(response.status);
    const message = `Mailpit rejected the message (status ${response.status})`;
    throw retryable
      ? new EmailDeliveryError(message, { transport: "mailpit", status: response.status })
      : new NonRetryableEmailError(message, { transport: "mailpit", status: response.status });
  }

  let providerId = message.idempotencyKey;
  try {
    const body = (await response.json()) as { ID?: unknown };
    if (typeof body.ID === "string" && body.ID) {
      providerId = body.ID;
    }
  } catch {
    // Keep the idempotency key when the catcher returns a non-JSON body.
  }

  logger?.info(
    { event: "email.sent", transport: "mailpit", status: response.status, providerId },
    "email delivered",
  );
  return { providerId };
}

async function sendViaResend(
  message: Parameters<EmailSender>[0],
  logger?: WorkerLoggerLike,
): Promise<{ providerId: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new NonRetryableEmailError(
      "RESEND_API_KEY is required to send worker email when EMAIL_PROVIDER=resend",
      { transport: "resend" },
    );
  }
  const from = senderAddress();

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new EmailDeliveryError(
      `Resend request failed before a response (${
        error instanceof Error ? error.name : "UnknownError"
      })`,
      { transport: "resend" },
      { cause: error },
    );
  }

  if (!response.ok) {
    // Only the status is propagated: Resend error bodies can echo addresses and
    // must never reach the email log or the log sink.
    const retryable = isRetryableStatus(response.status);
    const failure = retryable
      ? new EmailDeliveryError(`Resend rejected the message (status ${response.status})`, {
          transport: "resend",
          status: response.status,
        })
      : new NonRetryableEmailError(`Resend rejected the message (status ${response.status})`, {
          transport: "resend",
          status: response.status,
        });
    logger?.warn(
      {
        event: "email.rejected",
        transport: "resend",
        status: response.status,
        retryable,
      },
      "email rejected by provider",
    );
    throw failure;
  }

  let providerId = message.idempotencyKey;
  try {
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id === "string" && body.id) {
      providerId = body.id;
    }
  } catch {
    // A 2xx without a JSON body still counts as delivered.
  }

  logger?.info(
    { event: "email.sent", transport: "resend", status: response.status, providerId },
    "email delivered",
  );
  return { providerId };
}

export function createEmailSender(logger?: WorkerLoggerLike): EmailSender {
  return async (message) => {
    const transport = resolveTransport();

    if (transport === "mailpit") {
      return sendViaMailpit(message, logger);
    }

    if (transport === "smtp") {
      return sendViaSmtp(message, logger);
    }

    return sendViaResend(message, logger);
  };
}

export function createEmailRenderer(): EmailRenderer {
  return async (template, data) => {
    try {
      const emailsRequire = createRequire(require.resolve("@roamlog/emails"));
      (globalThis as { React?: unknown }).React ??= emailsRequire("react");
      const module = (await import("@roamlog/emails" as string)) as any;
      const rendered = await module.renderEmailTemplate(template, data);
      return { subject: rendered.subject, html: rendered.html, text: rendered.text };
    } catch (error) {
      throw new Error(
        `Email template rendering requires @roamlog/emails: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  };
}
