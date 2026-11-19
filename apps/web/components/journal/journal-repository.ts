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
