import { z } from "zod";

import { CountryCodeSchema, DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { AmountMinorSchema, CurrencyCodeSchema } from "../common/money";
import {
  MediaStatusSchema,
  ParticipantRoleSchema,
  ParticipantStatusSchema,
  TripAccessGrantTargetTypeSchema,
  TripStatusSchema,
  TripVisibilitySchema,
} from "./enums";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const IanaTimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/)
  .describe("IANA time zone name, for example Asia/Shanghai.");
export type IanaTimeZone = z.infer<typeof IanaTimeZoneSchema>;

function createUniqueStringListSchema(label: string, maxItems: number, maxLength: number) {
  return z
    .array(
      z
        .string()
        .min(1)
        .max(maxLength)
        .refine((value) => value.trim() === value, {
          message: `${label} entries must not have leading or trailing whitespace.`,
        }),
    )
    .max(maxItems)
    .refine((items) => new Set(items.map((item) => item.toLowerCase())).size === items.length, {
      message: `${label} entries must be unique.`,
    });
}

/**
 * A place envelope, ordered `[west, south, east, north]` to match the GeoJSON
 * bounding-box order (and the order the places providers normalize to).
 *
 * Longitude is capped at ±180 and latitude at ±90, and the box must not be
 * inverted: a provider that swaps the axes or returns a corner pair is rejected
 * here instead of being stored as a meaningless rectangle.
 */
export const GeoBboxSchema = z
  .tuple([
    z.number().min(-180).max(180).describe("west"),
    z.number().min(-90).max(90).describe("south"),
    z.number().min(-180).max(180).describe("east"),
    z.number().min(-90).max(90).describe("north"),
  ])
  .refine(([west, , east]) => west <= east, {
    message: "bbox west must not be greater than east.",
  })
  .refine(([, south, , north]) => south <= north, {
    message: "bbox south must not be greater than north.",
  })
  .describe("Bounding box as [west, south, east, north].");
export type GeoBbox = z.infer<typeof GeoBboxSchema>;

export const TripTagListSchema = createUniqueStringListSchema("tags", 20, 40);
export type TripTagList = z.infer<typeof TripTagListSchema>;

/**
 * @deprecated Names-only destination list kept for older clients and for the
 * one remaining read path (`Trip.destinations`) during the 0010 deprecation
 * window. The per-item bound is widened to 160 so a name derived from a
 * structured `TripDestination` (DB `VARCHAR(160)`) can never make this legacy
 * field unparsable; every previously valid 120-character value stays valid.
 */
export const TripDestinationListSchema = createUniqueStringListSchema("destinations", 30, 160);
export type TripDestinationList = z.infer<typeof TripDestinationListSchema>;

/**
 * Where a structured destination came from. The value set is the same as
 * `PlaceSearchProviderSchema` ("geoapify" | "photon" | "local") and is defined
 * here to avoid a circular import between `entities/trip` and `api/places`
 * (`api/places` already imports `IanaTimeZoneSchema` from this module).
 * `entities.test.ts` asserts both enums never drift.
 */
export const TripDestinationProviderSchema = z.enum([
  "geoapify",
  "photon",
  "tencent",
  "local",
  "map_pin",
]);
export type TripDestinationProvider = z.infer<typeof TripDestinationProviderSchema>;

/**
 * A structured destination row: the place a person picked (or typed) together
 * with the metadata needed to draw it on a map and echo it back on edit.
 *
 * `provider` is `null` for rows backfilled from the deprecated
 * `Trip.destinations` strings (0010 migration): those rows are "name only" and
 * the UI offers to upgrade them with a real place search.
 */
