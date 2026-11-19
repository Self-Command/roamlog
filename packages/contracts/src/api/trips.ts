import { z } from "zod";

import { CountryCodeSchema, DateOnlySchema, EmailSchema, UuidV7Schema } from "../common/ids";
import { AmountMinorSchema, CurrencyCodeSchema } from "../common/money";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { ActivitySchema } from "../entities/activity";
import {
  GeoBboxSchema,
  IanaTimeZoneSchema,
  TripDestinationListSchema,
  TripDestinationProviderSchema,
  TripGuestNameListSchema,
  TripParticipantSchema,
  TripSchema,
  TripTagListSchema,
} from "../entities/trip";
import {
  ParticipantRoleSchema,
  ParticipantStatusSchema,
  TripStatusSchema,
  TripVisibilitySchema,
} from "../entities/enums";
import { MessageResponseSchema } from "./common";

export const TripListQuerySchema = CursorQuerySchema.extend({
  status: TripStatusSchema.optional(),
  q: z.string().max(160).optional(),
  visibility: TripVisibilitySchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  tag: z.string().max(40).optional(),
  participantId: UuidV7Schema.optional(),
  sort: createSortSchema(["updatedAt", "createdAt", "startDate", "title"]).optional(),
});
export type TripListQuery = z.infer<typeof TripListQuerySchema>;

export const TripPageSchema = CursorPageSchema(TripSchema);
export type TripPage = z.infer<typeof TripPageSchema>;

/**
 * One structured destination in a create/update payload.
 *
 * Every metadata field is **`.optional()`** on purpose: a caller that only knows
 * a name (the old `destinations: string[]` client) must still be able to add
 * destinations, and an existing client that omits the whole `destinationsV2`
 * array must not break. `null` is accepted where "explicitly unknown" is
 * meaningful, but absence is a separate state: omitted fields are stored as
 * `null`, they are never an error.
 *
 * `order` is assigned by the server from the array position: the array is
 * authoritative for route order.
 */
export const TripDestinationInputSchema = z
  .object({
    name: z.string().min(1).max(160),
    provider: TripDestinationProviderSchema.nullable().optional(),
    providerPlaceId: z.string().min(1).max(200).nullable().optional(),
    address: z.string().max(400).nullable().optional(),
    country: z.string().min(1).max(120).nullable().optional(),
    countryCode: CountryCodeSchema.nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    timeZone: IanaTimeZoneSchema.nullable().optional(),
    bbox: GeoBboxSchema.nullable().optional(),
  })
  .strict()
  .superRefine((destination, ctx) => {
    // `null` and "omitted" are different states, but both mean "no coordinate":
    // only a real number counts as half of a pair.
    const hasLat = destination.lat !== null && destination.lat !== undefined;
    const hasLng = destination.lng !== null && destination.lng !== undefined;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: "custom",
        message: "lat and lng must be provided together.",
        path: ["lng"],
      });
    }
  });
export type TripDestinationInput = z.infer<typeof TripDestinationInputSchema>;

/**
 * Whole-group destination payload. Sending it replaces every active row of the
 * trip; sending `[]` clears them; omitting it leaves stored rows untouched.
 * Names stay unique case-insensitively, matching the legacy list rule.
 */
export const TripDestinationInputListSchema = z
  .array(TripDestinationInputSchema)
  .max(30)
  .refine(
    (items) =>
      new Set(items.map((item) => item.name.trim().toLowerCase())).size === items.length,
    { message: "destinationsV2 names must be unique." },
  );
export type TripDestinationInputList = z.infer<typeof TripDestinationInputListSchema>;

