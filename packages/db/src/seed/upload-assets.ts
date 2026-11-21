import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SeedDataset } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type SeedAssetUploadPhase = "configuration" | "file" | "endpoint" | "upload";

interface SeedAssetUploadErrorDetails {
  phase: SeedAssetUploadPhase;
  message: string;
  uploaded: number;
  total: number;
  fileName?: string;
  key?: string;
  cause?: unknown;
}

export class SeedAssetUploadError extends Error {
  readonly phase: SeedAssetUploadPhase;
  readonly uploaded: number;
  readonly total: number;
  readonly fileName: string | undefined;
  readonly key: string | undefined;

  constructor(details: SeedAssetUploadErrorDetails) {
    const location = [
      details.fileName ? `file="${details.fileName}"` : null,
      details.key ? `key="${details.key}"` : null,
    ]
      .filter((value): value is string => value !== null)
      .join(" ");
    super(
      `Seed asset upload failed during ${details.phase}: ${details.message}` +
        `${location ? ` (${location})` : ""}. Uploaded ${details.uploaded}/${details.total} objects.`,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.name = "SeedAssetUploadError";
    this.phase = details.phase;
    this.uploaded = details.uploaded;
    this.total = details.total;
    this.fileName = details.fileName;
    this.key = details.key;
  }
}

export interface SeedAssetS3Client {
  send(command: PutObjectCommand): Promise<unknown>;
  destroy(): void;
}

export interface UploadSeedAssetsDependencies {
  client?: SeedAssetS3Client;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

export async function uploadSeedAssets(
  data: SeedDataset,
  verbose: boolean,
  dependencies: UploadSeedAssetsDependencies = {},
): Promise<number> {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET ?? data.media[0]?.bucket;
  const total = data.media.length;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    const missing = [
      !endpoint ? "S3_ENDPOINT" : null,
      !accessKeyId ? "S3_ACCESS_KEY" : null,
      !secretAccessKey ? "S3_SECRET_KEY" : null,
      !bucket ? "S3_BUCKET" : null,
    ].filter((name): name is string => name !== null);
    throw new SeedAssetUploadError({
      phase: "configuration",
      message: `missing ${missing.join(", ")}`,
      uploaded: 0,
      total,
    });
  }

  const assets = data.media.map((item) => ({
    item,
    assetPath: path.join(packageRoot, "seed-assets", item.assetFileName),
  }));

  for (const { item, assetPath } of assets) {
    if (!existsSync(assetPath)) {
      throw new SeedAssetUploadError({
        phase: "file",
        message: "seed asset file is missing",
        uploaded: 0,
        total,
        fileName: item.assetFileName,
        key: item.key,
      });
    }
  }

  const fetchImpl = dependencies.fetch ?? fetch;
  try {
    await fetchImpl(endpoint, {
      method: "HEAD",
      signal: AbortSignal.timeout(1_500),
    });
  } catch (error) {
    throw new SeedAssetUploadError({
      phase: "endpoint",
      message: "S3-compatible storage is not reachable",
      uploaded: 0,
      total,
      cause: error,
    });
  }

  let client: SeedAssetS3Client;
  try {
    client =
      dependencies.client ??
      new S3Client({
        endpoint,
        region: process.env.S3_REGION ?? "us-east-1",
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 1,
      });
  } catch (error) {
    throw new SeedAssetUploadError({
      phase: "configuration",
      message: "could not create the S3 client",
      uploaded: 0,
      total,
      cause: error,
    });
  }

  let uploaded = 0;
  try {
    for (const { item, assetPath } of assets) {
      let body: Buffer;
      try {
        body = await readFile(assetPath);
      } catch (error) {
        throw new SeedAssetUploadError({
          phase: "file",
          message: "could not read seed asset file",
          uploaded,
          total,
          fileName: item.assetFileName,
          key: item.key,
          cause: error,
        });
      }

      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: item.key,
            Body: body,
            ContentType: item.mimeType,
          }),
        );
      } catch (error) {
        throw new SeedAssetUploadError({
          phase: "upload",
          message: "PutObject failed",
          uploaded,
          total,
          fileName: item.assetFileName,
          key: item.key,
          cause: error,
        });
      }
      uploaded += 1;
    }
  } finally {
    client.destroy();
  }

  if (verbose) {
    console.log(`Uploaded ${uploaded} seed media objects to S3 bucket "${bucket}".`);
  }
  return uploaded;
}
