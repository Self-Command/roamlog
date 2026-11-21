import {
  MediaPageSchema,
  StopListResponseSchema,
  TripSchema,
  type Media,
  type Stop,
  type Trip,
} from "@roamlog/contracts";
import { Button, ErrorState } from "@roamlog/ui";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { TripMapPage } from "@/components/trip-map/trip-map-page";
import { getApiBaseUrl } from "@/lib/settings";

export const metadata: Metadata = { title: "旅行地图" };

type TripMapData = { trip: Trip; stops: Stop[]; media: Media[] };

type TripMapLoadOutcome =
  | { ok: true; data: TripMapData }
  | { ok: false; reason: "not-found" | "denied" | "unavailable" };

/**
 * Reads the trip, its stops and its photos for the page in one round trip each.
 *
 * The rest of the app talks to `/v1/**` through the same-origin rewrite, which
 * only exists in the browser; a Server Component has to call the API origin
 * directly. The session cookie is forwarded verbatim, so the API's own
 * membership check stays the single authorization decision.
 *
 * Photos are the third read the map needs: `GET /v1/trips/:id/media` is the same
 * list the photos tab consumes (`MediaPageSchema`), and the page hands the rows
 * to `TripMapPage`, which turns the GPS pairs into map points with the existing
 * `photosFromMedia` adapter. Nothing in the server path filters by
 * `showExactPhotoLocation`: that switch only affects the public share payload
 * (`share-links.service.ts`), so in-app members keep seeing exact coordinates.
 */
async function loadTripMap(tripId: string): Promise<TripMapLoadOutcome> {
  const baseUrl = getApiBaseUrl();
  const cookieHeader = (await cookies()).toString();
  const requestInit: RequestInit = {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  };

  let tripResponse: Response;
  let stopsResponse: Response;
  let mediaResponse: Response;
  try {
    [tripResponse, stopsResponse, mediaResponse] = await Promise.all([
      fetch(`${baseUrl}/v1/trips/${tripId}`, requestInit),
      fetch(`${baseUrl}/v1/trips/${tripId}/stops`, requestInit),
      fetch(`${baseUrl}/v1/trips/${tripId}/media?limit=100&sort=createdAt:desc`, requestInit),
    ]);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (tripResponse.status === 404) return { ok: false, reason: "not-found" };
  if (tripResponse.status === 401 || tripResponse.status === 403) {
    return { ok: false, reason: "denied" };
  }
  if (!tripResponse.ok || !stopsResponse.ok || !mediaResponse.ok) {
    return { ok: false, reason: "unavailable" };
  }

  const tripParsed = TripSchema.safeParse(await tripResponse.json().catch(() => null));
  const stopsParsed = StopListResponseSchema.safeParse(
    await stopsResponse.json().catch(() => null),
  );
  const mediaParsed = MediaPageSchema.safeParse(await mediaResponse.json().catch(() => null));
  if (!tripParsed.success || !stopsParsed.success || !mediaParsed.success) {
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    data: {
      trip: tripParsed.data,
      stops: stopsParsed.data,
      media: mediaParsed.data.items,
    },
  };
}

export default async function TripMapRoutePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; tripId: string }>;
}) {
  const { workspaceSlug, tripId } = await params;
  const outcome = await loadTripMap(tripId);
  const mapHref = `/w/${workspaceSlug}/trips/${tripId}/map`;
  const tripsHref = `/w/${workspaceSlug}/trips`;

  if (!outcome.ok) {
    const copy = {
      "not-found": {
        title: "找不到这趟旅行",
        description: "旅行可能已被删除，或者它不属于这个工作区。",
      },
      denied: {
        title: "无法查看这趟旅行的地图",
        description: "当前账号不是这个工作区的成员，或没有阅读这趟旅行的权限。",
      },
      unavailable: {
        title: "地图数据读取失败",
        description: "暂时无法加载这趟旅行的停靠点，请稍后重新加载。",
      },
    }[outcome.reason];

    return (
      <div className="mx-auto w-full max-w-6xl">
        <ErrorState
          title={copy.title}
          description={copy.description}
          retryAction={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild variant="outline">
                <Link href={mapHref}>重新加载</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href={tripsHref}>返回旅行库</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <TripMapPage
      workspaceSlug={workspaceSlug}
      tripId={tripId}
      trip={outcome.data.trip}
      stops={outcome.data.stops}
      media={outcome.data.media}
    />
  );
}