import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

export function registerContentPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/stops",
    operationId: "listStops",
    tag: "Stops",
    summary: "List trip stops",
    params: c.TripParamsSchema,
    response: c.StopListResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/stops",
    operationId: "createStop",
    tag: "Stops",
    summary: "Create a trip stop",
    params: c.TripParamsSchema,
    body: c.CreateStopRequestSchema,
    response: c.StopSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/stops/{stopId}",
    operationId: "updateStop",
    tag: "Stops",
    summary: "Update a stop with optimistic concurrency",
    params: c.StopParamsSchema,
    body: c.UpdateStopRequestSchema,
    response: c.StopSchema,
    versioned: true,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/stops/{stopId}",
    operationId: "deleteStop",
    tag: "Stops",
    summary: "Soft-delete a stop",
    params: c.StopParamsSchema,
    status: 200,
    response: c.DeleteStopResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/stops/reorder",
    operationId: "reorderStops",
    tag: "Stops",
    summary: "Reorder trip stops",
    params: c.TripParamsSchema,
    body: c.ReorderStopsRequestSchema,
    status: 200,
    response: c.ReorderStopsResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/itinerary",
    operationId: "listItinerary",
    tag: "Itinerary",
    summary: "List itinerary items",
    params: c.TripParamsSchema,
    response: c.ItineraryListResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/itinerary",
    operationId: "createItineraryItem",
    tag: "Itinerary",
    summary: "Create an itinerary item",
    params: c.TripParamsSchema,
    body: c.CreateItineraryItemRequestSchema,
    response: c.ItineraryItemSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/itinerary/{itemId}",
    operationId: "updateItineraryItem",
    tag: "Itinerary",
    summary: "Update an itinerary item with optimistic concurrency",
    params: c.ItineraryItemParamsSchema,
    body: c.UpdateItineraryItemRequestSchema,
    response: c.ItineraryItemSchema,
    versioned: true,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/itinerary/{itemId}",
    operationId: "deleteItineraryItem",
    tag: "Itinerary",
    summary: "Soft-delete an itinerary item",
    params: c.ItineraryItemParamsSchema,
    status: 200,
    response: c.DeleteItineraryItemResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/itinerary/reorder",
    operationId: "reorderItinerary",
    tag: "Itinerary",
    summary: "Reorder itinerary items",
    params: c.TripParamsSchema,
    body: c.ReorderItineraryRequestSchema,
    status: 200,
    response: c.ReorderItineraryResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/entries",
    operationId: "listWorkspaceEntries",
    tag: "Journal",
    summary: "List journal entries in a Workspace",
    params: c.WorkspaceParamsSchema,
    query: c.TripEntryListQuerySchema,
    response: c.EntryPageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/entries",
    operationId: "listTripEntries",
    tag: "Journal",
    summary: "List journal entries for a trip",
    params: c.TripParamsSchema,
    query: c.EntryListQuerySchema,
    response: c.EntryPageSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/entries",
    operationId: "createEntry",
    tag: "Journal",
    summary: "Create a journal entry",
    params: c.TripParamsSchema,
    body: c.CreateJournalEntryRequestSchema,
    response: c.JournalEntrySchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/entries/{entryId}",
    operationId: "getEntry",
    tag: "Journal",
    summary: "Get a journal entry",
    params: c.EntryParamsSchema,
    response: c.JournalEntrySchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/entries/{entryId}",
    operationId: "updateEntry",
    tag: "Journal",
    summary: "Update a journal entry with optimistic concurrency",
    params: c.EntryParamsSchema,
    body: c.UpdateJournalEntryRequestSchema,
    response: c.JournalEntrySchema,
    versioned: true,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/entries/{entryId}",
    operationId: "deleteEntry",
    tag: "Journal",
    summary: "Soft-delete a journal entry",
    params: c.EntryParamsSchema,
    status: 200,
    response: c.DeleteEntryResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/entries/{entryId}/favorite",
    operationId: "favoriteEntry",
    tag: "Journal",
    summary: "Set a journal entry's favorite flag",
    params: c.EntryParamsSchema,
    body: c.FavoriteEntryRequestSchema,
    status: 200,
    response: c.JournalEntrySchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/entries/{entryId}/revisions",
    operationId: "listEntryRevisions",
    tag: "Journal",
    summary: "List entry revisions",
    params: c.EntryParamsSchema,
    response: c.RevisionListResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/entries/{entryId}/restore/{revisionId}",
    operationId: "restoreEntryRevision",
    tag: "Journal",
    summary: "Restore an entry revision as a new version",
    params: c.RevisionParamsSchema,
    status: 200,
    response: c.RestoreRevisionResponseSchema,
    versioned: true,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/comments",
    operationId: "listComments",
    tag: "Comments",
    summary: "List comments for a journal entry or itinerary item",
    query: c.CommentTargetQuerySchema,
    response: c.CommentPageSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/comments",
    operationId: "createComment",
    tag: "Comments",
    summary: "Create a comment or reply",
    body: c.CreateCommentRequestSchema,
    response: c.CommentSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/comments/{commentId}",
    operationId: "updateComment",
    tag: "Comments",
    summary: "Edit a comment",
    params: c.CommentParamsSchema,
    body: c.UpdateCommentRequestSchema,
    response: c.CommentSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/comments/{commentId}",
    operationId: "deleteComment",
    tag: "Comments",
    summary: "Soft-delete a comment",
    params: c.CommentParamsSchema,
    status: 200,
    response: c.DeleteCommentResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/comments/{commentId}/resolve",
    operationId: "resolveComment",
    tag: "Comments",
    summary: "Resolve a comment thread",
    params: c.CommentParamsSchema,
    status: 200,
    response: c.CommentSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/comments/{commentId}/unresolve",
    operationId: "unresolveComment",
    tag: "Comments",
    summary: "Reopen a comment thread",
    params: c.CommentParamsSchema,
    status: 200,
    response: c.CommentSchema,
  });
}
