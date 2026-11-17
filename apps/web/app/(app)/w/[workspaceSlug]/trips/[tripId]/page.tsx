import type { Metadata } from "next";

import { DATA_MODE } from "@/lib/data-mode";
import { TripDetailLive } from "@/components/trips/trip-detail-live";
import { TripDetail } from "@/components/trips/trip-detail";

export const metadata: Metadata = {
  title: "旅行详情",
};

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; tripId: string }>;
}) {
  const { workspaceSlug, tripId } = await params;
  return DATA_MODE === "api" ? (
    <TripDetailLive workspaceSlug={workspaceSlug} tripId={tripId} />
  ) : (
    <TripDetail workspaceSlug={workspaceSlug} tripId={tripId} />
  );
}
