"use client";

import type {
  CommentTargetType,
  CreateCommentRequest,
  CreateJournalEntryRequest,
  CreateTripRequest,
  UpdateItineraryItemRequest,
  UpdateJournalEntryRequest,
  UpdateMeRequest,
  UpdateMemberRequest,
  UpdateTripRequest,
  UpdateWorkspaceRequest,
  WorkspaceMemberWithUser,
  WorkspaceWithRole,
} from "@roamlog/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { isApiError } from "@/lib/api";
import { useDataAdapter } from "@/lib/data-provider";

import type {
  ActivityListParams,
  CommentListParams,
  EntryListParams,
  InvitationInput,
  MemberListParams,
  NotificationListParams,
  SearchParams,
  TripListParams,
} from "@/lib/api";

const defaultQueryOptions = {
  staleTime: 30_000,
  retry: (failureCount: number, error: unknown) => {
    if (isApiError(error) && [400, 401, 403, 404, 409, 422].includes(error.status)) return false;
    return failureCount < 1;
  },
};

export const queryKeys = {
  me: ["v1", "me"] as const,
  session: ["v1", "auth", "session"] as const,
  workspaces: ["v1", "workspaces"] as const,
  trips: (workspaceId: string | undefined, params?: TripListParams) =>
    ["v1", "trips", workspaceId, params ?? null] as const,
  trip: (tripId: string | undefined) => ["v1", "trip", tripId] as const,
  itinerary: (tripId: string | undefined) => ["v1", "itinerary", tripId] as const,
  entries: (workspaceId: string | undefined, params?: EntryListParams) =>
    ["v1", "entries", workspaceId, params ?? null] as const,
  tripEntries: (tripId: string | undefined, params?: EntryListParams) =>
    ["v1", "trip-entries", tripId, params ?? null] as const,
  comments: (params: CommentListParams | undefined) =>
    ["v1", "comments", params ?? null] as const,
  notifications: (params?: NotificationListParams) =>
    ["v1", "notifications", params ?? null] as const,
  notificationPreferences: ["v1", "notification-preferences"] as const,
  activity: (workspaceId: string | undefined, params?: ActivityListParams) =>
    ["v1", "activity", workspaceId, params ?? null] as const,
  members: (workspaceId: string | undefined, params?: MemberListParams) =>
    ["v1", "members", workspaceId, params ?? null] as const,
  invitations: (workspaceId: string | undefined, params?: MemberListParams) =>
    ["v1", "invitations", workspaceId, params ?? null] as const,
  search: (workspaceId: string | undefined, params: SearchParams | undefined) =>
    ["v1", "search", workspaceId, params ?? null] as const,
};

export function useSessionQuery() {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => adapter.fetchSession(signal),
    ...defaultQueryOptions,
  });
}

export function useMeQuery() {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => adapter.fetchMe(signal),
    ...defaultQueryOptions,
  });
}

export function useWorkspacesQuery() {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: ({ signal }) => adapter.fetchMyWorkspaces(signal),
    ...defaultQueryOptions,
  });
}

export function useWorkspaceBySlug(slug: string): {
  workspace: WorkspaceWithRole | undefined;
  workspacesQuery: ReturnType<typeof useWorkspacesQuery>;
} {
  const workspacesQuery = useWorkspacesQuery();
  return {
    workspace: workspacesQuery.data?.find((workspace) => workspace.slug === slug),
    workspacesQuery,
  };
}

export function useTripsQuery(workspaceId: string | undefined, params?: TripListParams) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.trips(workspaceId, params),
    queryFn: ({ signal }) => {
      if (!workspaceId) {
        throw new Error("A workspace is required before loading trips.");
      }
      return adapter.fetchTrips(workspaceId, params, signal);
    },
    enabled: Boolean(workspaceId),
    ...defaultQueryOptions,
  });
}

export function useTripQuery(tripId: string | undefined) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.trip(tripId),
    queryFn: ({ signal }) => {
      if (!tripId) {
        throw new Error("A trip id is required.");
      }
      return adapter.fetchTrip(tripId, signal);
    },
    enabled: Boolean(tripId),
    ...defaultQueryOptions,
  });
}

export function useItineraryQuery(tripId: string | undefined) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.itinerary(tripId),
    queryFn: ({ signal }) => {
      if (!tripId) {
        throw new Error("A trip id is required.");
      }
      return adapter.fetchItinerary(tripId, signal);
    },
    enabled: Boolean(tripId),
    ...defaultQueryOptions,
  });
}

export function useEntriesQuery(workspaceId: string | undefined, params?: EntryListParams) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.entries(workspaceId, params),
    queryFn: ({ signal }) => {
      if (!workspaceId) throw new Error("A workspace is required before loading entries.");
      return adapter.fetchEntries(workspaceId, params, signal);
    },
    enabled: Boolean(workspaceId),
    ...defaultQueryOptions,
  });
}

export function useTripEntriesQuery(tripId: string | undefined, params?: EntryListParams) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.tripEntries(tripId, params),
    queryFn: ({ signal }) => {
      if (!tripId) throw new Error("A trip id is required.");
      return adapter.fetchTripEntries(tripId, params, signal);
    },
    enabled: Boolean(tripId),
    ...defaultQueryOptions,
  });
}

export function useCommentsQuery(
  targetType: CommentTargetType | undefined,
  targetId: string | undefined,
) {
  const adapter = useDataAdapter();
  const params = useMemo<CommentListParams | undefined>(
    () =>
      targetType && targetId
        ? { targetType, targetId, limit: 100, sort: "createdAt:asc" }
        : undefined,
    [targetId, targetType],
  );

  return useQuery({
    queryKey: queryKeys.comments(params),
    queryFn: ({ signal }) => {
      if (!params) throw new Error("A comment target is required.");
      return adapter.fetchComments(params, signal);
    },
    enabled: Boolean(params),
    ...defaultQueryOptions,
  });
}

