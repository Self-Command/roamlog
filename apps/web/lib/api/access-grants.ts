"use client";

import {
  getGetMeQueryKey,
  getListTripAccessGrantsQueryKey,
  getListWorkspaceMembersQueryKey,
  getListWorkspacesQueryKey,
  getMe,
  listTripAccessGrants,
  listWorkspaceMembers,
  listWorkspaces,
  setTripAccessGrants,
  updateTripParticipant,
} from "@roamlog/api-client";
import {
  SetTripAccessGrantsRequestSchema,
  TripAccessGrantsResponseSchema,
  TripParticipantSchema,
  UserSchema,
  WorkspaceListResponseSchema,
  WorkspaceMemberPageSchema,
  type SetTripAccessGrantsRequest,
  type TripAccessGrantsResponse,
  type TripParticipant,
  type ParticipantRole,
  type User,
  type WorkspaceMemberWithUser,
  type WorkspaceWithRole,
} from "@roamlog/contracts";
import { useQuery } from "@tanstack/react-query";

import { unwrap } from "./shared";

const ACCESS_GRANTS_STALE_TIME = 15_000;

/**
 * Loads the resolved audience of a `custom` trip. `resolved` is the server's
 * display half (workspace name / member name + email domain), so the form never
 * performs one lookup per grant.
 */
export async function fetchTripAccessGrants(
  tripId: string,
  signal?: AbortSignal,
): Promise<TripAccessGrantsResponse> {
  const result = await listTripAccessGrants(tripId, { signal });
  return unwrap(result, TripAccessGrantsResponseSchema, `/v1/trips/${tripId}/access-grants`);
}

export function useTripAccessGrantsQuery(tripId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: getListTripAccessGrantsQueryKey(tripId ?? "unknown"),
    queryFn: ({ signal }) => {
      if (!tripId) throw new Error("tripId is required");
      return fetchTripAccessGrants(tripId, signal);
    },
    enabled: Boolean(enabled && tripId),
    staleTime: 0,
  });
}

/** `PUT` is a full replacement: both arrays are always present, even when empty. */
export async function replaceTripAccessGrants(
  tripId: string,
  input: SetTripAccessGrantsRequest,
): Promise<TripAccessGrantsResponse> {
  const validated = SetTripAccessGrantsRequestSchema.parse(input);
  const result = await setTripAccessGrants(tripId, validated);
  return unwrap(result, TripAccessGrantsResponseSchema, `/v1/trips/${tripId}/access-grants`);
}

export interface AccessGrantContext {
  workspaces: WorkspaceWithRole[];
  members: WorkspaceMemberWithUser[];
  me: User | null;
}

/**
 * Workspace and member options for the visibility picker.
 *
 * `includeMe` is false in create mode because creating a trip already proves
 * the actor may use the form; only edit mode needs the current user id to check
 * whether they are the trip creator.
 */
export function useAccessGrantContext(
  workspaceId: string,
  enabled: boolean,
  includeMe: boolean,
) {
  const workspaces = useQuery({
    queryKey: getListWorkspacesQueryKey(),
    queryFn: async ({ signal }) =>
      unwrap(await listWorkspaces({ signal }), WorkspaceListResponseSchema, "/v1/workspaces"),
    enabled,
    staleTime: ACCESS_GRANTS_STALE_TIME,
  });

  const members = useQuery({
    queryKey: getListWorkspaceMembersQueryKey(workspaceId),
    queryFn: async ({ signal }) =>
      unwrap(
        await listWorkspaceMembers(workspaceId, undefined, { signal }),
        WorkspaceMemberPageSchema,
        `/v1/workspaces/${workspaceId}/members`,
      ),
    enabled,
    staleTime: ACCESS_GRANTS_STALE_TIME,
  });

  const me = useQuery({
    queryKey: getGetMeQueryKey(),
    queryFn: async ({ signal }) => unwrap(await getMe({ signal }), UserSchema, "/v1/me"),
    enabled: enabled && includeMe,
    staleTime: ACCESS_GRANTS_STALE_TIME,
  });

  const isPending =
    workspaces.isPending || members.isPending || (includeMe && me.isPending);
  const error = workspaces.error ?? members.error ?? (includeMe ? me.error : null);

  const data: AccessGrantContext | undefined =
    workspaces.data && members.data && (!includeMe || me.data)
      ? {
          workspaces: workspaces.data,
          members: members.data.items.filter((member) => member.status === "active"),
          me: me.data ?? null,
        }
      : undefined;

  return {
    data,
    isPending,
    isError: Boolean(error),
    error,
    retry: () => {
      void workspaces.refetch();
      void members.refetch();
      if (includeMe) void me.refetch();
    },
  };
}

/** Change one participant's trip-scoped role. */
export async function changeTripParticipantRole(
  tripId: string,
  userId: string,
  role: ParticipantRole,
): Promise<TripParticipant> {
  const result = await updateTripParticipant(tripId, userId, { role });
  return unwrap(result, TripParticipantSchema, `/v1/trips/${tripId}/participants/${userId}`);
}
