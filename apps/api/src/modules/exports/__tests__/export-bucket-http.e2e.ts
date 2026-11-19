/**
 * Real-HTTP proof for the export bucket propagation (task EXPORT_BUCKET).
 *
 * Boots a Nest HTTP server on 127.0.0.1:4350 backed by:
 *  - a **real PostgreSQL schema** (`expbucket_http`, created and migrated below
 *    from `packages/db/prisma/migrations`),
 *  - the real `ExportsService`, `ExportsRepository` and Prisma client,
 *  - a real `StorageService` with real SigV4 presigning.
 *
 * Only the request actor, workspace access, permissions, audit, queue and log
 * sink are doubles — the bucket routing (the thing under test) is the production
 * code path.
 *
 * Steps:
 *  1. POST an export while the effective bucket is A → the row records A and the
 *     API response never exposes the storage bucket;
 *  2. mark the row ready (the worker step) and GET it while the effective bucket
 *     is still A → URL path is A;
 *  3. switch the effective bucket to B (as an admin save of `storage.bucket`
 *     does) and GET the same export → URL still points at A, never B;
 *  4. a legacy row with `bucket = NULL` → falls back to B and logs one
 *     throttled `export.bucket_missing` warning.
 *
 * Run:
 *   node --import tsx src/modules/exports/__tests__/export-bucket-http.e2e.mts
 *
 * The schema is throwaway: it is dropped and recreated on every run.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { S3Client } from "@aws-sdk/client-s3";
import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import {
  WorkspaceAccessService,
  type WorkspaceMembershipAccess,
} from "../../../common/services/workspace-access.service.js";
import type { AppConfigService } from "../../../config/app-config.service.js";
import { AuditService } from "../../audit/audit.service.js";
import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { StorageSettings } from "../../../config/storage-settings.js";
import { StorageService } from "../../storage/storage.service.js";
import { ExportsService } from "../exports.service.js";
import { ExportsRepository } from "../exports.repository.js";
import { JobQueueService } from "../job-queue.service.js";

const PORT = 4350;
const HARNESS_SCHEMA = "expbucket_http";
const DB_URL =
  process.env.EXPORT_BUCKET_TEST_DATABASE_URL ??
  "postgresql://postgres@127.0.0.1:55444/roamlog_local";
const API = `http://127.0.0.1:${PORT}`;
const PUBLIC_ENDPOINT = "https://media.example.test";

const USER_ID = "0199f0a0-0000-7000-8000-000000000001";
const WORKSPACE_ID = "0199f0a0-0000-7000-8000-000000000002";
const MEMBER_ID = "0199f0a0-0000-7000-8000-000000000003";
const LEGACY_EXPORT_ID = "0199f0a0-0000-7000-8000-000000000011";

const repoRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));

function logger(warns: Array<{ context: unknown; message: string }>): PinoLoggerService {
  return {
    log: () => undefined,
    debug: () => undefined,
    verbose: () => undefined,
    info: () => undefined,
    warn: (context: unknown, message: string) => {
      warns.push({ context, message });
    },
    fatal: (...args: unknown[]) => console.error(...args),
    error: (...args: unknown[]) => console.error(...args),
  } as unknown as PinoLoggerService;
}

function withSchema(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

async function migrateHarnessSchema(): Promise<void> {
  // `migrate reset` drops and recreates only this throwaway schema.
  const databaseUrl = withSchema(DB_URL, HARNESS_SCHEMA);
  try {
    execSync("pnpm --filter @roamlog/db exec prisma migrate reset --force", {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  } catch (error) {
    const failure = error as { stdout?: Buffer; stderr?: Buffer };
    process.stderr.write(failure.stdout?.toString() ?? "");
    process.stderr.write(failure.stderr?.toString() ?? "");
    throw error;
  }
}

/** Real SigV4 storage stack whose effective bucket the harness can switch. */
function createStorage(warns: Array<{ context: unknown; message: string }>) {
  let bucket = "roamlog-bucket-a";
  const deleted: Array<{ bucket: unknown; key: unknown }> = [];
  const settings = (): StorageSettings => ({
    endpoint: "https://media.example.test",
    publicEndpoint: PUBLIC_ENDPOINT,
    bucket,
    accessKey: "access",
    secretKey: "secret",
    region: "us-east-1",
    forcePathStyle: true,
    signedUrlTtlSeconds: 900,
    mediaSignedUrlTtlSeconds: 900,
  });
  const internal = {
    send: async (command: { input?: { Bucket?: unknown; Key?: unknown } }) => {
      if (command.input?.Key !== undefined) {
        deleted.push({ bucket: command.input.Bucket, key: command.input.Key });
      }
      return {};
    },
  };
  const signing = new S3Client({
    region: "us-east-1",
    endpoint: PUBLIC_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: "access", secretAccessKey: "secret" },
  });
  const provider = {
    signingEndpoint: PUBLIC_ENDPOINT,
    get: async () => ({
      version: bucket,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      internal: internal as any,
      public: signing,
      bucket,
      forcePathStyle: true,
      signingEndpoint: PUBLIC_ENDPOINT,
      settings: settings(),
    }),
  };
  const storage = new StorageService(settings(), logger(warns), undefined, undefined, provider);
  return {
    storage,
    deleted,
    get bucket() {
      return bucket;
    },
    setBucket(next: string) {
      bucket = next;
    },
  };
}

