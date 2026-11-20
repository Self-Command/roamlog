/**
 * HTTP-level proof for UPLOAD_LIMITS_WIRED.
 *
 * The service-level spec proves the rules; this one proves the *routes*: that
 * `GET .../media/limits` exists and answers with the configured numbers, that
 * `POST .../media/presign-batch` is registered and returns the batch, and that
 * the 422 business codes survive the ProblemDetails filter on the wire.
 *
 * Guards are overridden (auth, tenant, role, rate limits) because they are
 * covered elsewhere; `MediaService` is the real implementation over storage and
 * repository doubles.
 */

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequest } from "../../../common/guards/actor-context.js";
import { RolesGuard } from "../../../common/guards/roles.guard.js";
import { TenantGuard } from "../../../common/guards/tenant.guard.js";
import { ProblemDetailsFilter } from "../../../common/filters/problem-details.filter.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import { MediaPresignRateLimitGuard } from "../../../common/security/media-presign-rate-limit.guard.js";
import { ContentTenantGuard } from "../../trips/content-tenant.guard.js";
import { IdempotencyService } from "../../idempotency/idempotency.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { LimitsRuntime, LimitsSettingsSource } from "../../settings/limits-settings.consumer.js";
import { MediaController } from "../media.controller.js";
import { MediaService } from "../media.service.js";
import { DEFAULT_LIMITS_RUNTIME } from "../media-upload-limits.service.js";
import { MediaTenantGuard } from "../media-tenant.guard.js";
import { MediaUploadRateLimitGuard } from "../media-upload-rate-limit.guard.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const NOW = "2026-11-19T00:00:00.000Z";
const MiB = 1024 * 1024;

const apps: INestApplication[] = [];

function createLogger(): PinoLoggerService {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  } as unknown as PinoLoggerService;
}

function membership(): WorkspaceMembershipAccess {
  return {
    id: "01942f30-1200-7000-8000-0000000000aa",
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: "editor",
    status: "active",
    joinedAt: new Date(NOW),
    invitedById: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    workspaceName: "Upload Limits HTTP",
  };
}

function limitsSource(initial: Partial<LimitsRuntime> = {}) {
  let current: LimitsRuntime = { ...DEFAULT_LIMITS_RUNTIME, ...initial };
  const source: LimitsSettingsSource = { resolve: async () => current };
  return {
    source,
    setRuntime: (next: Partial<LimitsRuntime>) => {
      current = { ...current, ...next };
    },
  };
}

async function createApp(limits: LimitsSettingsSource) {
  const storage = {
    currentBucket: vi.fn(async () => "roamlog-test"),
    createPresignedUpload: vi.fn(async (key: string, mime: string) => ({
      url: `https://media.example.test/${key}`,
      method: "PUT" as const,
      headers: { "Content-Type": mime },
      expiresAt: NOW,
    })),
  };
  const repository = {
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
    createMedia: vi.fn(async (data: Record<string, unknown>) => ({ ...data, status: "pending" })),
  };
  const logger = createLogger();
  const media = new MediaService(
    repository as never,
    {} as never,
    storage as never,
    { enqueue: vi.fn() } as never,
    new PermissionService(),
    { record: vi.fn() } as never,
    undefined,
    undefined,
    logger,
    limits,
  );

  const moduleRef = await Test.createTestingModule({
    controllers: [MediaController],
    providers: [
      { provide: MediaService, useValue: media },
      { provide: IdempotencyService, useValue: { run: vi.fn() } },
    ],
  })
    .overrideGuard(TenantGuard)
    .useValue({
      canActivate: (context: { switchToHttp: () => { getRequest: () => AuthenticatedRequest } }) => {
        const request = context.switchToHttp().getRequest();
        request.user = { id: USER_ID } as never;
        request.workspaceMembership = membership() as never;
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(MediaPresignRateLimitGuard)
    .useValue({ canActivate: () => true })
    // Not used by the routes under test; overriding keeps the module from
    // resolving Prisma for routes this spec never calls.
    .overrideGuard(MediaTenantGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(ContentTenantGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(MediaUploadRateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(
    new ProblemDetailsFilter(logger as never, { captureException: vi.fn() } as never),
  );
  await app.init();
  apps.push(app);
  return { app, repository, storage };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function file(overrides: Record<string, unknown> = {}) {
  return {
    fileName: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    size: 2048,
    ...overrides,
  };
}

describe("GET /v1/workspaces/:workspaceId/media/limits", () => {
  it("answers the configured ceilings and allowance", async () => {
    const { source } = limitsSource({
      uploadMaxFilesPerBatch: 12,
      uploadMaxFileBytes: 4 * MiB,
      uploadMaxBatchBytes: 60 * MiB,
      uploadPerMinute: 9,
    });
    const { app } = await createApp(source);

    const response = await request(app.getHttpServer())
      .get(`/v1/workspaces/${WORKSPACE_ID}/media/limits`)
      .expect(200);

    expect(response.body).toEqual({
      maxFilesPerBatch: 12,
      maxFileBytes: 4 * MiB,
      maxBatchBytes: 60 * MiB,
      presignPerMinute: 9,
    });
  });

  it("answers the new value after the setting changes, not a constant", async () => {
    const { source, setRuntime } = limitsSource();
    const { app } = await createApp(source);

    const before = await request(app.getHttpServer())
      .get(`/v1/workspaces/${WORKSPACE_ID}/media/limits`)
      .expect(200);
    expect(before.body.maxFileBytes).toBe(26_214_400);

    setRuntime({ uploadMaxFileBytes: 1 * MiB });

    const after = await request(app.getHttpServer())
      .get(`/v1/workspaces/${WORKSPACE_ID}/media/limits`)
      .expect(200);
    expect(after.body.maxFileBytes).toBe(1 * MiB);
  });
});

describe("POST /v1/workspaces/:workspaceId/media/presign-batch", () => {
  it("returns one presigned item per file", async () => {
    const { app } = await createApp(limitsSource().source);

    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/media/presign-batch`)
      .send({ files: [file(), file({ fileName: "two.jpg" }), file({ fileName: "three.jpg" })] })
      .expect(201);

    expect(response.body.items).toHaveLength(3);
    expect(response.body.items[0]).toMatchObject({ method: "PUT" });
  });

  it("refuses more files than configured with 422 MEDIA_BATCH_TOO_MANY_FILES", async () => {
    const { app, repository } = await createApp(
      limitsSource({ uploadMaxFilesPerBatch: 2 }).source,
    );

    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/media/presign-batch`)
      .send({ files: [file(), file(), file()] })
      .expect(422);

    expect(response.body.code).toBe("MEDIA_BATCH_TOO_MANY_FILES");
    expect(repository.createMedia).not.toHaveBeenCalled();
  });
});

describe("POST /v1/workspaces/:workspaceId/media/presign", () => {
  it("refuses a file above the configured ceiling with 422 MEDIA_FILE_TOO_LARGE", async () => {
    const { app, repository } = await createApp(
      limitsSource({ uploadMaxFileBytes: 1 * MiB }).source,
    );

    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/media/presign`)
      .send(file({ size: 1 * MiB + 1 }))
      .expect(422);

    expect(response.body.code).toBe("MEDIA_FILE_TOO_LARGE");
    expect(repository.createMedia).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at the configured ceiling", async () => {
    const { app } = await createApp(limitsSource({ uploadMaxFileBytes: 1 * MiB }).source);

    await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/media/presign`)
      .send(file({ size: 1 * MiB }))
      .expect(201);
  });
});