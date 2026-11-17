import type { Metadata } from "next";

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
  return <TripDetail workspaceSlug={workspaceSlug} tripId={tripId} />;
}
