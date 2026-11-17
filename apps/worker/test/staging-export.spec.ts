import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createStorage } from "../src/dependencies.js";
import { handleExportJob, type ExportJobData } from "../src/jobs/export.js";
import type { WorkerDependencies } from "../src/jobs/types.js";
import {
  configureWorkerStorageEnvironment,
  createStagingS3Client,
  deleteStagingObject,
  ensureStagingBucket,
  stagingContext,
  stagingEnabled,
  type StagingStorageConfig,
} from "./staging-helpers.js";

const NOW = new Date("2026-11-17T10:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const buffer = Buffer.from(bytes);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("ZIP end-of-central-directory record not found");
  }
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central-directory entry at ${offset}`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      size: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(bytes: Uint8Array, name: string): Buffer {
  const buffer = Buffer.from(bytes);
  const entry = zipEntries(buffer).find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(`ZIP entry "${name}" not found`);
  }
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Invalid ZIP local header for ${name}`);
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  return entry.method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
}

function exportRecord(scope: "trip" | "workspace", tripId: string | null) {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    tripId,
    requestedById: randomUUID(),
    scope,
    format: "zip",
    includeComments: false,
    includeExpenses: true,
    includeMedia: true,
    status: "queued",
    storageKey: null,
    error: null,
    expiresAt: null,
    createdAt: NOW,
    completedAt: null,
  };
}

