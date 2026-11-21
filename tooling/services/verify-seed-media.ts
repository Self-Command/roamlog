import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPrismaClient } from "@roamlog/db";

const expectedMediaCount = 24;

interface SeedMediaFailure {
  id: string;
  key: string;
  reason: string;
}

interface SeedMediaSummary {
  count: number;
  bucket: string | null;
  checked: number;
  failed: SeedMediaFailure[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(id: string, key: string, reason: string): SeedMediaFailure {
  return { id, key, reason };
}

const summary: SeedMediaSummary = {
  count: 0,
  bucket: process.env.S3_BUCKET ?? null,
  checked: 0,
  failed: [],
};

async function main(): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    const missing = [
      !endpoint ? "S3_ENDPOINT" : null,
      !accessKeyId ? "S3_ACCESS_KEY" : null,
      !secretAccessKey ? "S3_SECRET_KEY" : null,
      !bucket ? "S3_BUCKET" : null,
    ].filter((name): name is string => name !== null);
    summary.failed.push(failure("<configuration>", "", `missing ${missing.join(", ")}`));
    return;
  }

  summary.bucket = bucket;
  const prisma = createPrismaClient();
  const s3 = new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
  });

  try {
    const rows = await prisma.media.findMany({
      where: { status: "ready", deletedAt: null },
      select: { id: true, bucket: true, key: true },
      orderBy: { id: "asc" },
    });

    summary.count = rows.length;
    if (rows.length !== expectedMediaCount) {
      summary.failed.push(
        failure(
          "<media-count>",
          "",
          `expected ${expectedMediaCount} ready media rows, found ${rows.length}`,
        ),
      );
    }

    for (const row of rows) {
      if (row.bucket !== bucket) {
        summary.failed.push(
          failure(row.id, row.key, `bucket "${row.bucket}" does not match S3_BUCKET "${bucket}"`),
        );
      }

      try {
        await s3.send(new HeadObjectCommand({ Bucket: row.bucket, Key: row.key }));
        summary.checked += 1;
      } catch (error) {
        summary.failed.push(failure(row.id, row.key, `HeadObject failed: ${errorMessage(error)}`));
      }
    }
  } finally {
    s3.destroy();
    await prisma.$disconnect();
  }
}

void main()
  .catch((error: unknown) => {
    summary.failed.push(failure("<fatal>", "", errorMessage(error)));
  })
  .finally(() => {
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed.length > 0) {
      process.exitCode = 1;
    }
  });
