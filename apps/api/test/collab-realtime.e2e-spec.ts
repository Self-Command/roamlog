import { describe, expect, it, vi } from "vitest";

import { RealtimeEventSchema } from "@roamlog/contracts";

import { PresenceService } from "../src/modules/realtime/presence.service.js";
import { RealtimePublisher } from "../src/modules/realtime/realtime.publisher.js";
import {
  USER_EDITOR_ID,
  USER_OWNER_ID,
  NOW,
  WORKSPACE_A_ID,
  WORKSPACE_B_ID,
} from "./identity-fixtures.js";

describe("PresenceService", () => {
  it("isolates presence by Workspace/Trip room and cleans up only the leaving socket", () => {
    const presence = new PresenceService();
    const owner = {
      userId: USER_OWNER_ID,
      name: "Owner",
      image: null,
      tripId: null,
      lastSeen: NOW.toISOString(),
    };
    const editor = {
      userId: USER_EDITOR_ID,
      name: "Editor",
      image: null,
      tripId: null,
      lastSeen: NOW.toISOString(),
    };

    presence.join(`workspace:${WORKSPACE_A_ID}`, owner, "socket-a");
    presence.join(`workspace:${WORKSPACE_A_ID}`, editor, "socket-b");
    presence.join(`workspace:${WORKSPACE_B_ID}`, owner, "socket-c");

    expect(presence.list(`workspace:${WORKSPACE_A_ID}`)).toHaveLength(2);
    expect(presence.list(`workspace:${WORKSPACE_B_ID}`)).toEqual([owner]);

    presence.leave(`workspace:${WORKSPACE_A_ID}`, USER_OWNER_ID, "socket-a");
    expect(presence.list(`workspace:${WORKSPACE_A_ID}`)).toEqual([editor]);
    expect(presence.list(`workspace:${WORKSPACE_B_ID}`)).toEqual([owner]);
    expect(presence.list("trip:unknown")).toEqual([]);
  });
});

describe("RealtimePublisher", () => {
  it("publishes cache-invalidation events only to the appropriate room", async () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const publisher = new RealtimePublisher();
    publisher.attach({ to } as never);

    publisher.publish({
      workspaceId: WORKSPACE_A_ID,
      type: "comment.changed",
      tripId: "01942f30-1200-7000-8000-000000000501",
      payload: {
        actorId: USER_EDITOR_ID,
        commentId: "01942f30-1200-7000-8000-000000000801",
      },
    });

    expect(to).toHaveBeenCalledWith(`workspace:${WORKSPACE_A_ID}`);
    expect(emit).toHaveBeenCalledOnce();
    const event = emit.mock.calls[0]?.[1];
    expect(RealtimeEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      type: "comment.changed",
      workspaceId: WORKSPACE_A_ID,
      payload: { actorId: USER_EDITOR_ID },
    });
  });
});
