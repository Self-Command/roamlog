import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  CreateExportRequestSchema,
  ExportListQuerySchema,
  UuidV7Schema,
  encodeCursor,
  type Export,
  type ExportDetail,
  type ExportPage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import {
  WorkspaceAccessService,
  type WorkspaceMembershipAccess,
} from "../../common/services/workspace-access.service.js";
import { AuditService } from "../audit/audit.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { StorageService } from "../storage/storage.service.js";
import { assertTripVisible, sortParts } from "../trips/content-values.js";
import { canAccessExport, canDownloadExport, isExportExpired } from "./export-rules.js";
import type { ExportRecord } from "./export-records.js";
import { presentExport, presentExportDetail } from "./export.presenter.js";
import { ExportsRepository } from "./exports.repository.js";
import { JobQueueService, deterministicJobId } from "./job-queue.service.js";

/** At most one `export.bucket_missing` warning per process per window. */
const BUCKET_MISSING_WARN_INTERVAL_MS = 60_000;

@Injectable()
export class ExportsService {
  private lastMissingBucketWarningAt = 0;
  private missingBucketCount = 0;

  constructor(
    @Inject(ExportsRepository) private readonly repository: ExportsRepository,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobQueueService) private readonly queue: JobQueueService,
    @Optional() @Inject(PinoLoggerService) private readonly logger?: PinoLoggerService,
  ) {}

  async create(
    actor: AuthenticatedActor,
    rawInput: unknown,
    query: unknown,
  ): Promise<Export> {
    const input = parseRequest(CreateExportRequestSchema, rawInput);
    const { workspaceId, membership, tripId } = await this.resolveScope(
      actor,
      input.scope,
      input.tripId ?? null,
      workspaceIdFromQuery(query),
    );
    this.permissions.assertCan(membership.role, "export:create", "export");

    // Capture the bucket now, from the effective configuration (never
    // `process.env.S3_BUCKET`): this is the bucket the artifact is written to,
    // and the row must remember it so a later admin switch cannot strand the
    // download on a bucket that never held the object.
    const bucket = await this.storage.currentBucket();

    const record = await this.repository.createExport({
      workspaceId,
      tripId,
      requestedById: actor.user.id,
      scope: input.scope,
      format: input.format,
      includeComments: input.includeComments,
      includeExpenses: input.includeExpenses,
      includeMedia: input.includeMedia,
      bucket,
    });

    try {
      await this.queue.enqueue({
        queue: "export",
        name: "export.generate",
        jobId: deterministicJobId("export", record.id),
        data: { exportId: record.id, workspaceId },
      });
    } catch (error) {
      await this.repository.markFailed(
        record.id,
        error instanceof Error ? error.message : "Failed to enqueue export.",
      );
      throw error;
    }

    await this.audit.record({
      actorId: actor.user.id,
      actorType: "user",
      action: "export.requested",
      targetType: "export",
      targetId: record.id,
      workspaceId,
      ...(actor.ip ? { ip: actor.ip } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      metadata: {
        scope: input.scope,
        format: input.format,
        includeComments: input.includeComments,
        includeExpenses: input.includeExpenses,
        includeMedia: input.includeMedia,
      },
    });

    return presentExport(record);
  }

  async list(
    actor: AuthenticatedActor,
    rawQuery: unknown,
  ): Promise<ExportPage> {
    const query = parseRequest(ExportListQuerySchema, rawQuery);
    const memberships = await this.repository.memberships(actor.user.id);
    const adminWorkspaceIds = memberships
      .filter((membership) => membership.role === "owner" || membership.role === "admin")
      .map((membership) => membership.workspaceId);
    const { field, direction } = sortParts(query.sort, ["createdAt"], "createdAt");

    const records = await this.repository.listExports({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.scope ? { scope: query.scope } : {}),
        OR: [
          { requestedById: actor.user.id },
          ...(adminWorkspaceIds.length > 0
            ? [{ workspaceId: { in: adminWorkspaceIds } }]
            : []),
        ],
      },
      orderBy: [{ [field]: direction }, { id: "asc" }],
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
    });
    const hasMore = records.length > query.limit;
    const visible = hasMore ? records.slice(0, query.limit) : records;
    const last = visible.at(-1);
    return {
      items: visible.map((record) => presentExport(record)),
      nextCursor:
        hasMore && last
          ? encodeCursor({ id: last.id, createdAt: last.createdAt })
          : null,
      hasMore,
    };
  }

  async get(actor: AuthenticatedActor, exportId: string): Promise<ExportDetail> {
    const record = await this.requireExport(exportId);
    await this.assertCanRead(actor, record);
    if (isExportExpired(record)) {
      await this.repository.markExpired(exportId);
      return presentExportDetail(record, null, {
        status: "expired",
        error: "Export expired.",
      });
    }
    if (!canDownloadExport(record)) {
      return presentExportDetail(record, null);
    }

    const signed = await this.storage.createSignedReadUrl(
      record.storageKey ?? "",
      undefined,
      this.bucketFor(record),
    );
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "user",
      action: "export.downloaded",
      targetType: "export",
      targetId: record.id,
      workspaceId: record.workspaceId,
      metadata: { format: record.format },
    });
    return presentExportDetail(record, signed.url);
  }

  async remove(
    actor: AuthenticatedActor,
    exportId: string,
  ): Promise<{ message: string }> {
    const record = await this.requireExport(exportId);
    await this.assertCanRead(actor, record);
    if (record.storageKey) {
      try {
        await this.storage.deleteObject(record.storageKey, this.bucketFor(record));
      } catch {
        // A missing object must not prevent the user from removing history.
      }
    }
    await this.repository.deleteExport(exportId);
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "user",
      action: "export.deleted",
      targetType: "export",
      targetId: exportId,
      workspaceId: record.workspaceId,
      metadata: { format: record.format },
    });
    return { message: "Export deleted." };
  }

  private async resolveScope(
    actor: AuthenticatedActor,
    scope: "trip" | "workspace" | "account",
    tripId: string | null,
    workspaceIdFromQueryValue: string | undefined,
  ): Promise<{
    workspaceId: string;
    membership: WorkspaceMembershipAccess;
    tripId: string | null;
  }> {
    if (scope === "trip") {
      if (!tripId) {
        throw new BadRequestException({
          code: "EXPORT_TRIP_REQUIRED",
          message: "tripId is required for trip exports.",
        });
      }
      const trip = await this.repository.findTrip(tripId);
      if (!trip) {
        throw new NotFoundException({
          code: "TRIP_NOT_FOUND",
          message: "The requested trip was not found.",
        });
      }
      const membership = await this.access.requireMembership(actor.user.id, trip.workspaceId);
      assertTripVisible(membership, trip);
      return { workspaceId: trip.workspaceId, membership, tripId: trip.id };
    }

    const explicit = workspaceIdFromQueryValue
      ? parseWorkspaceId(workspaceIdFromQueryValue)
      : undefined;
    const selected =
      explicit !== undefined
        ? await this.access.requireMembership(actor.user.id, explicit)
        : await this.firstMembership(actor.user.id);
    return { workspaceId: selected.workspaceId, membership: selected, tripId: null };
  }

  private async firstMembership(userId: string): Promise<WorkspaceMembershipAccess> {
    const first = await this.repository.firstMembership(userId);
    if (!first) {
      throw new BadRequestException({
        code: "EXPORT_WORKSPACE_REQUIRED",
        message: "A Workspace is required to create a Workspace or account export.",
      });
    }
    return this.access.requireMembership(userId, first.workspaceId);
  }

  /**
   * Bucket the row's object lives in; `undefined` means "current bucket".
   *
   * Rows created before 0011_export_bucket have NULL. Signing or deleting them
   * against the current bucket preserves the historical behaviour, but it is a
   * guess: emit one throttled warning so a bucket switch that strands old
   * exports is visible in logs instead of only as a 404 for the user.
   */
  private bucketFor(record: ExportRecord): string | undefined {
    const bucket = typeof record.bucket === "string" ? record.bucket.trim() : "";
    if (bucket) {
      return bucket;
    }
    this.noteMissingBucket(record.id);
    return undefined;
  }

  private noteMissingBucket(exportId: string): void {
    this.missingBucketCount += 1;
    const now = Date.now();
    if (now - this.lastMissingBucketWarningAt < BUCKET_MISSING_WARN_INTERVAL_MS) {
      return;
    }
    this.lastMissingBucketWarningAt = now;
    const count = this.missingBucketCount;
    this.missingBucketCount = 0;
    this.logger?.warn(
      { code: "EXPORT_BUCKET_MISSING", count, sampleExportId: exportId },
      "export.bucket_missing",
    );
  }

  private async requireExport(exportId: string): Promise<ExportRecord> {
    if (!UuidV7Schema.safeParse(exportId).success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A valid export id is required.",
      });
    }
    const record = await this.repository.findExport(exportId);
    if (!record) {
      throw new NotFoundException({
        code: "EXPORT_NOT_FOUND",
        message: "The requested export was not found.",
      });
    }
    return record;
  }

  private async assertCanRead(actor: AuthenticatedActor, record: ExportRecord): Promise<void> {
    if (record.requestedById === actor.user.id) {
      return;
    }
    const membership = await this.access.requireMembership(actor.user.id, record.workspaceId);
    if (!canAccessExport(record, actor.user.id, membership.role)) {
      throw new ForbiddenException({
        code: "EXPORT_FORBIDDEN",
        message: "Only the requester or a Workspace administrator can access this export.",
      });
    }
  }
}

function workspaceIdFromQuery(query: unknown): string | undefined {
  if (typeof query !== "object" || query === null) {
    return undefined;
  }
  const value = (query as Record<string, unknown>).workspaceId;
  return typeof value === "string" ? value : undefined;
}

function parseWorkspaceId(value: string): string {
  const parsed = UuidV7Schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "workspaceId must be a UUIDv7.",
    });
  }
  return parsed.data;
}
