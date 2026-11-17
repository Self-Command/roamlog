import { z } from "zod";

import { EmailSchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { PlatformRoleSchema } from "../permissions";
import { AccountStatusSchema } from "./enums";

export const UserSchema = z
  .object({
    id: UuidV7Schema,
    email: EmailSchema,
    emailVerified: z.boolean(),
    name: z.string().min(1).max(120),
    image: z.url().nullable(),
    platformRole: PlatformRoleSchema,
    status: AccountStatusSchema,
    locale: z.string().min(2).max(20),
    timezone: z.string().min(1).max(64),
    lastActiveAt: IsoTimestampSchema.nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type User = z.infer<typeof UserSchema>;

export const UserSummarySchema = UserSchema.pick({
  id: true,
  name: true,
  image: true,
  email: true,
  status: true,
});
export type UserSummary = z.infer<typeof UserSummarySchema>;
