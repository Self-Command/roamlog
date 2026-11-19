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
  UpdateWorkspaceRequestSchema,
  WorkspaceActivityPageSchema,
  WorkspaceListResponseSchema,
  WorkspaceMemberPageSchema,
  WorkspaceMemberSchema,
  WorkspaceMemberWithUserSchema,
  WorkspaceSchema,
} from "@roamlog/contracts";

import {
  acceptInvitation as acceptInvitationRequest,
  createComment as createCommentRequest,
  createEntry as createEntryRequest,
  createTrip as createTripRequest,
  favoriteEntry as favoriteEntryRequest,
  getEntry as getEntryRequest,
  getMe as getMeRequest,
  getTrip as getTripRequest,
  inviteWorkspaceMember as inviteWorkspaceMemberRequest,
  listComments as listCommentsRequest,
  listExpenses as listExpensesRequest,
  listItinerary as listItineraryRequest,
  listMyNotifications as listMyNotificationsRequest,
  listMyWorkspaces as listMyWorkspacesRequest,
  listPacking as listPackingRequest,
  listStops as listStopsRequest,
  listTripEntries as listTripEntriesRequest,
  listTrips as listTripsRequest,
  listWorkspaceActivity as listWorkspaceActivityRequest,
  listWorkspaceEntries as listWorkspaceEntriesRequest,
  listWorkspaceInvitations as listWorkspaceInvitationsRequest,
  listWorkspaceMembers as listWorkspaceMembersRequest,
  markAllNotificationsRead as markAllNotificationsReadRequest,
  markNotificationRead as markNotificationReadRequest,
  getNotificationPreferences as getNotificationPreferencesRequest,
  removeWorkspaceMember as removeWorkspaceMemberRequest,
  revokeWorkspaceInvitation as revokeWorkspaceInvitationRequest,
  searchWorkspace as searchWorkspaceRequest,
  updateComment as updateCommentRequest,
  updateEntry as updateEntryRequest,
  updateItineraryItem as updateItineraryItemRequest,
  updateMe as updateMeRequest,
  updateNotificationPreferences as updateNotificationPreferencesRequest,
  updateTrip as updateTripRequest,
  updateWorkspace as updateWorkspaceRequest,
  updateWorkspaceMember as updateWorkspaceMemberRequest,
} from "@roamlog/api-client";

import { ApiError, errorFromResponse } from "./errors";
import { invalidResponse } from "./errors";
import { unwrap, unwrapMessage } from "./shared";
import type { DataAdapter, SessionInfo } from "./types";

function queryParams<T extends object>(params: T | undefined): Record<string, unknown> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  );
}

async function session(signal?: AbortSignal): Promise<SessionInfo | null> {
  const response = await fetch("/v1/auth/get-session", {
    signal,
    credentials: "include",
    headers: { accept: "application/json" },
  });

  if (response.status === 401) return null;
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, "Session response was not JSON.", "INVALID_JSON");
    }
  }
  if (!response.ok) throw errorFromResponse(response.status, body, "/v1/auth/get-session");
  if (body === null) return null;
  if (typeof body !== "object") {
    throw invalidResponse("/v1/auth/get-session");
  }

  const container = body as {
    user?: Record<string, unknown>;
    session?: Record<string, unknown>;
  };
  const user = container.user;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") {
    return null;
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: typeof user.name === "string" ? user.name : user.email,
      emailVerified: user.emailVerified === true,
    },
    session: container.session
      ? {
          id: typeof container.session.id === "string" ? container.session.id : undefined,
          expiresAt:
            typeof container.session.expiresAt === "string"
              ? container.session.expiresAt
              : undefined,
        }
      : undefined,
  };
}

