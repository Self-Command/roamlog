"use client";

import type { CreateTripRequest, Trip } from "@roamlog/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

import { createCoverMediaClient } from "@/lib/api/media";
import { searchPlacesForTripForm, useCreateTripFormMutation } from "@/lib/api/trip-form";
import { queryKeys } from "@/lib/query";

import {
  TripForm,
  type TripFormPlaceSearch,
  type TripFormSubmitContext,
} from "./trip-form/trip-form";

export function NewTripShell({
  workspaceSlug,
  workspaceId,
  workspaceName,
}: {
  workspaceSlug: string;
  workspaceId: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const createTrip = useCreateTripFormMutation(workspaceId);
  // If createTrip succeeds but binding the cover fails, a retry must not create a
  // second trip: remember the created trip and only retry POST /cover.
  const createdTripRef = React.useRef<Trip | null>(null);

  async function handleSubmit(input: CreateTripRequest, context: TripFormSubmitContext) {
    const trip = createdTripRef.current ?? (await createTrip.mutateAsync(input));
    createdTripRef.current = trip;

    if (context.coverMediaId) {
      // The uploader already uploaded and awaited `ready`, so this only binds it.
      await createCoverMediaClient().setCover(trip.id, context.coverMediaId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.trip(trip.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.trips(workspaceId) }),
      ]);
    }

    router.push(`/w/${workspaceSlug}/trips/${trip.id}`);
    router.refresh();
  }

  const searchPlaces: TripFormPlaceSearch = async (query, { signal }) => {
    const outcome = await searchPlacesForTripForm(query, signal);
    return { items: outcome.items, degraded: outcome.degraded };
  };

  return (
    <TripForm
      mode="create"
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      searchPlaces={searchPlaces}
      cancelHref={`/w/${workspaceSlug}/trips`}
      onSubmit={handleSubmit}
    />
  );
}
