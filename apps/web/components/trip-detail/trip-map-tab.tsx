"use client";

import { useMemo } from "react";

import { TripMap } from "@/components/map/trip-map";
import { ShareLinkDialog } from "@/components/share/share-link-dialog";
import { canEdit, useDemoStore } from "@/lib/demo-store";

export function TripMapTab({ tripId }: { tripId: string }) {
  const { state, currentRole } = useDemoStore();
  const trip = state.trips.find((candidate) => candidate.id === tripId);
  const stops = useMemo(
    () =>
      state.stops
        .filter((stop) => stop.tripId === tripId)
        .sort((left, right) => left.order - right.order),
    [state.stops, tripId],
  );

  if (!trip) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-stone">
          MAP / TILES + ACCESSIBLE FALLBACK / {stops.length} STOPS
        </p>
        <ShareLinkDialog tripId={tripId} canShare={canEdit(currentRole)} />
      </div>
      <TripMap stops={stops} allowSearch />
    </div>
  );
}
