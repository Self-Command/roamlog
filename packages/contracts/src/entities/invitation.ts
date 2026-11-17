import { z } from "zod";

import { EmailSchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { WorkspaceRoleSchema } from "../permissions";

export const InvitationSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    email: EmailSchema,
    role: WorkspaceRoleSchema,
    invitedById: UuidV7Schema,
    expiresAt: IsoTimestampSchema,
    acceptedAt: IsoTimestampSchema.nullable(),
    revokedAt: IsoTimestampSchema.nullable(),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type Invitation = z.infer<typeof InvitationSchema>;
