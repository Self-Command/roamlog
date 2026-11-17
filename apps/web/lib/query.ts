"use client";

import type { WorkspaceWithRole } from "@roamlog/contracts";
import { useQuery } from "@tanstack/react-query";

import { fetchItinerary, fetchMe, fetchTrip, fetchTrips, fetchWorkspaces } from "@/lib/api";

const defaultQueryOptions = {
  staleTime: 30_000,
  retry: 1,
};

export const queryKeys = {
  me: ["v1", "me"] as const,
  workspaces: ["v1", "workspaces"] as const,
  trips: (workspaceId: string | undefined) => ["v1", "trips", workspaceId] as const,
  trip: (tripId: string | undefined) => ["v1", "trip", tripId] as const,
  itinerary: (tripId: string | undefined) => ["v1", "itinerary", tripId] as const,
};

export function useMeQuery() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    ...defaultQueryOptions,
  });
}

export function useWorkspacesQuery() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: ({ signal }) => fetchWorkspaces(signal),
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

export function useTripsQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.trips(workspaceId),
    queryFn: ({ signal }) => {
      if (!workspaceId) {
        throw new Error("A workspace is required before loading trips.");
      }
      return fetchTrips(workspaceId, signal);
    },
    enabled: Boolean(workspaceId),
    ...defaultQueryOptions,
  });
}

export function useTripQuery(tripId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.trip(tripId),
    queryFn: ({ signal }) => {
      if (!tripId) {
        throw new Error("A trip id is required.");
      }
      return fetchTrip(tripId, signal);
    },
    enabled: Boolean(tripId),
    ...defaultQueryOptions,
  });
}

export function useItineraryQuery(tripId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.itinerary(tripId),
    queryFn: ({ signal }) => {
      if (!tripId) {
        throw new Error("A trip id is required.");
      }
      return fetchItinerary(tripId, signal);
    },
    enabled: Boolean(tripId),
    ...defaultQueryOptions,
  });
}
