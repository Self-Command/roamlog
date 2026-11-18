"use client";

import type { Stop } from "@roamlog/contracts";
import { useQueries } from "@tanstack/react-query";

import { useDataAdapter } from "@/lib/data-provider";
import { useTripsQuery, useWorkspaceBySlug } from "@/lib/query";

export function useAtlasData(workspaceSlug: string) {
  const adapter = useDataAdapter();
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripsQuery = useTripsQuery(workspace?.id, { limit: 100 });
  const trips = tripsQuery.data?.items ?? [];

  const stopQueries = useQueries({
    queries: trips.map((trip) => ({
      queryKey: ["v1", "atlas", "stops", trip.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => adapter.fetchStops(trip.id, signal),
      staleTime: 30_000,
      retry: 1,
    })),
  });

  const stopsByTrip = new Map<string, Stop[]>();
  trips.forEach((trip, index) => {
    stopsByTrip.set(trip.id, stopQueries[index]?.data ?? []);
  });

  const isLoading =
    workspacesQuery.isLoading ||
    tripsQuery.isLoading ||
    stopQueries.some((query) => query.isPending);
  const error =
    (workspacesQuery.error as Error | null) ??
    (tripsQuery.error as Error | null) ??
    ((stopQueries.find((query) => query.error)?.error as Error | undefined) ?? null);

  function retry() {
    void workspacesQuery.refetch();
    void tripsQuery.refetch();
    for (const query of stopQueries) void query.refetch();
  }

  return {
    workspace,
    workspacesQuery,
    tripsQuery,
    trips,
    tripsTruncated: tripsQuery.data?.hasMore ?? false,
    stopsByTrip,
    allStops: trips.flatMap((trip) => stopsByTrip.get(trip.id) ?? []),
    isLoading,
    error,
    retry,
  };
}