import { z } from "zod";

import { IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { ExportFormatSchema, ExportScopeSchema, ExportStatusSchema } from "./enums";

export const ExportSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema.nullable(),
    requestedById: UuidV7Schema,
    scope: ExportScopeSchema,
    format: ExportFormatSchema,
    includeComments: z.boolean(),
    includeExpenses: z.boolean(),
    includeMedia: z.boolean(),
    status: ExportStatusSchema,
    storageKey: z.string().max(500).nullable(),
    error: z.string().max(1000).nullable(),
    expiresAt: IsoTimestampSchema.nullable(),
    createdAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type Export = z.infer<typeof ExportSchema>;
