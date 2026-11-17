import { createRequire } from "node:module";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { WorkerLogger } from "./logger.js";
import type {
  EmailRenderer,
  EmailSender,
  ImageProcessor,
  WorkerDependencies,
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
      send: createEmailSender(),
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

function createStorage(): WorkerStorage {
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

function createImageProcessor(): ImageProcessor {
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

function createEmailSender(): EmailSender {
  return async (message) => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is required to send worker email");
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Roamlog <hello@roamlog.app>",
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend rejected the message (${response.status})`);
    }
    const body = (await response.json()) as { id?: string };
    return { providerId: body.id ?? message.idempotencyKey };
  };
}

function createEmailRenderer(): EmailRenderer {
  return async (template, data) => {
    try {
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
