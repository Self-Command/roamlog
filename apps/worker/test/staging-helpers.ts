import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { ProcessorContext } from "../src/processor.js";

export const stagingEnabled = process.env.ROAMLOG_STAGING_SERVICES === "1";
export const stagingMailpitUrl = (
  process.env.ROAMLOG_STAGING_MAILPIT_URL ??
  process.env.MAILPIT_URL ??
  "http://127.0.0.1:8025"
).replace(/\/+$/, "");

export interface StagingStorageConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

export function stagingStorageConfig(): StagingStorageConfig {
  return {
    endpoint: process.env.ROAMLOG_STAGING_S3_ENDPOINT ?? "http://127.0.0.1:9000",
    bucket: process.env.ROAMLOG_STAGING_S3_BUCKET ?? "roamlog-test",
    accessKey: process.env.ROAMLOG_STAGING_S3_ACCESS_KEY ?? "roamlog",
    secretKey: process.env.ROAMLOG_STAGING_S3_SECRET_KEY ?? "roamlog-local-secret",
    region: process.env.ROAMLOG_STAGING_S3_REGION ?? "us-east-1",
  };
}

export function configureWorkerStorageEnvironment(): StagingStorageConfig {
  const config = stagingStorageConfig();
  process.env.S3_ENDPOINT = config.endpoint;
  process.env.S3_BUCKET = config.bucket;
  process.env.S3_ACCESS_KEY = config.accessKey;
  process.env.S3_SECRET_KEY = config.secretKey;
  process.env.S3_REGION = config.region;
  process.env.S3_FORCE_PATH_STYLE = "true";
  return config;
}

export function createStagingS3Client(config: StagingStorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
}

export async function ensureStagingBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) {
      throw error;
    }
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export async function deleteStagingObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
}

export function stagingContext(jobId: string): ProcessorContext {
  return {
    queue: "media",
    jobId,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
