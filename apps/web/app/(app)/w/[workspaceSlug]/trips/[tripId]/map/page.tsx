import { EmptyState } from "@roamlog/ui";
import type { Metadata } from "next";
import dynamic from "next/dynamic";

import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "旅行地图" };

/**
 * Fixture boundary: `TripMapTab` is a legacy demo tab with no live counterpart
 * yet, so api mode renders an explicit empty state instead of demo markers.
 */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

const LegacyTripMapTab = isApiBuild
  ? undefined
  : dynamic(() =>
      import("@/components/legacy-mock/trip-detail/trip-map-tab").then(
        (module) => module.TripMapTab,
      ),
    );

export default async function TripMapPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; tripId: string }>;
}) {
  const { tripId } = await params;

  if (DATA_MODE === "api" || !LegacyTripMapTab) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <EmptyState
          title="行程地图尚未接入"
          description="真实行程地图还在开发中。当前版本不会用演示数据伪造地图，接入后会显示停靠点、路线与照片位置。"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <LegacyTripMapTab tripId={tripId} />
    </div>
  );
}