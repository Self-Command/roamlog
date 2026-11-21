import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { seedDemoData } from "../../../seed.js";

interface MediaUpsertArgs {
  create: { bucket: string };
  update: { bucket: string };
}

function createRecordingPrisma(): {
  prisma: PrismaClient;
  mediaUpserts: MediaUpsertArgs[];
} {
  const mediaUpserts: MediaUpsertArgs[] = [];
  const transaction = new Proxy(
    {},
    {
      get(_target, table) {
        if (typeof table !== "string") {
          return undefined;
        }
        return new Proxy(
          {},
          {
            get(_delegateTarget, operation) {
              if (typeof operation !== "string") {
                return undefined;
              }
              return async (args: unknown) => {
                if (table === "media" && operation === "upsert") {
                  mediaUpserts.push(args as MediaUpsertArgs);
                }
                return {};
              };
            },
          },
        );
      },
    },
  );

  const prisma = {
    $transaction: vi.fn(async (callback: (client: unknown) => Promise<void>) =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;

  return { prisma, mediaUpserts };
}

async function expectSeedMediaBucket(bucket: string): Promise<void> {
  const { prisma, mediaUpserts } = createRecordingPrisma();

  await seedDemoData(prisma, { quiet: true, uploadAssets: false });

  expect(mediaUpserts).toHaveLength(24);
  for (const args of mediaUpserts) {
    expect(args.create.bucket).toBe(bucket);
    expect(args.update.bucket).toBe(bucket);
  }
}

describe("seed media bucket", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEMO_SEED_ENABLED", "true");
    vi.stubEnv("ROAMLOG_SEED_S3_UPLOAD", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes S3_BUCKET into every media row", async () => {
    vi.stubEnv("S3_BUCKET", "test-bucket");

    await expectSeedMediaBucket("test-bucket");
  });

  it("keeps the local default when S3_BUCKET is unset", async () => {
    const previousBucket = process.env.S3_BUCKET;
    delete process.env.S3_BUCKET;

    try {
      await expectSeedMediaBucket("roamlog-local");
    } finally {
      if (previousBucket === undefined) {
        delete process.env.S3_BUCKET;
      } else {
        process.env.S3_BUCKET = previousBucket;
      }
    }
  });
});
