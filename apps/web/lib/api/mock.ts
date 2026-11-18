import {
  CommentPageSchema,
  CommentSchema,
  EntryPageSchema,
  ExpensePageSchema,
  InvitationPageSchema,
  InvitationSchema,
  ItineraryItemSchema,
  ItineraryListResponseSchema,
  JournalEntrySchema,
  MeResponseSchema,
  MessageResponseSchema,
  NotificationPageSchema,
  NotificationPreferencesResponseSchema,
  NotificationSchema,
  ReadAllNotificationsResponseSchema,
  SearchResponseSchema,
  StopListResponseSchema,
  TripPageSchema,
  TripSchema,
  UserSchema,
  WorkspaceActivityPageSchema,
  WorkspaceListResponseSchema,
  WorkspaceMemberPageSchema,
  WorkspaceMemberWithUserSchema,
  WorkspaceWithRoleSchema,
  type Activity,
  type MessageResponse,
  type SearchResponse,
  type WorkspaceMemberWithUser,
} from "@roamlog/contracts";

import type { DataMode } from "@/lib/data-mode";

import { ApiError, errorFromResponse, invalidResponse } from "./errors";
import type { DataAdapter, SessionInfo } from "./types";

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: unknown = null;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new ApiError(response.status, "API returned a non-JSON error response.", "INVALID_JSON");
      }
      throw new ApiError(response.status, "API returned a non-JSON response.", "INVALID_JSON");
    }
  }

  if (!response.ok) {
    throw errorFromResponse(response.status, body, path);
  }

  return body;
}

function parse<T>(
  body: unknown,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } },
  path: string,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw invalidResponse(path, result.error.issues[0]?.message);
  }
  return result.data;
}

function jsonBody(input: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(input) };
}

function pathWithQuery(path: string, params: Record<string, unknown> | undefined): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

