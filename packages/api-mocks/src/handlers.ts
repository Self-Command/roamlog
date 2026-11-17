import type { ProblemDetails, TripPage } from "@roamlog/contracts";
import { http, HttpResponse } from "msw";

import { demoFixtureState, demoItineraries, demoUser, demoWorkspaces } from "./fixtures";

function problem(
  status: number,
  code: string,
  title: string,
  detail: string,
  instance?: string,
): ProblemDetails {
  return {
    type: `https://roamlog.app/errors/${code.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    detail,
    code,
    ...(instance ? { instance } : {}),
    errors: [],
  };
}

function notFound(detail: string, instance: string): HttpResponse<ProblemDetails> {
  return HttpResponse.json(problem(404, "NOT_FOUND", "Not Found", detail, instance), {
    status: 404,
    headers: {
      "content-type": "application/problem+json",
      "x-roamlog-instance": instance,
    },
  });
}

export const handlers = [
  http.get("/v1/me", () => HttpResponse.json(demoUser)),

  http.get("/v1/workspaces", () => HttpResponse.json(demoWorkspaces)),

  http.get("/v1/me/workspaces", () => HttpResponse.json(demoWorkspaces)),

  http.get("/v1/workspaces/:workspaceId/trips", ({ params, request }) => {
    const workspaceId = String(params.workspaceId);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const query = url.searchParams.get("q")?.trim().toLocaleLowerCase("zh-CN");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);

    const trips = demoFixtureState.trips.filter((trip) => {
      if (trip.workspaceId !== workspaceId) return false;
      if (status && trip.status !== status) return false;
      if (
        query &&
        !`${trip.title} ${trip.summary} ${trip.destinations.join(" ")}`
          .toLocaleLowerCase("zh-CN")
          .includes(query)
      ) {
        return false;
      }
      return true;
    });

    const page: TripPage = {
      items: trips.slice(0, limit),
      nextCursor: null,
      hasMore: trips.length > limit,
    };

    return HttpResponse.json(page);
  }),

  http.get("/v1/trips/:tripId", ({ params }) => {
    const tripId = String(params.tripId);
    const trip = demoFixtureState.trips.find((candidate) => candidate.id === tripId);

    return trip
      ? HttpResponse.json(trip)
      : notFound("The requested trip is not available in local fixtures.", `/v1/trips/${tripId}`);
  }),

  http.get("/v1/trips/:tripId/itinerary", ({ params }) => {
    const tripId = String(params.tripId);
    if (!demoFixtureState.trips.some((trip) => trip.id === tripId)) {
      return notFound(
        "The requested trip is not available in local fixtures.",
        `/v1/trips/${tripId}/itinerary`,
      );
    }

    return HttpResponse.json(demoItineraries[tripId] ?? []);
  }),
];
