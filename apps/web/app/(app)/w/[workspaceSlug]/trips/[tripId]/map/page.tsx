import type { Metadata } from "next";

import { TripMapLive } from "@/components/map/trip-map-live";
import { TripMapTab } from "@/components/trip-detail/trip-map-tab";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "旅行地图" };

export default async function TripMapPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; tripId: string }>;
}) {
  const { workspaceSlug, tripId } = await params;
  return DATA_MODE === "api" ? (
    <TripMapLive workspaceSlug={workspaceSlug} tripId={tripId} />
  ) : (
    <div className="mx-auto w-full max-w-6xl">
      <TripMapTab tripId={tripId} />
    </div>
  );
}
