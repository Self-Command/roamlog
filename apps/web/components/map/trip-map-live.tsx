"use client";

import { listStops } from "@roamlog/api-client";
import { StopListResponseSchema } from "@roamlog/contracts";
import { Button, ErrorState, Skeleton } from "@roamlog/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ShareLinkDialog } from "@/components/share/share-link-dialog";
import { useTripQuery, useWorkspaceBySlug } from "@/lib/query";

import type { MapStop } from "./map-types";
import { TripMap } from "./trip-map";

export function TripMapLive({
  workspaceSlug,
  tripId,
}: {
  workspaceSlug: string;
  tripId: string;
}) {
  const { workspace } = useWorkspaceBySlug(workspaceSlug);
  const tripQuery = useTripQuery(tripId);
  const [stops, setStops] = useState<MapStop[]>([]);
  const [stopsError, setStopsError] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    listStops(tripId, { signal: controller.signal })
      .then((response) => {
        if (!active) return;
        if (response.status === 200) {
          setStops(
            StopListResponseSchema.parse(response.data).map((stop) => ({
              id: stop.id,
              city: stop.city,
              country: stop.country,
              countryCode: stop.countryCode,
              lat: stop.lat,
              lng: stop.lng,
              startDate: stop.startDate,
              endDate: stop.endDate,
              notes: stop.notes,
              order: stop.order,
            })),
          );
        } else {
          setStopsError(true);
        }
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setStopsError(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [tripId]);

  if (tripQuery.isLoading) {
    return <Skeleton className="h-96 rounded-card" />;
  }

  if (!tripQuery.data || tripQuery.error) {
    return (
      <ErrorState
        title="找不到这趟旅行"
        description="旅行不存在，或当前账号没有访问权限。"
        retryAction={
          <Button asChild variant="outline">
            <Link href={`/w/${workspaceSlug}/trips`}>返回旅行库</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="type-eyebrow">
            {tripQuery.data.title} / {stops.length} STOPS
          </p>
          <h1 className="mt-1 font-serif text-3xl tracking-[-0.03em] text-ink">地图与路线</h1>
        </div>
        <ShareLinkDialog
          tripId={tripId}
          canShare={workspace ? workspace.role !== "viewer" : false}
        />
      </div>
      {stopsError ? (
        <p role="alert" className="text-[11px] text-accent-red">
          停靠点读取失败。地图和列表暂时为空，请稍后刷新。
        </p>
      ) : null}
      <TripMap stops={stops} allowSearch />
    </div>
  );
}
