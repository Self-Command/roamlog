import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../..");
const requireFromApi = createRequire(resolve(repoRoot, "apps/api/package.json"));
const {
  CreateBucketCommand,
  GetBucketPolicyCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} = requireFromApi("@aws-sdk/client-s3");

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

function boolEnv(name, fallback) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return value === "true" || value === "1";
}

function defaultBucket() {
  return env("S3_BUCKET", "roamlog-local");
}

function testBucket() {
  return env("STAGING_TEST_BUCKET", "roamlog-test");
}

function corsOrigins() {
  return env("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function ensureBucket(client, bucket) {
  let created = false;
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const name = error?.name;
    if (status !== 404 && name !== "NotFound" && name !== "NoSuchBucket") {
      throw error;
    }
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    created = true;
  }

  let policy = null;
  try {
    const response = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    policy = response.Policy ?? null;
  } catch (error) {
    const name = error?.name;
    if (name !== "NoSuchBucketPolicy" && name !== "NoSuchBucketPolicyException") {
      throw error;
    }
  }

  if (policy && /"Principal"\s*:\s*"\*"/i.test(policy)) {
    throw new Error(
      `Bucket ${bucket} has a public bucket policy; staging requires a private bucket.`,
    );
  }

  let corsConfigured = true;
  let corsWarning = null;
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedOrigins: corsOrigins(),
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  } catch (error) {
    if (error?.name !== "NotImplemented") {
      throw error;
    }
    corsConfigured = false;
    corsWarning =
      "MinIO applies CORS at the server process; configure MINIO_API_CORS_ALLOW_ORIGIN.";
  }

  return { bucket, created, private: policy === null, corsConfigured, corsWarning };
}

const endpoint = env("S3_ENDPOINT", "http://127.0.0.1:9000");
const client = new S3Client({
  endpoint,
  region: env("S3_REGION", "us-east-1"),
  forcePathStyle: boolEnv("S3_FORCE_PATH_STYLE", true),
  credentials: {
    accessKeyId: env("S3_ACCESS_KEY", env("MINIO_ROOT_USER", "roamlog")),
    secretAccessKey: env("S3_SECRET_KEY", env("MINIO_ROOT_PASSWORD", "roamlog-local-secret")),
  },
});

try {
  const buckets = [];
  for (const bucket of [...new Set([defaultBucket(), testBucket()])]) {
    buckets.push(await ensureBucket(client, bucket));
  }
  console.log(
    JSON.stringify(
      {
        status: "ok",
        endpoint,
        buckets,
        corsOrigins: corsOrigins(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        endpoint,
        error: error instanceof Error ? error.message : String(error),
        name: error?.name,
        httpStatusCode: error?.$metadata?.httpStatusCode,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  client.destroy();
}