export function useNotificationsQuery(params?: NotificationListParams) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.notifications(params),
    queryFn: ({ signal }) => adapter.fetchNotifications(params, signal),
    ...defaultQueryOptions,
  });
}

export function useNotificationPreferencesQuery() {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: ({ signal }) => adapter.fetchNotificationPreferences(signal),
    ...defaultQueryOptions,
  });
}

export function useActivityQuery(workspaceId: string | undefined, params?: ActivityListParams) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.activity(workspaceId, params),
    queryFn: ({ signal }) => {
      if (!workspaceId) throw new Error("A workspace is required before loading activity.");
      return adapter.fetchActivity(workspaceId, params, signal);
    },
    enabled: Boolean(workspaceId),
    ...defaultQueryOptions,
  });
}

export function useMembersQuery(workspaceId: string | undefined, params?: MemberListParams) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.members(workspaceId, params),
    queryFn: ({ signal }) => {
      if (!workspaceId) throw new Error("A workspace is required before loading members.");
      return adapter.fetchMembers(workspaceId, params, signal);
    },
    enabled: Boolean(workspaceId),
    ...defaultQueryOptions,
  });
}

export function useInvitationsQuery(workspaceId: string | undefined, params?: MemberListParams) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.invitations(workspaceId, params),
    queryFn: ({ signal }) => {
      if (!workspaceId) throw new Error("A workspace is required before loading invitations.");
      return adapter.fetchInvitations(workspaceId, params, signal);
    },
    enabled: Boolean(workspaceId),
    ...defaultQueryOptions,
  });
}

export function useSearchQuery(
  workspaceId: string | undefined,
  params: SearchParams | undefined,
  enabled = true,
) {
  const adapter = useDataAdapter();

  return useQuery({
    queryKey: queryKeys.search(workspaceId, params),
    queryFn: ({ signal }) => {
      if (!workspaceId || !params?.q.trim()) throw new Error("A search query is required.");
      return adapter.searchWorkspace(workspaceId, params, signal);
    },
    enabled: Boolean(workspaceId && params?.q.trim() && enabled),
    ...defaultQueryOptions,
  });
}

export function useUpdateTripMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tripId, input }: { tripId: string; input: UpdateTripRequest }) =>
      adapter.updateTrip(tripId, input),
    onSuccess: (trip) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trip(trip.id) });
      void queryClient.invalidateQueries({ queryKey: ["v1", "trips"] });
    },
  });
}

export function useCreateTripMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, input }: { workspaceId: string; input: CreateTripRequest }) =>
      adapter.createTrip(workspaceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["v1", "trips"] });
    },
  });
}

export function useUpdateItineraryItemMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: UpdateItineraryItemRequest }) =>
      adapter.updateItineraryItem(itemId, input),
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.itinerary(item.tripId) });
    },
  });
}

export function useCreateEntryMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tripId, input }: { tripId: string; input: CreateJournalEntryRequest }) =>
      adapter.createEntry(tripId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["v1", "trip-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["v1", "entries"] });
    },
  });
}

export function useUpdateEntryMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entryId, input }: { entryId: string; input: UpdateJournalEntryRequest }) =>
      adapter.updateEntry(entryId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["v1", "trip-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["v1", "entries"] });
    },
  });
}

export function useFavoriteEntryMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entryId, favorite }: { entryId: string; favorite: boolean }) =>
      adapter.favoriteEntry(entryId, favorite),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["v1", "trip-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["v1", "entries"] });
    },
  });
}

export function useCreateCommentMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCommentRequest) => adapter.createComment(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["v1", "comments"] });
      void queryClient.invalidateQueries({ queryKey: ["v1", "trip-entries"] });
    },
  });
}

export function useMarkNotificationReadMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adapter.markNotificationRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["v1", "notifications"] });
    },
  });
}

export function useMarkAllNotificationsReadMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => adapter.markAllNotificationsRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["v1", "notifications"] });
    },
  });
}

export function useUpdateNotificationPreferencesMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (preferences: Parameters<typeof adapter.updateNotificationPreferences>[0]) =>
      adapter.updateNotificationPreferences(preferences),
    onSuccess: (preferences) => {
      queryClient.setQueryData(queryKeys.notificationPreferences, preferences);
    },
  });
}

export function useUpdateMemberMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      member,
      input,
    }: {
      workspaceId: string;
      member: WorkspaceMemberWithUser;
      input: UpdateMemberRequest;
    }) => adapter.updateMember(workspaceId, member.id, input),
    onSuccess: (member) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(member.workspaceId) });
    },
  });
}

export function useRemoveMemberMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, memberId }: { workspaceId: string; memberId: string }) =>
      adapter.removeMember(workspaceId, memberId),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(variables.workspaceId) });
    },
  });
}

export function useInviteMemberMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, input }: { workspaceId: string; input: InvitationInput }) =>
      adapter.inviteMember(workspaceId, input),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.invitations(variables.workspaceId),
      });
    },
  });
}

export function useRevokeInvitationMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, invitationId }: { workspaceId: string; invitationId: string }) =>
      adapter.revokeInvitation(workspaceId, invitationId),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.invitations(variables.workspaceId),
      });
    },
  });
}

export function useUpdateMeMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateMeRequest) => adapter.updateMe(input),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
    },
  });
}

export function useUpdateWorkspaceMutation() {
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      input,
    }: {
      workspaceId: string;
      input: UpdateWorkspaceRequest;
    }) => adapter.updateWorkspace(workspaceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}