const realAdapter = {
  async fetchMe(signal) {
    return unwrap(await getMeRequest({ signal }), MeResponseSchema, "/v1/me");
  },

  fetchSession: session,

  async fetchMyWorkspaces(signal) {
    return unwrap(
      await listMyWorkspacesRequest({ signal }),
      WorkspaceListResponseSchema,
      "/v1/me/workspaces",
    );
  },

  async fetchWorkspaces(signal) {
    return this.fetchMyWorkspaces(signal);
  },

  async fetchWorkspace(workspaceId, signal) {
    const workspaces = await this.fetchMyWorkspaces(signal);
    const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new ApiError(404, "Workspace not found.", "NOT_FOUND");
    return workspace;
  },

  async updateWorkspace(workspaceId, input, signal) {
    const validated = UpdateWorkspaceRequestSchema.parse(input);
    const current = await this.fetchWorkspace(workspaceId, signal);
    const result = unwrap(
      await updateWorkspaceRequest(workspaceId, validated, { signal }),
      WorkspaceSchema,
      `/v1/workspaces/${workspaceId}`,
    );
    return { ...result, role: current.role } as typeof current;
  },

  async updateMe(input, signal) {
    return unwrap(await updateMeRequest(input, { signal }), MeResponseSchema, "/v1/me");
  },

  async fetchTrips(workspaceId, params = {}, signal) {
    return unwrap(
      await listTripsRequest(workspaceId, params as Record<string, never>, { signal }),
      TripPageSchema,
      `/v1/workspaces/${workspaceId}/trips`,
    );
  },

  async fetchTrip(tripId, signal) {
    return unwrap(await getTripRequest(tripId, { signal }), TripSchema, `/v1/trips/${tripId}`);
  },

  async fetchStops(tripId, signal) {
    return unwrap(
      await listStopsRequest(tripId, { signal }),
      StopListResponseSchema,
      `/v1/trips/${tripId}/stops`,
    );
  },

  async fetchExpenses(tripId, params = {}, signal) {
    return unwrap(
      await listExpensesRequest(tripId, params as Record<string, never>, { signal }),
      ExpensePageSchema,
      `/v1/trips/${tripId}/expenses`,
    );
  },

  async createTrip(workspaceId, input, signal) {
    return unwrap(
      await createTripRequest(workspaceId, input, { signal }),
      TripSchema,
      `/v1/workspaces/${workspaceId}/trips`,
    );
  },

  async updateTrip(tripId, input, signal) {
    return unwrap(
      await updateTripRequest(tripId, input, { signal }),
      TripSchema,
      `/v1/trips/${tripId}`,
    );
  },

  async fetchEntries(workspaceId, params = {}, signal) {
    return unwrap(
      await listWorkspaceEntriesRequest(workspaceId, params as Record<string, never>, { signal }),
      EntryPageSchema,
      `/v1/workspaces/${workspaceId}/entries`,
    );
  },

  async fetchTripEntries(tripId, params = {}, signal) {
    return unwrap(
      await listTripEntriesRequest(tripId, params as Record<string, never>, { signal }),
      EntryPageSchema,
      `/v1/trips/${tripId}/entries`,
    );
  },

  async fetchEntry(entryId, signal) {
    return unwrap(
      await getEntryRequest(entryId, { signal }),
      JournalEntrySchema,
      `/v1/entries/${entryId}`,
    );
  },

  async createEntry(tripId, input, signal) {
    return unwrap(
      await createEntryRequest(tripId, input, { signal }),
      JournalEntrySchema,
      `/v1/trips/${tripId}/entries`,
    );
  },

  async updateEntry(entryId, input, signal) {
    return unwrap(
      await updateEntryRequest(entryId, input, { signal }),
      JournalEntrySchema,
      `/v1/entries/${entryId}`,
    );
  },

  async favoriteEntry(entryId, favorite, signal) {
    return unwrap(
      await favoriteEntryRequest(entryId, { favorite }, { signal }),
      JournalEntrySchema,
      `/v1/entries/${entryId}/favorite`,
    );
  },

  async fetchItinerary(tripId, signal) {
    return unwrap(
      await listItineraryRequest(tripId, { signal }),
      ItineraryListResponseSchema,
      `/v1/trips/${tripId}/itinerary`,
    );
  },

  async updateItineraryItem(itemId, input, signal) {
    return unwrap(
      await updateItineraryItemRequest(itemId, input, { signal }),
      ItineraryItemSchema,
      `/v1/itinerary/${itemId}`,
    );
  },

  async fetchComments(params, signal) {
    return unwrap(
      await listCommentsRequest(
        {
          targetType: params.targetType,
          targetId: params.targetId,
          ...(params.cursor ? { cursor: params.cursor } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
          ...(params.sort ? { sort: params.sort } : {}),
        },
        { signal },
      ),
      CommentPageSchema,
      "/v1/comments",
    );
  },

  async createComment(input, signal) {
    return unwrap(
      await createCommentRequest(input, { signal }),
      CommentSchema,
      "/v1/comments",
    );
  },

  async fetchNotifications(params = {}, signal) {
    return unwrap(
      await listMyNotificationsRequest(params as Record<string, never>, { signal }),
      NotificationPageSchema,
      "/v1/me/notifications",
    );
  },

  async markNotificationRead(id, signal) {
    return unwrap(
      await markNotificationReadRequest(id, { signal }),
      NotificationSchema,
      `/v1/me/notifications/${id}/read`,
    );
  },

  async markAllNotificationsRead(signal) {
    return unwrap(
      await markAllNotificationsReadRequest({ signal }),
      ReadAllNotificationsResponseSchema,
      "/v1/me/notifications/read-all",
    );
  },

  async fetchNotificationPreferences(signal) {
    return unwrap(
      await getNotificationPreferencesRequest({ signal }),
      NotificationPreferencesResponseSchema,
      "/v1/me/notification-preferences",
    );
  },

  async updateNotificationPreferences(preferences, signal) {
    return unwrap(
      await updateNotificationPreferencesRequest(
        { preferences: preferences.map(({ type, inApp, email }) => ({ type, inApp, email })) },
        { signal },
      ),
      NotificationPreferencesResponseSchema,
      "/v1/me/notification-preferences",
    );
  },

  async fetchActivity(workspaceId, params = {}, signal) {
    return unwrap(
      await listWorkspaceActivityRequest(
        workspaceId,
        params as Record<string, never>,
        { signal },
      ),
      WorkspaceActivityPageSchema,
      `/v1/workspaces/${workspaceId}/activity`,
    );
  },

  async searchWorkspace(workspaceId, params, signal) {
    return unwrap(
      await searchWorkspaceRequest(
        workspaceId,
        {
          q: params.q,
          ...(params.type ? { type: params.type } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
        },
        { signal },
      ),
      SearchResponseSchema,
      `/v1/workspaces/${workspaceId}/search`,
    );
  },

  async fetchMembers(workspaceId, params = {}, signal) {
    return unwrap(
      await listWorkspaceMembersRequest(
        workspaceId,
        queryParams(params) as Record<string, never>,
        { signal },
      ),
      WorkspaceMemberPageSchema,
      `/v1/workspaces/${workspaceId}/members`,
    );
  },

  async updateMember(workspaceId, memberId, input, signal) {
    return unwrap(
      await updateWorkspaceMemberRequest(workspaceId, memberId, input, { signal }),
      WorkspaceMemberWithUserSchema,
      `/v1/workspaces/${workspaceId}/members/${memberId}`,
    );
  },

  async removeMember(workspaceId, memberId, signal) {
    return unwrap(
      await removeWorkspaceMemberRequest(workspaceId, memberId, { signal }),
      MessageResponseSchema,
      `/v1/workspaces/${workspaceId}/members/${memberId}`,
    );
  },

  async fetchInvitations(workspaceId, params = {}, signal) {
    return unwrap(
      await listWorkspaceInvitationsRequest(
        workspaceId,
        queryParams(params) as Record<string, never>,
        { signal },
      ),
      InvitationPageSchema,
      `/v1/workspaces/${workspaceId}/invitations`,
    );
  },

  async inviteMember(workspaceId, input, signal) {
    return unwrap(
      await inviteWorkspaceMemberRequest(workspaceId, input, { signal }),
      InvitationSchema,
      `/v1/workspaces/${workspaceId}/invitations`,
    );
  },

  async revokeInvitation(workspaceId, invitationId, signal) {
    return unwrap(
      await revokeWorkspaceInvitationRequest(workspaceId, invitationId, { signal }),
      MessageResponseSchema,
      `/v1/workspaces/${workspaceId}/invitations/${invitationId}`,
    );
  },

  async acceptInvitation(token, signal) {
    return unwrap(
      await acceptInvitationRequest(token, {}, { signal }),
      WorkspaceMemberSchema,
      `/v1/invitations/${token}/accept`,
    );
  },
} satisfies DataAdapter;

export const realAdapterInstance: DataAdapter = realAdapter;

// Keep these imports referenced for future adapter endpoints that are
// intentionally not wired in this wave.
void listPackingRequest;
void updateCommentRequest;
void unwrapMessage;
