import { z } from "zod";

import { UuidV7Schema } from "../common/ids";
import { PresenceUserSchema } from "../events/realtime";

export const RealtimeConnectionQuerySchema = z.object({
  tripId: UuidV7Schema.optional(),
});
export type RealtimeConnectionQuery = z.infer<typeof RealtimeConnectionQuerySchema>;

export const RealtimeConnectionAckSchema = z
  .object({
    connected: z.literal(true),
    socketId: z.string().min(1).max(200),
    heartbeatSeconds: z.number().int().positive(),
  })
  .strict();
export type RealtimeConnectionAck = z.infer<typeof RealtimeConnectionAckSchema>;

export const PresenceSnapshotSchema = z
  .object({
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema.nullable(),
    users: z.array(PresenceUserSchema),
  })
  .strict();
export type PresenceSnapshot = z.infer<typeof PresenceSnapshotSchema>;