function createExportDeps(
  record: ReturnType<typeof exportRecord>,
  trip: Record<string, unknown>,
  photoKey: string,
  photoId: string,
): {
  deps: WorkerDependencies;
  updates: Array<{ data: Record<string, unknown> }>;
} {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const entries = [
    {
      id: randomUUID(),
      date: new Date("2026-11-12T00:00:00.000Z"),
      title: "雨后的北村",
      location: "首尔 · 北村",
      contentHtml: "<p>沿着石墙走到茶室。</p>",
      deletedAt: null,
    },
  ];
  const itinerary = [
    { id: randomUUID(), date: new Date("2026-11-12T00:00:00.000Z"), order: 0, title: "北村散步" },
  ];
  const expenses = [
    {
      id: randomUUID(),
      date: new Date("2026-11-12T00:00:00.000Z"),
      note: "茶室",
      amountMinor: 18000,
    },
  ];
  const packing = [{ id: randomUUID(), order: 0, name: "雨伞", packed: true }];
  const media = [
    {
      id: photoId,
      key: photoKey,
      mimeType: "image/png",
      size: 68,
      status: "ready",
      deletedAt: null,
    },
  ];
  const db = {
    export: {
      findFirst: vi.fn(async () => record),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push({ data });
        Object.assign(record, data);
        return { count: 1 };
      }),
    },
    trip: {
      findFirst: vi.fn(async () => trip),
      findMany: vi.fn(async () => [trip]),
    },
    workspace: {
      findFirst: vi.fn(async () => ({
        id: record.workspaceId,
        name: "North Star Studio",
        slug: "north-star",
        deletedAt: null,
      })),
    },
    workspaceMember: {
      findMany: vi.fn(async () => [
        {
          userId: record.requestedById,
          role: "owner",
          joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    },
    journalEntry: { findMany: vi.fn(async () => entries) },
    comment: { findMany: vi.fn(async () => []) },
    itineraryItem: { findMany: vi.fn(async () => itinerary) },
    expense: { findMany: vi.fn(async () => expenses) },
    packingItem: { findMany: vi.fn(async () => packing) },
    media: { findMany: vi.fn(async () => media) },
    user: {
      findUnique: vi.fn(async () => ({
        email: "owner@roamlog.test",
        name: "Staging Owner",
      })),
    },
    auditLog: { create: vi.fn(async () => undefined) },
  };

  return {
    deps: {
      db,
      storage: createStorage(),
      images: { process: vi.fn() },
      email: {
        send: vi.fn(async () => ({ providerId: "staging-export-email" })),
        render: vi.fn(),
      },
      now: () => NOW,
      logger: stagingContext("staging-export").logger,
    },
    updates,
  };
}

describe.skipIf(!stagingEnabled)("staging exports: real MinIO ZIPs", () => {
  let config: StagingStorageConfig;
  let client: S3Client;
  let photoKey: string;
  let photoId: string;
  const objectKeys = new Set<string>();

  beforeAll(async () => {
    config = configureWorkerStorageEnvironment();
    client = createStagingS3Client(config);
    await ensureStagingBucket(client, config.bucket);
    photoKey = `_staging/${randomUUID()}/original.png`;
    photoId = randomUUID();
    objectKeys.add(photoKey);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: photoKey,
        Body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
          "base64",
        ),
        ContentType: "image/png",
      }),
    );
  });

  afterAll(async () => {
    for (const key of objectKeys) {
      await deleteStagingObject(client, config.bucket, key);
    }
    client.destroy();
  });

  async function runExport(
    scope: "trip" | "workspace",
    trip: Record<string, unknown>,
  ): Promise<void> {
    const record = exportRecord(scope, scope === "trip" ? String(trip.id) : null);
    const { deps, updates } = createExportDeps(record, trip, photoKey, photoId);
    const data: ExportJobData = {
      exportId: record.id,
      workspaceId: record.workspaceId,
    };
    await handleExportJob(data, stagingContext(`staging-export-${record.id}`), deps);

    const ready = updates.find((update) => update.data.status === "ready")?.data;
    if (!ready) {
      throw new Error("Export did not reach ready state");
    }
    const storageKey = String(ready.storageKey);
    objectKeys.add(storageKey);
    expect(ready.expiresAt).toBeInstanceOf(Date);
    expect(ready.completedAt).toBeInstanceOf(Date);
    expect((ready.expiresAt as Date).getTime() - (ready.completedAt as Date).getTime()).toBe(
      SEVEN_DAYS_MS,
    );

    const archive = await deps.storage.getObject(storageKey);
    const names = zipEntries(archive.bytes).map((entry) => entry.name);
    if (scope === "trip") {
      expect(names).toEqual(
        expect.arrayContaining([
          "trip.json",
          "journal.md",
          "itinerary.csv",
          "expenses.csv",
          "packing.csv",
          "README.txt",
          `photos/${photoId}-original.png`,
        ]),
      );
      const journal = readZipEntry(archive.bytes, "journal.md").toString("utf8");
      expect(journal).toContain("雨后的北村");
      const tripJson = JSON.parse(readZipEntry(archive.bytes, "trip.json").toString("utf8"));
      expect(tripJson.title).toBe(trip.title);
    } else {
      const prefix = `trips/${String(trip.title)
        .trim()
        .replace(/[^A-Za-z0-9\u4e00-\u9fa5_-]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 60)}-${String(trip.id)}`;
      expect(names).toEqual(
        expect.arrayContaining([
          "workspace.json",
          "members.csv",
          `${prefix}/trip.json`,
          `${prefix}/journal.md`,
          `${prefix}/photos/${photoId}-original.png`,
          "README.txt",
        ]),
      );
      const workspaceJson = JSON.parse(
        readZipEntry(archive.bytes, "workspace.json").toString("utf8"),
      );
      expect(workspaceJson.workspace.name).toBe("North Star Studio");
    }
  }

  it("builds a trip ZIP and applies the seven-day expiry", async () => {
    await runExport("trip", {
      id: "01942f30-1200-7000-8000-000000000801",
      workspaceId: "01942f30-1200-7000-8000-000000000802",
      title: "首尔，慢一点",
      summary: "秋天的首尔",
      visibility: "workspace",
      deletedAt: null,
    });
  });

  it("builds a workspace ZIP with per-trip directories", async () => {
    await runExport("workspace", {
      id: "01942f30-1200-7000-8000-000000000803",
      workspaceId: "01942f30-1200-7000-8000-000000000804",
      title: "京都，沿着鸭川散步",
      summary: "十一月",
      visibility: "workspace",
      deletedAt: null,
    });
  });
});
