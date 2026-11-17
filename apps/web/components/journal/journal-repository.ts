"use client";

import {
  JournalEntrySchema,
  RevisionListResponseSchema,
  type EntryRevision,
  type JournalEntry,
} from "@roamlog/contracts";
import {
  listEntryRevisions,
  restoreEntryRevision,
} from "@roamlog/api-client";

import { ApiError, type DataAdapter } from "@/lib/api";

export interface JournalSavePayload {
  title: string;
  date: string;
  location: string;
  contentJson: Record<string, unknown>;
  contentHtml: string;
  excerpt: string;
}

export interface JournalEntryRepository {
  readonly mode: "mock" | "api";
  getEntry(entryId: string): Promise<JournalEntry>;
  createEntry(tripId: string, payload: JournalSavePayload): Promise<JournalEntry>;
  saveEntry(
    entryId: string,
    payload: JournalSavePayload,
    expectedVersion: number,
  ): Promise<JournalEntry>;
  listRevisions(entryId: string): Promise<EntryRevision[]>;
  restoreRevision(entryId: string, revisionId: string): Promise<JournalEntry>;
}

const MOCK_OVERRIDES_KEY = "roamlog:journal-editor:entries:v1";
const MOCK_REVISIONS_KEY = "roamlog:journal-editor:revisions:v1";
let mockSequence = 0;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked localStorage must not discard in-memory edits.
  }
}

function nextMockId() {
  mockSequence += 1;
  const stamp = Date.now().toString(16).padStart(12, "0");
  const tail = `${stamp}${mockSequence.toString(16)}`.slice(-12).padStart(12, "0");
  return `019a7e3a-2b40-7c1d-8a5f-${tail}`;
}

function readOverrides(): Record<string, JournalEntry> {
  return readJson<Record<string, JournalEntry>>(MOCK_OVERRIDES_KEY, {});
}

function readRevisionStore(): Record<string, EntryRevision[]> {
  return readJson<Record<string, EntryRevision[]>>(MOCK_REVISIONS_KEY, {});
}

function appendMockRevision(entry: JournalEntry) {
  const revisions = readRevisionStore();
  const revision: EntryRevision = {
    id: nextMockId(),
    workspaceId: entry.workspaceId,
    entryId: entry.id,
    version: entry.version,
    title: entry.title,
    contentJson: entry.contentJson,
    contentHtml: entry.contentHtml,
    editedById: entry.updatedById,
    createdAt: entry.updatedAt,
  };
  revisions[entry.id] = [
    revision,
    ...(revisions[entry.id] ?? []).filter((item) => item.version !== entry.version),
  ].slice(0, 50);
  writeJson(MOCK_REVISIONS_KEY, revisions);
}

export function readMockJournalOverrides(): JournalEntry[] {
  return Object.values(readOverrides());
}

export function mergeMockJournalEntries(base: JournalEntry[]): JournalEntry[] {
  const overrides = readOverrides();
  const byId = new Map(base.map((entry) => [entry.id, entry]));
  for (const override of Object.values(overrides)) {
    byId.set(override.id, override);
  }
  return [...byId.values()];
}

export function resetMockJournalOverrides() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(MOCK_OVERRIDES_KEY);
  window.localStorage.removeItem(MOCK_REVISIONS_KEY);
}

interface MockRepositoryOptions {
  resolveEntry: (entryId: string) => JournalEntry | undefined;
  currentUserId: string;
  workspaceId: string;
  tripId: string;
  location: string;
}

export function createMockJournalRepository({
  resolveEntry,
  currentUserId,
  workspaceId,
  tripId,
  location,
}: MockRepositoryOptions): JournalEntryRepository {
  function findEntry(entryId: string) {
    const override = readOverrides()[entryId];
    const entry = override ?? resolveEntry(entryId);
    if (!entry) throw new ApiError(404, "Journal entry was not found.", "NOT_FOUND");
    return entry;
  }

  function persist(entry: JournalEntry) {
    const overrides = readOverrides();
    overrides[entry.id] = entry;
    writeJson(MOCK_OVERRIDES_KEY, overrides);
    appendMockRevision(entry);
    return entry;
  }

  return {
    mode: "mock",

    async getEntry(entryId) {
      return findEntry(entryId);
    },

    async createEntry(targetTripId, payload) {
      const now = new Date().toISOString();
      const entry: JournalEntry = {
        id: nextMockId(),
        tripId: targetTripId || tripId,
        workspaceId,
        title: payload.title,
        date: payload.date,
        location: payload.location || location,
        lat: null,
        lng: null,
        mood: null,
        weather: null,
        contentJson: payload.contentJson,
        contentHtml: payload.contentHtml,
        excerpt: payload.excerpt,
        tags: [],
        favorite: false,
        version: 1,
        createdById: currentUserId,
        updatedById: currentUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return persist(JournalEntrySchema.parse(entry));
    },

    async saveEntry(entryId, payload, expectedVersion) {
      const current = findEntry(entryId);
      if (current.version !== expectedVersion) {
        throw new ApiError(
          409,
          "This entry was updated by someone else. Reload or overwrite it.",
          "VERSION_CONFLICT",
        );
      }
      const now = new Date().toISOString();
      const updated: JournalEntry = {
        ...current,
        ...payload,
        version: current.version + 1,
        updatedById: currentUserId,
        updatedAt: now,
      };
      return persist(JournalEntrySchema.parse(updated));
    },

    async listRevisions(entryId) {
      return [...(readRevisionStore()[entryId] ?? [])].sort(
        (left, right) => right.version - left.version,
      );
    },

    async restoreRevision(entryId, revisionId) {
      const current = findEntry(entryId);
      const revision = (readRevisionStore()[entryId] ?? []).find(
        (candidate) => candidate.id === revisionId,
      );
      if (!revision) throw new ApiError(404, "Revision was not found.", "NOT_FOUND");
      const now = new Date().toISOString();
      const restored: JournalEntry = {
        ...current,
        title: revision.title,
        contentJson: revision.contentJson,
        contentHtml: revision.contentHtml,
        excerpt: revision.contentHtml
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180),
        version: current.version + 1,
        updatedById: currentUserId,
        updatedAt: now,
      };
      return persist(JournalEntrySchema.parse(restored));
    },
  };
}

function revisionResponseError(status: number, body: unknown): ApiError {
  const detail =
    body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
      ? body.detail
      : "Revision request failed.";
  const code =
    body && typeof body === "object" && "code" in body && typeof body.code === "string"
      ? body.code
      : undefined;
  return new ApiError(status, detail, code);
}

export function createApiJournalRepository(adapter: DataAdapter): JournalEntryRepository {
  return {
    mode: "api",

    getEntry(entryId) {
      return adapter.fetchEntry(entryId);
    },

    createEntry(tripId, payload) {
      return adapter.createEntry(tripId, payload);
    },

    saveEntry(entryId, payload, expectedVersion) {
      return adapter.updateEntry(entryId, { ...payload, version: expectedVersion });
    },

    async listRevisions(entryId) {
      const response = await listEntryRevisions(entryId, { credentials: "include" });
      if (response.status !== 200) {
        throw revisionResponseError(response.status, response.data);
      }
      return RevisionListResponseSchema.parse(response.data);
    },

    async restoreRevision(entryId, revisionId) {
      const response = await restoreEntryRevision(entryId, revisionId, {
        credentials: "include",
      });
      if (response.status !== 200) {
        throw revisionResponseError(response.status, response.data);
      }
      return JournalEntrySchema.parse(response.data);
    },
  };
}