const actor: AuthenticatedActor = {
  user: { id: USER_ID } as AuthenticatedActor["user"],
  ip: "127.0.0.1",
  userAgent: "export-bucket-harness",
};

const membership: WorkspaceMembershipAccess = {
  id: MEMBER_ID,
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  role: "owner",
  status: "active",
  joinedAt: new Date("2026-01-01T00:00:00.000Z"),
  invitedById: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  workspaceName: "Export bucket harness",
};

@Controller()
class HarnessExportsController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  @Post("harness/exports")
  create(@Body() body: unknown, @Query() query: unknown) {
    return this.exports.create(actor, body, query);
  }

  @Get("harness/exports/:exportId")
  get(@Param("exportId") exportId: string) {
    return this.exports.get(actor, exportId);
  }

  @Delete("harness/exports/:exportId")
  remove(@Param("exportId") exportId: string) {
    return this.exports.remove(actor, exportId);
  }
}

async function main(): Promise<void> {
  await migrateHarnessSchema();
  const warns: Array<{ context: unknown; message: string }> = [];
  const prisma = new PrismaService(
    { databaseUrl: withSchema(DB_URL, HARNESS_SCHEMA) } as unknown as AppConfigService,
    logger(warns),
  );
  const storage = createStorage(warns);

  await prisma.client.$transaction(async (tx) => {
    await tx.user.create({
      data: { id: USER_ID, email: "export-bucket-http@roamlog.test", name: "Bucket Harness" },
    });
    await tx.workspace.create({
      data: { id: WORKSPACE_ID, name: "Bucket Harness", slug: "bucket-harness", ownerId: USER_ID },
    });
    await tx.workspaceMember.create({
      data: { id: MEMBER_ID, workspaceId: WORKSPACE_ID, userId: USER_ID, role: "owner" },
    });
  });

  const app = await Test.createTestingModule({
    controllers: [HarnessExportsController],
    providers: [
      ExportsService,
      { provide: ExportsRepository, useValue: new ExportsRepository(prisma) },
      {
        provide: WorkspaceAccessService,
        useValue: { requireMembership: async () => membership },
      },
      { provide: PermissionService, useValue: { assertCan: () => undefined } },
      { provide: StorageService, useValue: storage.storage },
      { provide: AuditService, useValue: { record: async () => ({ id: "audit-harness" }) } },
      {
        provide: JobQueueService,
        useValue: {
          enqueue: async (request: { jobId: string; queue: string; name: string }) => ({
            jobId: request.jobId,
            queue: request.queue,
            name: request.name,
          }),
        },
      },
      { provide: PinoLoggerService, useValue: logger(warns) },
    ],
  }).compile();
  const server = app.createNestApplication();
  await server.listen(PORT, "127.0.0.1");
  console.log(`Export bucket harness listening on ${API}`);

  try {
    console.log("\n## step 1 — create an export while the effective bucket is A");
    const createdResponse = await fetch(
      `${API}/harness/exports?workspaceId=${WORKSPACE_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "workspace", format: "zip" }),
      },
    );
    const created = (await createdResponse.json()) as Record<string, unknown>;
    assert.equal(createdResponse.status, 201);
    const exportId = String(created.id ?? "");
    assert.ok(exportId, "create must return an export id");
    assert.ok(!("bucket" in created), "storage bucket must not leak into the response");
    const row = await prisma.client.export.findUniqueOrThrow({ where: { id: exportId } });
    assert.equal(row.bucket, "roamlog-bucket-a");
    console.log(JSON.stringify({ id: exportId, rowBucket: row.bucket, responseKeys: Object.keys(created).sort() }));

    console.log("\n## step 2 — the worker finishes and the first download uses A");
    await prisma.client.export.update({
      where: { id: exportId },
      data: {
        status: "ready",
        storageKey: `exports/${WORKSPACE_ID}/${exportId}/export.zip`,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      },
    });
    const firstResponse = await fetch(`${API}/harness/exports/${exportId}`);
    const first = (await firstResponse.json()) as { downloadUrl: string | null };
    assert.equal(firstResponse.status, 200);
    assert.ok(first.downloadUrl?.includes("/roamlog-bucket-a/"));
    console.log(JSON.stringify({ bucketInUrl: "/roamlog-bucket-a/", downloadUrl: first.downloadUrl }));

    console.log("\n## step 3 — switch the effective bucket and re-download the old export");
    storage.setBucket("roamlog-bucket-b");
    const secondResponse = await fetch(`${API}/harness/exports/${exportId}`);
    const second = (await secondResponse.json()) as { downloadUrl: string | null };
    assert.equal(secondResponse.status, 200);
    assert.ok(second.downloadUrl?.includes("/roamlog-bucket-a/"), "old export must stay on bucket A");
    assert.ok(!second.downloadUrl?.includes("/roamlog-bucket-b/"), "old export must not fall back to B");
    console.log(JSON.stringify({ configuredBucket: storage.bucket, downloadUrl: second.downloadUrl }));

    console.log("\n## step 4 — a legacy row (bucket NULL) falls back to B and warns");
    await prisma.client.export.create({
      data: {
        id: LEGACY_EXPORT_ID,
        workspaceId: WORKSPACE_ID,
        requestedById: USER_ID,
        scope: "workspace",
        format: "zip",
        status: "ready",
        storageKey: `exports/${WORKSPACE_ID}/${LEGACY_EXPORT_ID}/export.zip`,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      },
    });
    const legacyResponse = await fetch(`${API}/harness/exports/${LEGACY_EXPORT_ID}`);
    const legacy = (await legacyResponse.json()) as { downloadUrl: string | null };
    assert.equal(legacyResponse.status, 200);
    assert.ok(legacy.downloadUrl?.includes("/roamlog-bucket-b/"));
    const missing = warns.filter((entry) => entry.message === "export.bucket_missing");
    assert.equal(missing.length, 1, "one throttled export.bucket_missing warning");
    assert.deepEqual(missing[0]?.context, {
      code: "EXPORT_BUCKET_MISSING",
      count: 1,
      sampleExportId: LEGACY_EXPORT_ID,
    });
    console.log(
      JSON.stringify({
        configuredBucket: storage.bucket,
        downloadUrl: legacy.downloadUrl,
        warnings: missing.map((entry) => entry.message),
      }),
    );

    console.log("\nALL EXPORT BUCKET HTTP ASSERTIONS PASSED");
  } finally {
    await server.close();
    await prisma.onModuleDestroy();
  }
}

await main();