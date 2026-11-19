import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CreateJournalEntryRequestSchema,
  EntryListQuerySchema,
  FavoriteEntryRequestSchema,
  TripEntryListQuerySchema,
  UpdateJournalEntryRequestSchema,
  type EntryPage,
  type EntryRevision,
  type JournalEntry,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { SanitizeService } from "../../common/services/sanitize.service.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import {
  assertDateWithinTrip,
  assertTripVisible,
  assertUuid,
  dateOnlyToDate,
  sortParts,
} from "../trips/content-values.js";
import {
  presentEntry,
  presentRevision,
} from "../trips/content-presenters.js";
import type { EntryRecord, RevisionRecord } from "../trips/content-records.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import { TripsRepository } from "../trips/trips.repository.js";
import { VersionConflictException } from "../trips/version-conflict.exception.js";
import {
  EntriesRepository,
  type EntryUpdateData,
  type RevisionCreateData,
} from "./entries.repository.js";

@Injectable()
export class EntriesService {
  constructor(
    @Inject(EntriesRepository) private readonly repository: EntriesRepository,
    @Inject(TripsRepository) private readonly trips: TripsRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    @Inject(SanitizeService)
    private readonly sanitizer: SanitizeService = new SanitizeService(),
  ) {}

  async listWorkspace(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawQuery: unknown,
  ): Promise<EntryPage> {
    this.permissions.assertCan(membership.role, "entry:read", "journal_entry");
    const query = parseRequest(TripEntryListQuerySchema, rawQuery);
    return this.listEntries(
      query,
      {
        workspaceId: membership.workspaceId,
        deletedAt: null,
        trip: {
          deletedAt: null,
          ...(membership.role === "owner" || membership.role === "admin"
            ? {}
            : {
                OR: [
                  { visibility: { in: ["workspace", "public_link"] } },
                  { createdById: membership.userId },
                ],
              }),
        },
      },
    );
  }

  async listByTrip(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawQuery: unknown,
  ): Promise<EntryPage> {
    this.permissions.assertCan(membership.role, "entry:read", "journal_entry");
    await this.requireTrip(membership, tripId);
    const query = parseRequest(EntryListQuerySchema, rawQuery);
    return this.listEntries(query, {
      workspaceId: membership.workspaceId,
      tripId,
      deletedAt: null,
    });
  }

