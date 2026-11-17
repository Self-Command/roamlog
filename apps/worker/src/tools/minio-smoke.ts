import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { loadLocalEnvironment } from "../config.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the MinIO smoke test`);
  }
  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return value === "true" || value === "1";
}

export async function runMinioSmoke(): Promise<Record<string, unknown>> {
  const environmentFile = loadLocalEnvironment();
  const endpoint = requireEnv("S3_ENDPOINT");
  const bucket = requireEnv("S3_BUCKET");
  const key = `_smoke/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.txt`;
  const expectedBody = `roamlog minio smoke ${randomUUID()}\n`;
  const client = new S3Client({
    endpoint,
    region: process.env.S3_REGION?.trim() || "us-east-1",
    forcePathStyle: booleanEnv("S3_FORCE_PATH_STYLE", true),
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY"),
      secretAccessKey: requireEnv("S3_SECRET_KEY"),
    },
  });

  let uploaded = false;
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: expectedBody,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
    uploaded = true;

    const object = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    if (!object.Body) {
      throw new Error("MinIO returned an empty object body");
    }
    const actualBody = await object.Body.transformToString("utf8");
    if (actualBody !== expectedBody) {
      throw new Error("MinIO smoke read did not match the uploaded object");
    }

    const anonymousUrl = `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/${key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
    const anonymousResponse = await fetch(anonymousUrl, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    if (anonymousResponse.status !== 403 && anonymousResponse.status !== 404) {
      throw new Error(
        `Expected private object access to be denied, received HTTP ${anonymousResponse.status}`,
      );
    }

    return {
      endpoint,
      bucket,
      key,
      bytes: Buffer.byteLength(expectedBody),
      readMatches: true,
      anonymousAccessStatus: anonymousResponse.status,
      environmentFile,
    };
  } finally {
    if (uploaded) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
      } catch {
        // The smoke result is authoritative; cleanup failures are reported by MinIO.
      }
    }
    client.destroy();
  }
}
