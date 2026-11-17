import { z } from "zod";

import { IsoTimestampSchema, JsonObjectSchema, UuidV7Schema } from "../common/ids";

export const ActivitySchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema.nullable(),
    actorId: UuidV7Schema,
    verb: z.string().min(1).max(80),
    entityType: z.string().min(1).max(60),
    entityId: UuidV7Schema,
    metadata: JsonObjectSchema,
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type Activity = z.infer<typeof ActivitySchema>;