const mockAdapter = {
  mode: "mock" as DataMode,

  async fetchMe(signal) {
    return parse(await requestJson("/v1/me", { signal }), MeResponseSchema, "/v1/me");
  },

  async fetchSession(signal) {
    const user = await this.fetchMe(signal);
    const session: SessionInfo = { user };
    return session;
  },

  async fetchMyWorkspaces(signal) {
    return parse(
      await requestJson("/v1/me/workspaces", { signal }),
      WorkspaceListResponseSchema,
      "/v1/me/workspaces",
    );
  },

  async fetchWorkspaces(signal) {
    return parse(
      await requestJson("/v1/workspaces", { signal }),
      WorkspaceListResponseSchema,
      "/v1/workspaces",
    );
  },

  async fetchWorkspace(workspaceId, signal) {
    const workspaces = await this.fetchWorkspaces(signal);
    const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new ApiError(404, "Workspace not found.", "NOT_FOUND");
    return workspace;
  },

  async updateWorkspace(workspaceId, input, signal) {
    return parse(
      await requestJson(`/v1/workspaces/${workspaceId}`, {
        ...jsonBody(input),
        method: "PATCH",
        signal,
      }),
      WorkspaceWithRoleSchema,
      `/v1/workspaces/${workspaceId}`,
    );
  },

  async updateMe(input, signal) {
    return parse(
      await requestJson("/v1/me", { ...jsonBody(input), method: "PATCH", signal }),
      UserSchema,
      "/v1/me",
    );
  },

  async fetchTrips(workspaceId, params, signal) {
    return parse(
      await requestJson(
        pathWithQuery(
          `/v1/workspaces/${encodeURIComponent(workspaceId)}/trips`,
          params as Record<string, unknown> | undefined,
        ),
        { signal },
      ),
      TripPageSchema,
      `/v1/workspaces/${workspaceId}/trips`,
    );
  },

  async fetchTrip(tripId, signal) {
    return parse(
      await requestJson(`/v1/trips/${encodeURIComponent(tripId)}`, { signal }),
      TripSchema,
      `/v1/trips/${tripId}`,
    );
  },

  async fetchStops(tripId, signal) {
    return parse(
      await requestJson(`/v1/trips/${encodeURIComponent(tripId)}/stops`, { signal }),
      StopListResponseSchema,
      `/v1/trips/${tripId}/stops`,
    );
  },

  async fetchExpenses(tripId, params, signal) {
    return parse(
      await requestJson(
        pathWithQuery(
          `/v1/trips/${encodeURIComponent(tripId)}/expenses`,
          params as Record<string, unknown> | undefined,
        ),
        { signal },
      ),
      ExpensePageSchema,
      `/v1/trips/${tripId}/expenses`,
    );
  },

  async createTrip(workspaceId, input, signal) {
    return parse(
      await requestJson(`/v1/workspaces/${workspaceId}/trips`, {
        ...jsonBody(input),
        signal,
      }),
      TripSchema,
      `/v1/workspaces/${workspaceId}/trips`,
    );
  },

  async updateTrip(tripId, input, signal) {
    return parse(
      await requestJson(`/v1/trips/${tripId}`, {
        ...jsonBody(input),
        method: "PATCH",
        signal,
      }),
      TripSchema,
      `/v1/trips/${tripId}`,
    );
  },

  async fetchEntries(workspaceId, params, signal) {
    return parse(
      await requestJson(
        pathWithQuery(
          `/v1/workspaces/${workspaceId}/entries`,
          params as Record<string, unknown> | undefined,
        ),
        { signal },
      ),
      EntryPageSchema,
      `/v1/workspaces/${workspaceId}/entries`,
    );
  },

  async fetchTripEntries(tripId, params, signal) {
    return parse(
      await requestJson(
        pathWithQuery(`/v1/trips/${tripId}/entries`, params as Record<string, unknown> | undefined),
        { signal },
      ),
      EntryPageSchema,
      `/v1/trips/${tripId}/entries`,
    );
  },

  async fetchEntry(entryId, signal) {
    return parse(
      await requestJson(`/v1/entries/${entryId}`, { signal }),
      JournalEntrySchema,
      `/v1/entries/${entryId}`,
    );
  },

  async createEntry(tripId, input, signal) {
    return parse(
      await requestJson(`/v1/trips/${tripId}/entries`, { ...jsonBody(input), signal }),
      JournalEntrySchema,
      `/v1/trips/${tripId}/entries`,
    );
  },

  async updateEntry(entryId, input, signal) {
    return parse(
      await requestJson(`/v1/entries/${entryId}`, {
        ...jsonBody(input),
        method: "PATCH",
        signal,
      }),
      JournalEntrySchema,
      `/v1/entries/${entryId}`,
    );
  },

  async favoriteEntry(entryId, favorite, signal) {
    return parse(
      await requestJson(`/v1/entries/${entryId}/favorite`, {
        ...jsonBody({ favorite }),
        signal,
      }),
      JournalEntrySchema,
      `/v1/entries/${entryId}/favorite`,
    );
  },

  async fetchItinerary(tripId, signal) {
    return parse(
      await requestJson(`/v1/trips/${tripId}/itinerary`, { signal }),
      ItineraryListResponseSchema,
      `/v1/trips/${tripId}/itinerary`,
    );
  },

  async updateItineraryItem(itemId, input, signal) {
    return parse(
      await requestJson(`/v1/itinerary/${itemId}`, {
        ...jsonBody(input),
        method: "PATCH",
        signal,
      }),
      ItineraryItemSchema,
      `/v1/itinerary/${itemId}`,
    );
  },

  async fetchComments(params, signal) {
    return parse(
      await requestJson(pathWithQuery("/v1/comments", params as unknown as Record<string, unknown>), {
        signal,
      }),
      CommentPageSchema,
      "/v1/comments",
    );
  },

  async createComment(input, signal) {
    return parse(
      await requestJson("/v1/comments", { ...jsonBody(input), signal }),
      CommentSchema,
      "/v1/comments",
    );
  },

  async fetchNotifications(params, signal) {
    return parse(
      await requestJson(
        pathWithQuery("/v1/me/notifications", params as Record<string, unknown> | undefined),
        { signal },
      ),
      NotificationPageSchema,
      "/v1/me/notifications",
    );
  },

  async markNotificationRead(id, signal) {
    return parse(
      await requestJson(`/v1/me/notifications/${id}/read`, {
        method: "PATCH",
        signal,
      }),
      NotificationSchema,
      `/v1/me/notifications/${id}/read`,
    );
  },

  async markAllNotificationsRead(signal) {
    return parse(
      await requestJson("/v1/me/notifications/read-all", { method: "POST", signal }),
      ReadAllNotificationsResponseSchema,
      "/v1/me/notifications/read-all",
    );
  },

  async fetchNotificationPreferences(signal) {
    return parse(
      await requestJson("/v1/me/notification-preferences", { signal }),
      NotificationPreferencesResponseSchema,
      "/v1/me/notification-preferences",
    );
  },

  async updateNotificationPreferences(preferences, signal) {
    return parse(
      await requestJson("/v1/me/notification-preferences", {
        ...jsonBody({
          preferences: preferences.map(({ type, inApp, email }) => ({ type, inApp, email })),
        }),
        method: "PATCH",
        signal,
      }),
      NotificationPreferencesResponseSchema,
      "/v1/me/notification-preferences",
    );
  },

  async fetchActivity(workspaceId, params, signal) {
    return parse(
      await requestJson(
        pathWithQuery(
          `/v1/workspaces/${workspaceId}/activity`,
          params as Record<string, unknown> | undefined,
        ),
        { signal },
      ),
      WorkspaceActivityPageSchema,
      `/v1/workspaces/${workspaceId}/activity`,
    ) as { items: Activity[]; nextCursor: string | null; hasMore: boolean };
  },

  async searchWorkspace(workspaceId, params, signal) {
    return parse(
      await requestJson(
        pathWithQuery(`/v1/workspaces/${workspaceId}/search`, params as unknown as Record<string, unknown>),
        { signal },
      ),
      SearchResponseSchema,
      `/v1/workspaces/${workspaceId}/search`,
    ) as SearchResponse;
  },

  async fetchMembers(workspaceId, params, signal) {
    return parse(
      await requestJson(
        pathWithQuery(
          `/v1/workspaces/${workspaceId}/members`,
          params as Record<string, unknown> | undefined,
        ),
        { signal },
      ),
      WorkspaceMemberPageSchema,
      `/v1/workspaces/${workspaceId}/members`,
    );
  },

  async updateMember(workspaceId, memberId, input, signal) {
    return parse(
      await requestJson(`/v1/workspaces/${workspaceId}/members/${memberId}`, {
        ...jsonBody(input),
        method: "PATCH",
        signal,
      }),
      WorkspaceMemberWithUserSchema,
      `/v1/workspaces/${workspaceId}/members/${memberId}`,
    );
  },

  async removeMember(workspaceId, memberId, signal) {
    return parse(
      await requestJson(`/v1/workspaces/${workspaceId}/members/${memberId}`, {
        method: "DELETE",
        signal,
      }),
      MessageResponseSchema,
      `/v1/workspaces/${workspaceId}/members/${memberId}`,
    ) as MessageResponse;
  },

  async fetchInvitations(workspaceId, params, signal) {
    return parse(
      await requestJson(
        pathWithQuery(
          `/v1/workspaces/${workspaceId}/invitations`,
          params as Record<string, unknown> | undefined,
        ),
        { signal },
      ),
      InvitationPageSchema,
      `/v1/workspaces/${workspaceId}/invitations`,
    );
  },

  async inviteMember(workspaceId, input, signal) {
    return parse(
      await requestJson(`/v1/workspaces/${workspaceId}/invitations`, {
        ...jsonBody(input),
        signal,
      }),
      InvitationSchema,
      `/v1/workspaces/${workspaceId}/invitations`,
    ) as { id: string };
  },

  async revokeInvitation(workspaceId, invitationId, signal) {
    return parse(
      await requestJson(`/v1/workspaces/${workspaceId}/invitations/${invitationId}`, {
        method: "DELETE",
        signal,
      }),
      MessageResponseSchema,
      `/v1/workspaces/${workspaceId}/invitations/${invitationId}`,
    ) as MessageResponse;
  },

  async acceptInvitation(token, signal) {
    return parse(
      await requestJson(`/v1/invitations/${token}/accept`, {
        method: "POST",
        body: JSON.stringify({}),
        signal,
      }),
      WorkspaceMemberWithUserSchema,
      `/v1/invitations/${token}/accept`,
    ) as WorkspaceMemberWithUser;
  },
} satisfies DataAdapter;

export const mockAdapterInstance: DataAdapter = mockAdapter;