  async create(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<JournalEntry> {
    this.permissions.assertCan(membership.role, "entry:create", "journal_entry");
    const input = parseRequest(CreateJournalEntryRequestSchema, rawInput);
    const trip = await this.requireTrip(membership, tripId);
    const date = dateOnlyToDate(input.date);
    assertDateWithinTrip(date, trip.startDate, trip.endDate);

    return this.repository.transaction(async (tx) => {
      const contentHtml = this.sanitizer.sanitizeHtml(input.contentHtml ?? "");
      const record = await this.repository.createEntry(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        title: input.title,
        date,
        location: input.location,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        mood: input.mood ?? null,
        weather: input.weather ?? null,
        contentJson: input.contentJson,
        contentHtml,
        excerpt: input.excerpt ?? excerptFromHtml(contentHtml),
        tags: input.tags ?? [],
        favorite: input.favorite ?? false,
        createdById: actor.user.id,
        updatedById: actor.user.id,
      });
      await this.saveRevision(tx, record, actor.user.id);
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "entry.created",
        entityType: "entry",
        entityId: record.id,
        metadata: { version: record.version, date: presentEntryDate(record.date) },
      });
      return this.presentEntry(record);
    });
  }

  async get(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    entryId: string,
  ): Promise<JournalEntry> {
    this.permissions.assertCan(membership.role, "entry:read", "journal_entry");
    const entry = await this.requireEntry(membership.workspaceId, entryId);
    await this.assertEntryTripVisible(membership, entry.tripId);
    return this.presentEntry(entry);
  }

  async update(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    entryId: string,
    rawInput: unknown,
  ): Promise<JournalEntry> {
    this.permissions.assertCan(membership.role, "entry:update", "journal_entry");
    const input = parseRequest(UpdateJournalEntryRequestSchema, rawInput);
    const current = await this.requireEntry(membership.workspaceId, entryId);
    const trip = await this.requireTrip(membership, current.tripId);
    const nextDate = input.date ? dateOnlyToDate(input.date) : current.date;
    assertDateWithinTrip(nextDate, trip.startDate, trip.endDate);

    const data: EntryUpdateData = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.date !== undefined ? { date: nextDate } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.lat !== undefined ? { lat: input.lat } : {}),
      ...(input.lng !== undefined ? { lng: input.lng } : {}),
      ...(input.mood !== undefined ? { mood: input.mood } : {}),
      ...(input.weather !== undefined ? { weather: input.weather } : {}),
      ...(input.contentJson !== undefined ? { contentJson: input.contentJson } : {}),
      ...(input.contentHtml !== undefined
        ? { contentHtml: this.sanitizer.sanitizeHtml(input.contentHtml) }
        : {}),
      ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
      updatedById: actor.user.id,
    };

    return this.repository.transaction(async (tx) => {
      const count = await this.repository.updateEntry(tx, {
        workspaceId: membership.workspaceId,
        entryId,
        version: input.version,
        data,
      });
      if (count === 0) {
        const latest = await this.repository.findEntry(membership.workspaceId, entryId, tx);
        if (!latest) {
          throw this.notFound();
        }
        throw new VersionConflictException(this.presentEntry(latest));
      }
      const updated = await this.repository.findEntry(membership.workspaceId, entryId, tx);
      if (!updated) {
        throw this.notFound();
      }
      await this.saveRevision(tx, updated, actor.user.id);
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: updated.tripId,
        actorId: actor.user.id,
        verb: "entry.updated",
        entityType: "entry",
        entityId: entryId,
        metadata: {
          version: updated.version,
          fields: Object.keys(input).filter((field) => field !== "version").sort(),
        },
      });
      return this.presentEntry(updated);
    });
  }

  async remove(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    entryId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "entry:delete", "journal_entry");
    const current = await this.requireEntry(membership.workspaceId, entryId);
    await this.assertEntryTripVisible(membership, current.tripId);

    await this.repository.transaction(async (tx) => {
      const count = await this.repository.softDeleteEntry(tx, {
        workspaceId: membership.workspaceId,
        entryId,
        actorId: actor.user.id,
      });
      if (count === 0) {
        throw this.notFound();
      }
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: current.tripId,
        actorId: actor.user.id,
        verb: "entry.deleted",
        entityType: "entry",
        entityId: entryId,
        metadata: {},
      });
    });
    return { message: "Entry deleted." };
  }

  async favorite(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    entryId: string,
    rawInput: unknown,
  ): Promise<JournalEntry> {
    this.permissions.assertCan(membership.role, "entry:favorite", "journal_entry");
    const input = parseRequest(FavoriteEntryRequestSchema, rawInput);
    const current = await this.requireEntry(membership.workspaceId, entryId);
    await this.assertEntryTripVisible(membership, current.tripId);

    return this.repository.transaction(async (tx) => {
      const updated = await this.repository.setFavorite(tx, {
        entryId,
        favorite: input.favorite,
        actorId: actor.user.id,
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: updated.tripId,
        actorId: actor.user.id,
        verb: "entry.favorited",
        entityType: "entry",
        entityId: entryId,
        metadata: { favorite: input.favorite, version: updated.version },
      });
      return this.presentEntry(updated);
    });
  }

  async listRevisions(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    entryId: string,
  ): Promise<EntryRevision[]> {
    this.permissions.assertCan(membership.role, "revision:read", "revision");
    const entry = await this.requireEntry(membership.workspaceId, entryId);
    await this.assertEntryTripVisible(membership, entry.tripId);
    const revisions = await this.repository.listRevisions(
      membership.workspaceId,
      entryId,
    );
    return revisions.map((revision) => this.presentRevision(revision));
  }

  async restore(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    entryId: string,
    revisionId: string,
  ): Promise<JournalEntry> {
    this.permissions.assertCan(membership.role, "revision:restore", "revision");
    assertUuid(revisionId, "revisionId");
    const current = await this.requireEntry(membership.workspaceId, entryId);
    await this.assertEntryTripVisible(membership, current.tripId);

    return this.repository.transaction(async (tx) => {
      const revision = await this.repository.findRevision(
        membership.workspaceId,
        entryId,
        revisionId,
        tx,
      );
      if (!revision) {
        throw new NotFoundException({
          code: "REVISION_NOT_FOUND",
          message: "The requested revision was not found.",
        });
      }
      const contentHtml = this.sanitizer.sanitizeHtml(revision.contentHtml);
      const count = await this.repository.updateEntry(tx, {
        workspaceId: membership.workspaceId,
        entryId,
        version: current.version,
        data: {
          title: revision.title,
          contentJson: asJsonObject(revision.contentJson),
          contentHtml,
          updatedById: actor.user.id,
        },
      });
      if (count === 0) {
        const latest = await this.repository.findEntry(membership.workspaceId, entryId, tx);
        throw latest
          ? new VersionConflictException(this.presentEntry(latest))
          : this.notFound();
      }
      const updated = await this.repository.findEntry(membership.workspaceId, entryId, tx);
      if (!updated) {
        throw this.notFound();
      }
      await this.saveRevision(tx, updated, actor.user.id);
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: updated.tripId,
        actorId: actor.user.id,
        verb: "entry.revision_restored",
        entityType: "entry",
        entityId: entryId,
        metadata: { revisionId, restoredFromVersion: revision.version, version: updated.version },
      });
      return this.presentEntry(updated);
    });
  }

  private async listEntries(
    query: ReturnType<typeof EntryListQuerySchema.parse>,
    baseWhere: Record<string, unknown>,
  ): Promise<EntryPage> {
    const { field, direction } = sortParts(
      query.sort,
      ["date", "updatedAt", "createdAt", "title"],
      "date",
    );
    const records = await this.repository.listEntries({
      where: {
        ...baseWhere,
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: "insensitive" } },
                { location: { contains: query.q, mode: "insensitive" } },
                { excerpt: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
        ...(query.favorite !== undefined ? { favorite: query.favorite } : {}),
        ...(query.from ? { date: { gte: dateOnlyToDate(query.from) } } : {}),
        ...(query.to ? { date: { lte: dateOnlyToDate(query.to) } } : {}),
      },
      orderBy: [{ [field]: direction }, { id: "asc" }],
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
    });
    return toCursorPage(
      records,
      query.limit,
      (record) => this.presentEntry(record),
    ) as EntryPage;
  }

  private async requireEntry(workspaceId: string, entryId: string) {
    const entry = await this.repository.findEntry(workspaceId, entryId);
    if (!entry) {
      throw this.notFound();
    }
    return entry;
  }

  private async requireTrip(
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ) {
    const trip = await this.trips.findTrip(membership.workspaceId, tripId);
    if (!trip) {
      throw new NotFoundException({
        code: "TRIP_NOT_FOUND",
        message: "The requested trip was not found.",
      });
    }
    assertTripVisible(membership, trip);
    return trip;
  }

  private async assertEntryTripVisible(
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<void> {
    const trip = await this.trips.findTrip(membership.workspaceId, tripId);
    if (!trip) {
      throw new NotFoundException({
        code: "ENTRY_NOT_FOUND",
        message: "The requested entry was not found.",
      });
    }
    assertTripVisible(membership, trip);
  }

  private async saveRevision(
    tx: ContentTransaction,
    entry: {
      id: string;
      workspaceId: string;
      version: number;
      title: string;
      contentJson: unknown;
      contentHtml: string;
    },
    actorId: string,
  ): Promise<void> {
    const data: RevisionCreateData = {
      workspaceId: entry.workspaceId,
      entryId: entry.id,
      version: entry.version,
      title: entry.title,
      contentJson: asJsonObject(entry.contentJson),
      contentHtml: this.sanitizer.sanitizeHtml(entry.contentHtml),
      editedById: actorId,
    };
    await this.repository.createRevision(tx, data);
    await this.repository.trimRevisions(tx, entry.id, entry.workspaceId, 50);
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "ENTRY_NOT_FOUND",
      message: "The requested entry was not found.",
    });
  }

  private presentEntry(record: EntryRecord): JournalEntry {
    // Explicit passthrough: the presenter argument is built field by field, so
    // a future `EntryRecord` column can never reach the strict contract.
    return presentEntry({
      id: record.id,
      tripId: record.tripId,
      workspaceId: record.workspaceId,
      title: record.title,
      date: record.date,
      location: record.location,
      lat: record.lat,
      lng: record.lng,
      mood: record.mood,
      weather: record.weather,
      contentJson: record.contentJson,
      contentHtml: this.sanitizer.sanitizeHtml(record.contentHtml),
      excerpt: record.excerpt,
      tags: record.tags,
      favorite: record.favorite,
      version: record.version,
      createdById: record.createdById,
      updatedById: record.updatedById,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
    });
  }

  private presentRevision(record: RevisionRecord): EntryRevision {
    // Same explicit passthrough for revisions: `presentRevision` validates a
    // strict schema, and this layer only replaces the sanitized HTML.
    return presentRevision({
      id: record.id,
      workspaceId: record.workspaceId,
      entryId: record.entryId,
      version: record.version,
      title: record.title,
      contentJson: record.contentJson,
      contentHtml: this.sanitizer.sanitizeHtml(record.contentHtml),
      editedById: record.editedById,
      createdAt: record.createdAt,
    });
  }
}

function asJsonObject(value: unknown): object {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw new BadRequestException({
    code: "INVALID_CONTENT_JSON",
    message: "contentJson must be a JSON object.",
  });
}

function excerptFromHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function presentEntryDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