const CreateTripShape = {
  title: z.string().min(1).max(160),
  summary: z.string().max(1000).optional(),
  status: TripStatusSchema.optional(),
  startDate: DateOnlySchema,
  endDate: DateOnlySchema,
  coverMediaId: z
    .null()
    .optional()
    .describe("Omit or send null. Set a cover through POST /v1/trips/{tripId}/cover."),
  origin: z.string().min(1).max(120).optional(),
  originLat: z.number().min(-90).max(90).nullable().optional(),
  originLng: z.number().min(-180).max(180).nullable().optional(),
  originCountryCode: CountryCodeSchema.nullable().optional(),
  originAddress: z.string().max(400).nullable().optional(),
  originBbox: GeoBboxSchema.nullable().optional(),
  timeZone: IanaTimeZoneSchema.nullable().optional(),
  /** @deprecated Names-only fallback; prefer `destinationsV2`. */
  destinations: TripDestinationListSchema.optional(),
  /**
   * Structured destinations. When present the whole group is replaced (an
   * empty array clears it); when omitted stored rows stay untouched.
   */
  destinationsV2: TripDestinationInputListSchema.optional(),
  countryCodes: z.array(CountryCodeSchema).optional(),
  tags: TripTagListSchema.optional(),
  guestNames: TripGuestNameListSchema.optional(),
  budgetAmountMinor: AmountMinorSchema.nullable().optional(),
  budgetCurrency: CurrencyCodeSchema.nullable().optional(),
  visibility: TripVisibilitySchema.optional(),
  favorite: z.boolean().optional(),
};

export const CreateTripRequestSchema = z
  .object(CreateTripShape)
  .strict()
  .superRefine((trip, ctx) => {
    if (trip.endDate < trip.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "endDate must be on or after startDate.",
        path: ["endDate"],
      });
    }
    if ((trip.budgetAmountMinor === null) !== (trip.budgetCurrency === null)) {
      ctx.addIssue({
        code: "custom",
        message: "budgetAmountMinor and budgetCurrency must be provided together.",
        path: ["budgetAmountMinor"],
      });
    }
    const hasOriginLat = trip.originLat !== null && trip.originLat !== undefined;
    const hasOriginLng = trip.originLng !== null && trip.originLng !== undefined;
    if (hasOriginLat !== hasOriginLng) {
      ctx.addIssue({
        code: "custom",
        message: "originLat and originLng must be provided together.",
        path: ["originLng"],
      });
    }
  });
export type CreateTripRequest = z.infer<typeof CreateTripRequestSchema>;

const UpdateTripShape = {
  version: z.number().int().min(1),
  title: z.string().min(1).max(160).optional(),
  summary: z.string().max(1000).optional(),
  status: TripStatusSchema.optional(),
  startDate: DateOnlySchema.optional(),
  endDate: DateOnlySchema.optional(),
  coverMediaId: z
    .null()
    .optional()
    .describe("Send null to clear a cover. Set a cover through POST /v1/trips/{tripId}/cover."),
  origin: z.string().min(1).max(120).optional(),
  originLat: z.number().min(-90).max(90).nullable().optional(),
  originLng: z.number().min(-180).max(180).nullable().optional(),
  originCountryCode: CountryCodeSchema.nullable().optional(),
  originAddress: z
    .string()
    .max(400)
    .nullable()
    .optional()
    .describe("Send null to clear the stored address; omit to keep it."),
  originBbox: GeoBboxSchema.nullable()
    .optional()
    .describe("Send null to clear the stored bbox; omit to keep it."),
  timeZone: IanaTimeZoneSchema.nullable().optional(),
  /** @deprecated Names-only fallback; prefer `destinationsV2`. */
  destinations: TripDestinationListSchema.optional(),
  /**
   * Structured destinations. When present the whole group is replaced (an
   * empty array clears it); when omitted stored rows stay untouched.
   */
  destinationsV2: TripDestinationInputListSchema.optional(),
  countryCodes: z.array(CountryCodeSchema).optional(),
  tags: TripTagListSchema.optional(),
  guestNames: TripGuestNameListSchema.optional(),
  budgetAmountMinor: AmountMinorSchema.nullable().optional(),
  budgetCurrency: CurrencyCodeSchema.nullable().optional(),
  visibility: TripVisibilitySchema.optional(),
  favorite: z.boolean().optional(),
  /**
   * Owner switch for the public share page (0014): when `false`, a share link
   * shows each photo's city and drops its exact WGS-84 point. Omitted means
   * "keep the stored value"; the column defaults to `true`.
   */
  showExactPhotoLocation: z
    .boolean()
    .optional()
    .describe("Owner switch: expose exact photo GPS on the public share page."),
};

export const UpdateTripRequestSchema = z
  .object(UpdateTripShape)
  .strict()
  .superRefine((trip, ctx) => {
    if (Object.keys(trip).length <= 1) {
      ctx.addIssue({
        code: "custom",
        message: "At least one trip field must change.",
        path: ["version"],
      });
    }
    if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "endDate must be on or after startDate.",
        path: ["endDate"],
      });
    }
  });