export const TripDestinationSchema = z
  .object({
    id: UuidV7Schema,
    name: z.string().min(1).max(160),
    provider: TripDestinationProviderSchema.nullable(),
    providerPlaceId: z.string().min(1).max(200).nullable(),
    address: z.string().max(400).nullable(),
    country: z.string().min(1).max(120).nullable(),
    countryCode: CountryCodeSchema.nullable(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    timeZone: IanaTimeZoneSchema.nullable(),
    bbox: GeoBboxSchema.nullable(),
    order: z.number().int().min(0),
  })
  .strict()
  .superRefine((destination, ctx) => {
    if ((destination.lat === null) !== (destination.lng === null)) {
      ctx.addIssue({
        code: "custom",
        message: "Destination lat and lng must be provided together.",
        path: ["lng"],
      });
    }
  });
export type TripDestination = z.infer<typeof TripDestinationSchema>;

export const TripGuestNameListSchema = createUniqueStringListSchema("guestNames", 30, 120);
export type TripGuestNameList = z.infer<typeof TripGuestNameListSchema>;

export function tripDurationDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== startDate) {
    throw new RangeError("startDate must be a valid YYYY-MM-DD calendar date.");
  }
  if (!Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== endDate) {
    throw new RangeError("endDate must be a valid YYYY-MM-DD calendar date.");
  }
  if (end < start) {
    throw new RangeError("endDate must be on or after startDate.");
  }
  return (end - start) / MILLISECONDS_PER_DAY + 1;
}

export const TripCoverSchema = z
  .object({
    mediaId: UuidV7Schema,
    status: MediaStatusSchema,
    url: z.url().nullable().describe("Signed display URL, preferring the large variant."),
    thumbUrl: z.url().nullable().describe("Signed thumbnail URL for cards and compact layouts."),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    blurhash: z.string().max(200).nullable(),
    expiresAt: IsoTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((cover, ctx) => {
    if (cover.status === "ready" && cover.url === null) {
      ctx.addIssue({
        code: "custom",
        message: "A ready cover must include a display URL.",
        path: ["url"],
      });
    }
    const hasUrl = cover.url !== null || cover.thumbUrl !== null;
    if (hasUrl && cover.expiresAt === null) {
      ctx.addIssue({
        code: "custom",
        message: "Signed cover URLs must include an expiry.",
        path: ["expiresAt"],
      });
    }
    if (!hasUrl && cover.expiresAt !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Cover URLs are required when an expiry is present.",
        path: ["url"],
      });
    }
  });
export type TripCover = z.infer<typeof TripCoverSchema>;

export const TripSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    title: z.string().min(1).max(160),
    summary: z.string().max(1000),
    status: TripStatusSchema,
    startDate: DateOnlySchema,
    endDate: DateOnlySchema,
    durationDays: z.number().int().positive(),
    coverMediaId: UuidV7Schema.nullable(),
    cover: TripCoverSchema.nullable(),
    origin: z.string().min(1).max(120),
    originLat: z.number().min(-90).max(90).nullable(),
    originLng: z.number().min(-180).max(180).nullable(),
    originCountryCode: CountryCodeSchema.nullable(),
    originAddress: z
      .string()
      .max(400)
      .nullable()
      .describe("Formatted address of the selected origin place, when one was picked."),
    originBbox: GeoBboxSchema.nullable(),
    timeZone: IanaTimeZoneSchema.nullable(),
    /** @deprecated Derived from `destinationsV2` names when rows exist. */
    destinations: TripDestinationListSchema,
    /**
     * Structured destinations ordered by `order`. Optional in the schema so
     * fixtures and API surfaces that predate 0010 keep parsing; the trips
     * presenter always emits it (an empty array for name-only legacy trips).
     */
    destinationsV2: z.array(TripDestinationSchema).optional(),
    countryCodes: z.array(CountryCodeSchema),
    tags: TripTagListSchema,
    guestNames: TripGuestNameListSchema,
    budgetAmountMinor: AmountMinorSchema.nullable(),
    budgetCurrency: CurrencyCodeSchema.nullable(),
    visibility: TripVisibilitySchema,
    favorite: z.boolean(),
    /**
     * Owner switch for the public share page (0014): when `true` the share
     * presenter emits each photo's exact WGS-84 `lat`/`lng`.
     *
     * The product decision is that a shared trip shows exact photo locations, so
     * the default is `true`. Optional in the schema so the media/admin presenters
     * and pre-0014 fixtures keep parsing; the trips presenter is the surface that
     * has to emit it, and wiring the toggle into the trip editor is a follow-up
     * (the trips module is outside this change).
     */
    showExactPhotoLocation: z
      .boolean()
      .optional()
      .describe("Owner switch: expose exact photo GPS on the public share page."),
    version: z.number().int().min(1),
    createdById: UuidV7Schema,
    updatedById: UuidV7Schema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
    /** Admin takedown marker; `deletedAt` remains the author's own delete. */
    moderatedAt: IsoTimestampSchema.nullable().optional(),
    moderatedById: UuidV7Schema.nullable().optional(),
  })
  .strict()
  .superRefine((trip, ctx) => {
    if (trip.endDate < trip.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "Trip endDate must be on or after startDate.",
        path: ["endDate"],
      });
    } else if (trip.durationDays !== tripDurationDays(trip.startDate, trip.endDate)) {
      ctx.addIssue({
        code: "custom",
        message: "durationDays must equal the inclusive trip date span.",
        path: ["durationDays"],
      });
    }
    if ((trip.originLat === null) !== (trip.originLng === null)) {
      ctx.addIssue({
        code: "custom",
        message: "originLat and originLng must be provided together.",
        path: ["originLng"],
      });
    }
  });
