"use client";

import { useListWorkspaceMedia } from "@roamlog/api-client";
import type { Media, MediaPage, Stop } from "@roamlog/contracts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { useDataAdapter } from "@/lib/data-provider";
import { useTripsQuery, useWorkspaceBySlug } from "@/lib/query";

import { photosFromMedia, type PhotoPoint } from "./photo-points";

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

  /**
   * Photo coordinates for the map's photo layer.
   *
   * This is the workspace media list the API already exposes
   * (`GET /v1/workspaces/{id}/media`, the same endpoint the contract's
   * `MediaListQuerySchema` documents) — no endpoint was added for the map. Only
   * rows whose `lat`/`lng` pair is present become photo locations; the media
   * presenter already lifts those two fields out of EXIF.
   *
   * It deliberately does NOT feed `isLoading`: a media read that is slow or
   * forbidden must never hold the footprint map behind a skeleton.
   */
  const mediaQuery = useListWorkspaceMedia(
    workspace?.id ?? "",
    { limit: 100, sort: "createdAt:desc" },
    { query: { enabled: Boolean(workspace?.id), staleTime: 30_000, retry: 1 } },
  );
  const mediaItems: Media[] = useMemo(() => {
    const envelope = mediaQuery.data;
    if (!envelope || envelope.status >= 400) return [];
    return ((envelope.data as MediaPage | undefined)?.items ?? []) as Media[];
  }, [mediaQuery.data]);
  const photos: PhotoPoint[] = useMemo(() => photosFromMedia(mediaItems), [mediaItems]);

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
    /** Photos carrying GPS, ready for the map's photo layer. */
    photos,
    isLoading,
    error,
    retry,
  };
}