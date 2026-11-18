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
 * Mail transports this worker can actually speak. The worker image ships no
 * SMTP client on purpose: `nodemailer` is an `@roamlog/api` dependency and is
 * not resolvable from `@roamlog/worker` under pnpm, so an SMTP branch here
 * would work in dev and fail in the released image.
 */
export type WorkerEmailTransport = "resend" | "smtp" | "mailpit";

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
      // No SMTP client in the worker image, and adding one is a dependency
      // decision. Worker mail must use Resend unless that is approved.
      throw new NonRetryableEmailError(
        "EMAIL_PROVIDER=smtp is not supported by the worker image; use EMAIL_PROVIDER=resend for worker mail or send through the API",
        { transport: "smtp" },
      );
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