export type UpdateTripRequest = z.infer<typeof UpdateTripRequestSchema>;

export const DuplicateTripRequestSchema = z
  .object({ title: z.string().min(1).max(160).optional() })
  .strict();
export type DuplicateTripRequest = z.infer<typeof DuplicateTripRequestSchema>;

export const TripParticipantListResponseSchema = z.array(TripParticipantSchema);
export type TripParticipantListResponse = z.infer<typeof TripParticipantListResponseSchema>;

export const AddTripParticipantRequestSchema = z.object({ userId: UuidV7Schema }).strict();
export type AddTripParticipantRequest = z.infer<typeof AddTripParticipantRequestSchema>;

/**
 * Upper bound on one `custom` audience replacement. A trip shared with more
 * than 50 workspaces *and* 50 people at once is outside the product's intent
 * (and would make the P3 chip list unusable), so the request is rejected
 * instead of silently truncated.
 */
export const TRIP_ACCESS_GRANT_LIMIT = 50;

const uniqueUuidList = (label: string) =>
  z
    .array(UuidV7Schema)
    .max(TRIP_ACCESS_GRANT_LIMIT)
    .refine((items) => new Set(items).size === items.length, {
      message: `${label} entries must be unique.`,
    });

/**
 * Whole-set replacement for a `custom` trip's audience: the payload is the
 * complete list, so clearing every grant means sending two empty arrays.
 *
 * Both arrays are **required** on purpose — absence and "empty" would otherwise
 * be indistinguishable, and a caller that forgot `workspaces` would silently
 * delete every workspace grant. This is the one request in the participant/
 * visibility family where a missing field is an error, not a default.
 */
export const SetTripAccessGrantsRequestSchema = z
  .object({
    workspaces: uniqueUuidList("workspaces"),
    users: uniqueUuidList("users"),
  })
  .strict();
export type SetTripAccessGrantsRequest = z.infer<typeof SetTripAccessGrantsRequestSchema>;

/**
 * Invite a participant by id or by email — exactly one, never both.
 *
 * `userId` and `email` are `.optional()` (not `.nullable()`) because "not
 * supplied" and "supplied as null" must differ here: the superRefine counts the
 * provided identifiers, and a `null` would count. `role` is optional and the
 * server defaults it to `viewer`.
 */
export const CreateParticipantRequestSchema = z
  .object({
    userId: UuidV7Schema.optional(),
    email: EmailSchema.optional(),
    role: ParticipantRoleSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const identifiers = [value.userId, value.email].filter((item) => item !== undefined);
    if (identifiers.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Exactly one of userId or email is required.",
        path: identifiers.length === 0 ? ["userId"] : ["userId", "email"],
      });
    }
  });
export type CreateParticipantRequest = z.infer<typeof CreateParticipantRequestSchema>;

/**
 * Change a participant's role or invitation state. Both fields are truly
 * `.optional()`: an existing caller that only sends `role` must keep working,
 * and a payload that changes nothing is rejected rather than treated as a
 * silent no-op.
 */
export const UpdateParticipantRequestSchema = z
  .object({
    role: ParticipantRoleSchema.optional(),
    status: ParticipantStatusSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.role === undefined && value.status === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "At least one of role or status is required.",
        path: ["role"],
      });
    }
  });
export type UpdateParticipantRequest = z.infer<typeof UpdateParticipantRequestSchema>;

export const TripActivityQuerySchema = CursorQuerySchema.extend({
  actorId: UuidV7Schema.optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type TripActivityQuery = z.infer<typeof TripActivityQuerySchema>;

export const TripActivityPageSchema = CursorPageSchema(ActivitySchema);
export type TripActivityPage = z.infer<typeof TripActivityPageSchema>;

export const DeleteTripResponseSchema = MessageResponseSchema;
export type DeleteTripResponse = z.infer<typeof DeleteTripResponseSchema>;

export const RemoveTripParticipantResponseSchema = MessageResponseSchema;
export type RemoveTripParticipantResponse = z.infer<typeof RemoveTripParticipantResponseSchema>;
