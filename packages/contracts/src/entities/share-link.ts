import { z } from "zod";

import { IsoTimestampSchema, UuidV7Schema } from "../common/ids";

export const ShareLinkSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema,
    createdById: UuidV7Schema,
    expiresAt: IsoTimestampSchema.nullable(),
    revokedAt: IsoTimestampSchema.nullable(),
    hasPassword: z.boolean(),
    allowIndex: z.boolean(),
    showBudget: z.boolean(),
    lastAccessedAt: IsoTimestampSchema.nullable(),
    accessCount: z.number().int().nonnegative(),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type ShareLink = z.infer<typeof ShareLinkSchema>;

export const ShareLinkCreatedSchema = ShareLinkSchema.extend({
  token: z.string().min(32).max(256),
  url: z.url(),
});
export type ShareLinkCreated = z.infer<typeof ShareLinkCreatedSchema>;
