import type { Metadata } from "next";
import dynamic from "next/dynamic";

import { TripDetailLive } from "@/components/trips/trip-detail-live";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = {
  title: "旅行详情",
};

/**
 * Fixture boundary: the legacy demo trip detail lives in `legacy-mock/` and is
 * only reachable in mock mode. `process.env.NEXT_PUBLIC_DATA_MODE` is inlined
 * at build time, so this branch constant-folds and an api build never emits the
 * demo/fixture chunk.
 */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

const LegacyTripDetail = isApiBuild
  ? undefined
  : dynamic(() =>
      import("@/components/legacy-mock/trip-detail/trip-detail").then(
        (module) => module.TripDetail,
      ),
    );

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; tripId: string }>;
}) {
  const { workspaceSlug, tripId } = await params;

  if (DATA_MODE === "api") {
    return <TripDetailLive workspaceSlug={workspaceSlug} tripId={tripId} />;
  }

  return LegacyTripDetail ? (
    <LegacyTripDetail workspaceSlug={workspaceSlug} tripId={tripId} />
  ) : null;
}