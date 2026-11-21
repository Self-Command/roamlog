import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SeedDataset } from "./types.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export async function uploadSeedAssets(
  data: SeedDataset,
  verbose: boolean,
): Promise<boolean> {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET ?? data.media[0]?.bucket;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    if (verbose) {
      console.warn(
        "Seed asset upload skipped: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, or S3_BUCKET is missing. Media rows still reference their original object keys.",
      );
    }
    return false;
  }

  try {
    await fetch(endpoint, {
      method: "HEAD",
      signal: AbortSignal.timeout(1_500),
    });
  } catch {
    if (verbose) {
      console.warn(
        "Seed asset upload skipped: S3-compatible storage is not reachable. Media rows still reference their original object keys.",
      );
    }
    return false;
  }

  const client = new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
  });

  let uploaded = 0;
  try {
    for (const item of data.media) {
      const assetPath = path.join(packageRoot, "seed-assets", item.assetFileName);
      if (!existsSync(assetPath)) {
        if (verbose) {
          console.warn(
            `Seed asset upload skipped for ${item.assetFileName}: seed asset file is missing.`,
          );
        }
        return false;
      }
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: item.key,
          Body: await readFile(assetPath),
          ContentType: item.mimeType,
        }),
      );
      uploaded += 1;
    }
  } catch {
    if (verbose) {
      console.warn(
        `Seed asset upload stopped after ${uploaded}/${data.media.length} objects. The seed data is intact and media rows still reference their original object keys.`,
      );
    }
    return false;
  } finally {
    client.destroy();
  }

  if (verbose) {
    console.log(
      `Uploaded ${uploaded} seed media objects to S3 bucket "${bucket}".`,
    );
  }
  return true;
}
