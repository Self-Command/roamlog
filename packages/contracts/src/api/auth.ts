import { z } from "zod";

import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { EmailSchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { NotificationSchema, NotificationPreferenceSchema } from "../entities/notification";
import { UserSchema } from "../entities/user";
import { WorkspaceWithRoleSchema } from "../entities/workspace";
import { CreateExportRequestSchema } from "./exports";
import { BooleanQuerySchema, MessageResponseSchema } from "./common";

export const MeResponseSchema = UserSchema;
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateMeRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    image: z.url().nullable().optional(),
    locale: z.string().min(2).max(20).optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field is required.",
  });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

export const MyWorkspacesResponseSchema = z.array(WorkspaceWithRoleSchema);
export type MyWorkspacesResponse = z.infer<typeof MyWorkspacesResponseSchema>;

export const MyNotificationsQuerySchema = CursorQuerySchema.extend({
  unreadOnly: BooleanQuerySchema.optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type MyNotificationsQuery = z.infer<typeof MyNotificationsQuerySchema>;

export const NotificationPageSchema = CursorPageSchema(NotificationSchema);
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

export const MarkNotificationReadResponseSchema = NotificationSchema;
export type MarkNotificationReadResponse = z.infer<typeof MarkNotificationReadResponseSchema>;

export const ReadAllNotificationsResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
});
export type ReadAllNotificationsResponse = z.infer<typeof ReadAllNotificationsResponseSchema>;

export const NotificationPreferenceInputSchema = z
  .object({
    type: z.string().min(1).max(64),
    inApp: z.boolean(),
    email: z.boolean(),
  })
  .strict();
export type NotificationPreferenceInput = z.infer<typeof NotificationPreferenceInputSchema>;

export const NotificationPreferencesResponseSchema = z.array(NotificationPreferenceSchema);
export type NotificationPreferencesResponse = z.infer<typeof NotificationPreferencesResponseSchema>;

export const UpdateNotificationPreferencesRequestSchema = z
  .object({
    preferences: z.array(NotificationPreferenceInputSchema).min(1),
  })
  .strict();
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof UpdateNotificationPreferencesRequestSchema
>;

export const SessionSchema = z
  .object({
    id: UuidV7Schema,
    userId: UuidV7Schema,
    expiresAt: IsoTimestampSchema,
    createdAt: IsoTimestampSchema,
    ip: z.string().max(64).nullable(),
    userAgent: z.string().max(500).nullable(),
    /** Stable browser identity; null for sessions created before 0018. */
    deviceId: z.string().min(16).max(64).nullable(),
  })
  .strict();
export type Session = z.infer<typeof SessionSchema>;

export const SessionListResponseSchema = z.array(SessionSchema);
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const CreateAccountExportRequestSchema = CreateExportRequestSchema.refine(
  (value) => value.scope === "account" && (value.tripId === null || value.tripId === undefined),
  { message: "Account exports must use scope=account without a tripId." },
);
export type CreateAccountExportRequest = z.infer<typeof CreateAccountExportRequestSchema>;

export const DeleteMeRequestSchema = z.object({ confirmation: z.literal("DELETE") }).strict();
export type DeleteMeRequest = z.infer<typeof DeleteMeRequestSchema>;

export const DeleteMeResponseSchema = MessageResponseSchema;
export type DeleteMeResponse = z.infer<typeof DeleteMeResponseSchema>;

export const AuthHandlerRequestSchema = z.record(z.string(), z.unknown());
export const AuthHandlerResponseSchema = z.record(z.string(), z.unknown());
export const AuthHandlerParamsSchema = z.object({ path: z.string().min(1).max(200) });

export const AccountEmailSchema = EmailSchema;

/**
 * Delivery truth appended by the API gateway to Better Auth's mail routes.
 * Better Auth itself always answers `/request-password-reset` with a generic
 * `{ status: true, message }` body so the endpoint cannot be used to enumerate
 * accounts; without this marker a client cannot tell "a link is on its way"
 * from "no transport exists, nothing was sent". The field is absent whenever a
 * real send was attempted and succeeded.
 *
 * `not_configured`: the deployment has no usable mail transport, so nothing was
 * attempted. `failed`: a send was attempted and the transport rejected or could
 * not reach it (better-auth still answers 200 in that case — see
 * `create-context.mjs:215`), so the link never left.
 */
export const EmailDeliveryMarkerSchema = z.enum(["not_configured", "failed"]);
export type EmailDeliveryMarker = z.infer<typeof EmailDeliveryMarkerSchema>;

export const RequestPasswordResetResponseSchema = z
  .object({
    status: z.boolean().optional(),
    message: z.string().optional(),
    /** Present only when nothing was delivered; absent on a real send. */
    emailDelivery: EmailDeliveryMarkerSchema.optional(),
  })
  .passthrough();
export type RequestPasswordResetResponse = z.infer<typeof RequestPasswordResetResponseSchema>;
