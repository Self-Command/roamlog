import type { Metadata } from "next";

import { TripDetailLive } from "@/components/trips/trip-detail-live";

export const metadata: Metadata = {
  title: "旅行详情",
};

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; tripId: string }>;
}) {
  const { workspaceSlug, tripId } = await params;

  return <TripDetailLive workspaceSlug={workspaceSlug} tripId={tripId} />;
}