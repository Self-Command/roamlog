import { describe, expect, it } from "vitest";

import { PresenceUserSchema, RealtimeEventSchema } from "../events/realtime";

const ID = "0192f4c5-6a7b-7c8d-9e0f-123456789abc";
const OTHER = "0192f4c5-6a7b-7c8d-9e0f-123456789abd";
const WORKSPACE = "0192f4c5-6a7b-7c8d-b123-456789abcdef";
const TRIP = "0192f4c5-6a7b-7c8d-8123-456789abcdef";
const TS = "2026-11-17T08:00:00.000Z";

describe("realtime contracts", () => {
  it("publishes presence without private contact details", () => {
    const presence = PresenceUserSchema.parse({
      userId: ID,
      name: "Mia",
      image: null,
      tripId: TRIP,
      lastSeen: TS,
    });
    expect(presence.name).toBe("Mia");
    expect(presence).not.toHaveProperty("email");
    expect(PresenceUserSchema.safeParse({ ...presence, email: "mia@example.com" }).success).toBe(
      false,
    );
  });

  it("uses a discriminated event envelope", () => {
    const event = RealtimeEventSchema.parse({
      type: "trip.changed",
      eventId: ID,
      occurredAt: TS,
      workspaceId: WORKSPACE,
      tripId: TRIP,
      payload: { actorId: OTHER, version: 4 },
    });
    expect(event.type).toBe("trip.changed");
    expect(event.payload).toEqual({ actorId: OTHER, version: 4 });
  });

  it("supports the collaboration and notification event families", () => {
    const events = [
      {
        type: "presence.joined",
        eventId: ID,
        occurredAt: TS,
        workspaceId: WORKSPACE,
        tripId: TRIP,
        payload: { user: { userId: OTHER, name: "Noah", image: null, tripId: TRIP, lastSeen: TS } },
      },
      {
        type: "notification.created",
        eventId: ID,
        occurredAt: TS,
        workspaceId: WORKSPACE,
        payload: { userId: OTHER, notificationId: ID },
      },
      {
        type: "activity.created",
        eventId: ID,
        occurredAt: TS,
        workspaceId: WORKSPACE,
        tripId: TRIP,
        payload: { activityId: ID, actorId: OTHER, verb: "trip.updated" },
      },
    ];
    for (const event of events) {
      expect(RealtimeEventSchema.safeParse(event).success).toBe(true);
    }
    expect(RealtimeEventSchema.safeParse({ ...events[0], type: "trip.unknown" }).success).toBe(
      false,
    );
  });
});
