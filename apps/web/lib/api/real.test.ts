import {
  demoActivities,
  demoComments,
  demoEntries,
  demoFixtureState,
  demoItineraryItems,
  demoMembers,
  demoNotifications,
  demoUser,
  demoWorkspaces,
} from "@/test/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./errors";
import { realAdapterInstance } from "./real";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const problem409 = {
  type: "https://roamlog.app/errors/version-conflict",
  title: "Version conflict",
  status: 409,
  detail: "Someone saved this trip first.",
  code: "VERSION_CONFLICT",
  errors: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("live API adapter", () => {
  it("loads me, workspaces, trips, entries, itinerary, comments, notifications, activity and search", async () => {
    const workspace = demoWorkspaces[0]!;
    const trip = demoFixtureState.trips[0]!;
    const entry = demoEntries[0]!;
    const page = <T,>(items: T[]) => ({ items, nextCursor: null, hasMore: false });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url === "/v1/me") return jsonResponse(demoUser);
        if (url === "/v1/me/workspaces" || url === "/v1/workspaces") {
          return jsonResponse(demoWorkspaces);
        }
        if (url.includes("/trips?") || url.endsWith("/trips")) {
          return jsonResponse(page(demoFixtureState.trips));
        }
        if (url === `/v1/trips/${trip.id}` && method === "GET") return jsonResponse(trip);
        if (url === `/v1/trips/${trip.id}/itinerary`) {
          return jsonResponse(demoItineraryItems);
        }
        if (url.includes("/entries")) return jsonResponse(page(demoEntries));
        if (url.startsWith("/v1/comments?")) return jsonResponse(page(demoComments));
        if (url.startsWith("/v1/me/notifications")) {
          return jsonResponse(page(demoNotifications));
        }
        if (url.includes("/activity")) return jsonResponse(page(demoActivities));
        if (url.includes("/search")) {
          return jsonResponse({
            query: "京都",
            trips: [
              {
                id: trip.id,
                type: "trip",
                title: trip.title,
                snippet: trip.summary,
                tripId: trip.id,
                highlight: trip.title,
              },
            ],
            entries: [],
            comments: [],
            people: [],
          });
        }
        if (url.includes(`/members/${demoMembers[0]!.id}`)) {
          return jsonResponse(demoMembers[0]);
        }
        if (url.includes("/members")) return jsonResponse(page(demoMembers));
        return jsonResponse({ message: "not found" }, 404);
      }),
    );

    const [me, workspaces, trips, tripDetail, itinerary, entries, comments, notifications, activity, search] =
      await Promise.all([
        realAdapterInstance.fetchMe(),
        realAdapterInstance.fetchMyWorkspaces(),
        realAdapterInstance.fetchTrips(workspace.id),
        realAdapterInstance.fetchTrip(trip.id),
        realAdapterInstance.fetchItinerary(trip.id),
        realAdapterInstance.fetchEntries(workspace.id, { limit: 20 }),
        realAdapterInstance.fetchComments({
          targetType: "journal_entry",
          targetId: entry.id,
        }),
        realAdapterInstance.fetchNotifications({ limit: 20 }),
        realAdapterInstance.fetchActivity(workspace.id, { limit: 20 }),
        realAdapterInstance.searchWorkspace(workspace.id, { q: "京都", type: "all" }),
      ]);

    expect(me.email).toBe(demoUser.email);
    expect(workspaces[0]?.slug).toBe(workspace.slug);
    expect(trips.items[0]?.id).toBe(trip.id);
    expect(tripDetail.title).toBe(trip.title);
    expect(itinerary[0]?.id).toBe(demoItineraryItems[0]?.id);
    expect(entries.items[0]?.id).toBe(entry.id);
    expect(comments.items[0]?.id).toBe(demoComments[0]?.id);
    expect(notifications.items[0]?.id).toBe(demoNotifications[0]?.id);
    expect(activity.items[0]?.id).toBe(demoActivities[0]?.id);
    expect(search.trips[0]?.title).toBe(trip.title);
  });

  it("maps a 401 problem response to an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            type: "https://roamlog.app/errors/unauthorized",
            title: "Unauthorized",
            status: 401,
            detail: "Session expired.",
            code: "UNAUTHORIZED",
            errors: [],
          },
          401,
        ),
      ),
    );

    await expect(realAdapterInstance.fetchMe()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("maps a 409 version conflict response to a conflict error", async () => {
    const trip = demoFixtureState.trips[0]!;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(problem409, 409)));

    try {
      await realAdapterInstance.updateTrip(trip.id, {
        version: trip.version,
        title: "Changed",
      });
      throw new Error("Expected updateTrip to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).code).toBe("VERSION_CONFLICT");
    }
  });
});
