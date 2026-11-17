import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  RealtimeEventSchema,
  type RealtimeEvent,
} from "@roamlog/contracts";

import { generateUuidV7 } from "../auth/uuid.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";

type EnvelopeKey = "eventId" | "occurredAt";

export type RealtimeEventDraft = RealtimeEvent extends infer Event
  ? Event extends RealtimeEvent
    ? Omit<Event, EnvelopeKey>
    : never
  : never;

export interface RealtimeEmitTarget {
  emit(event: string, payload: unknown): unknown;
}

export interface RealtimeTransport {
  to(room: string): RealtimeEmitTarget;
}

@Injectable()
export class RealtimePublisher {
  private transport: RealtimeTransport | undefined;

  constructor(
    @Optional()
    @Inject(PinoLoggerService)
    private readonly logger?: PinoLoggerService,
  ) {}

  attach(transport: RealtimeTransport): void {
    this.transport = transport;
  }

  publish(draft: RealtimeEventDraft): RealtimeEvent {
    const event = RealtimeEventSchema.parse({
      ...draft,
      eventId: generateUuidV7(),
      occurredAt: new Date().toISOString(),
    });
    const room = this.roomFor(event);
    if (!this.transport) {
      return event;
    }

    try {
      this.transport.to(room).emit("realtime.event", event);
    } catch (error) {
      this.logger?.warn({ err: error, eventType: event.type }, "realtime.publish_failed");
    }
    return event;
  }

  publishMany(drafts: readonly RealtimeEventDraft[]): void {
    for (const draft of drafts) {
      this.publish(draft);
    }
  }

  private roomFor(event: RealtimeEvent): string {
    if (event.type === "notification.created") {
      return `user:${event.payload.userId}`;
    }
    if (event.type.startsWith("presence.") && event.tripId) {
      return `trip:${event.tripId}`;
    }
    return `workspace:${event.workspaceId}`;
  }
}
