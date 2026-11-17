import {
  ActivitySchema,
  CommentPageSchema,
  EntryPageSchema,
  ExpensePageSchema,
  InvitationPageSchema,
  MediaPageSchema,
  NotificationPageSchema,
  NotificationPreferencesResponseSchema,
  PackingPageSchema,
  StopListResponseSchema,
  WorkspaceMemberPageSchema,
  type ProblemDetails,
  type TripPage,
} from "@roamlog/contracts";
import { http, HttpResponse } from "msw";

import {
  demoActivities,
  demoComments,
  demoContent,
  demoExpenses,
  demoFixtureState,
  demoItineraries,
  demoMedia,
  demoNotifications,
  demoStops,
  demoUser,
  demoWorkspaces,
} from "./fixtures";

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

  http.get("/v1/workspaces/:workspaceId/members", ({ params }) => {
    const workspaceId = String(params.workspaceId);
    return HttpResponse.json(
      WorkspaceMemberPageSchema.parse({
        items: demoContent.members.filter((member) => member.workspaceId === workspaceId),
        nextCursor: null,
        hasMore: false,
      }),
    );
  }),

  http.get("/v1/workspaces/:workspaceId/invitations", ({ params }) => {
    const workspaceId = String(params.workspaceId);
    return HttpResponse.json(
      InvitationPageSchema.parse({
        items: demoContent.invitations.filter(
          (invitation) => invitation.workspaceId === workspaceId,
        ),
        nextCursor: null,
        hasMore: false,
      }),
    );
  }),

  http.get("/v1/workspaces/:workspaceId/entries", ({ params }) => {
    const workspaceId = String(params.workspaceId);
    return HttpResponse.json(
      EntryPageSchema.parse({
        items: demoContent.entries.filter((entry) => entry.workspaceId === workspaceId),
        nextCursor: null,
        hasMore: false,
      }),
    );
  }),

  http.get("/v1/trips/:tripId/entries", ({ params }) => {
    const tripId = String(params.tripId);
    return HttpResponse.json(
      EntryPageSchema.parse({
        items: demoContent.entries.filter((entry) => entry.tripId === tripId),
        nextCursor: null,
        hasMore: false,
      }),
    );
  }),

  http.get("/v1/trips/:tripId/comments", ({ params, request }) => {
    const tripId = String(params.tripId);
    const url = new URL(request.url);
    const targetId = url.searchParams.get("targetId");
    return HttpResponse.json(
      CommentPageSchema.parse({
        items: demoComments.filter(
          (comment) =>
            comment.tripId === tripId && (!targetId || comment.targetId === targetId),
        ),
        nextCursor: null,
        hasMore: false,
      }),
    );
  }),

  http.get("/v1/trips/:tripId/expenses", ({ params }) => {
    const tripId = String(params.tripId);
    return HttpResponse.json(
      ExpensePageSchema.parse({
        items: demoExpenses.filter((expense) => expense.tripId === tripId),
        nextCursor: null,
        hasMore: false,
      }),
    );
  }),

  http.get("/v1/trips/:tripId/packing", ({ params }) => {
    const tripId = String(params.tripId);
    return HttpResponse.json(
      PackingPageSchema.parse({
        items: demoContent.packing.filter((item) => item.tripId === tripId),
        nextCursor: null,
        hasMore: false,
      }),
    );
  }),

  http.get("/v1/trips/:tripId/stops", ({ params }) => {
    const tripId = String(params.tripId);
    return HttpResponse.json(
      StopListResponseSchema.parse(demoStops.filter((stop) => stop.tripId === tripId)),
    );
  }),

  http.get("/v1/trips/:tripId/media", ({ params }) => {
    const tripId = String(params.tripId);
    return HttpResponse.json(
      MediaPageSchema.parse({
        items: demoMedia.filter((media) => media.tripId === tripId),
        nextCursor: null,
        hasMore: false,
      }),
    );
  }),

  http.get("/v1/trips/:tripId/activity", ({ params }) => {
    const tripId = String(params.tripId);
    return HttpResponse.json({
      items: ActivitySchema.array().parse(
        demoActivities.filter((activity) => activity.tripId === tripId),
      ),
      nextCursor: null,
      hasMore: false,
    });
  }),

  http.get("/v1/workspaces/:workspaceId/activity", ({ params }) => {
    const workspaceId = String(params.workspaceId);
    return HttpResponse.json({
      items: ActivitySchema.array().parse(
        demoActivities.filter((activity) => activity.workspaceId === workspaceId),
      ),
      nextCursor: null,
      hasMore: false,
    });
  }),

  http.get("/v1/me/notifications", () =>
    HttpResponse.json(
      NotificationPageSchema.parse({
        items: demoNotifications,
        nextCursor: null,
        hasMore: false,
      }),
    ),
  ),

  http.get("/v1/me/notification-preferences", () =>
    HttpResponse.json(
      NotificationPreferencesResponseSchema.parse([
        { userId: demoUser.id, type: "mention", inApp: true, email: true },
        { userId: demoUser.id, type: "comment", inApp: true, email: true },
        { userId: demoUser.id, type: "trip_reminder", inApp: true, email: false },
      ]),
    ),
  ),
];
