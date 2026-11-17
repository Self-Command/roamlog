import { z } from "zod";

import { IsoTimestampSchema } from "../common/ids";

export const EntityTimestampsSchema = z.object({
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export const EntityMutationSchema = EntityTimestampsSchema.extend({
  deletedAt: IsoTimestampSchema.nullable(),
});

export const VersionSchema = z.number().int().min(1);