export type Trip = z.infer<typeof TripSchema>;

export const TripParticipantSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema,
    userId: UuidV7Schema,
    /**
     * `invited` and `joined` both grant read access (the invitee may open the
     * trip before answering); `declined` does not. Older rows are backfilled to
     * `joined` by `0012_visibility_and_participants`.
     */
    status: ParticipantStatusSchema,
    /** What the participant may do inside the trip (0012). */
    role: ParticipantRoleSchema,
    /**
     * When the person was added to the trip. Kept under its pre-0012 name for
     * existing readers; `invitedAt` carries the same instant under the meaning
     * the participant model uses from 0012 onwards.
     */
    joinedAt: IsoTimestampSchema,
    invitedAt: IsoTimestampSchema,
    /** When the invitee answered the invitation; `null` means "no answer yet". */
    respondedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type TripParticipant = z.infer<typeof TripParticipantSchema>;

/**
 * One explicit audience entry of a `custom` trip. `targetType` + `targetId`
 * describe the principal; the display strings (`label`, `sublabel`) live in the
 * `resolved` half of {@link TripAccessGrantsResponseSchema} so a grant row stays
 * stable when a workspace or user is renamed.
 */
export const TripAccessGrantSchema = z
  .object({
    id: UuidV7Schema,
    targetType: TripAccessGrantTargetTypeSchema,
    targetId: UuidV7Schema,
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type TripAccessGrant = z.infer<typeof TripAccessGrantSchema>;

/**
 * A grant target with the labels the server resolved for it: workspace name, or
 * a user's display name plus their email domain (`sublabel`). Resolving here
 * keeps the P3 chips panel from issuing one lookup per grant.
 */
export const ResolvedAccessGrantTargetSchema = z
  .object({
    targetType: TripAccessGrantTargetTypeSchema,
    targetId: UuidV7Schema,
    label: z.string().min(1).max(160),
    sublabel: z.string().max(200).nullable(),
  })
  .strict();
export type ResolvedAccessGrantTarget = z.infer<typeof ResolvedAccessGrantTargetSchema>;

export const TripAccessGrantsResponseSchema = z
  .object({
    grants: z.array(TripAccessGrantSchema),
    resolved: z
      .object({
        workspaces: z.array(ResolvedAccessGrantTargetSchema),
        users: z.array(ResolvedAccessGrantTargetSchema),
      })
      .strict(),
  })
  .strict();
export type TripAccessGrantsResponse = z.infer<typeof TripAccessGrantsResponseSchema>;
