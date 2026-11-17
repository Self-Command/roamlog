import { z } from "zod";

import { IsoTimestampSchema, JsonObjectSchema, UuidV7Schema } from "../common/ids";

export const FeatureFlagSchema = z
  .object({
    key: z.string().min(1).max(80),
    description: z.string().max(500),
    enabled: z.boolean(),
    rolloutPercentage: z.number().int().min(0).max(100),
    rules: JsonObjectSchema,
    updatedById: UuidV7Schema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;
