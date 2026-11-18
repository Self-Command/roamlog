import { z } from "zod";

import { CountryCodeSchema, DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { AmountMinorSchema, CurrencyCodeSchema } from "../common/money";
import { MediaStatusSchema, TripStatusSchema, TripVisibilitySchema } from "./enums";

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

export const TripTagListSchema = createUniqueStringListSchema("tags", 20, 40);
export type TripTagList = z.infer<typeof TripTagListSchema>;

export const TripDestinationListSchema = createUniqueStringListSchema("destinations", 30, 120);
export type TripDestinationList = z.infer<typeof TripDestinationListSchema>;

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
    timeZone: IanaTimeZoneSchema.nullable(),
    destinations: TripDestinationListSchema,
    countryCodes: z.array(CountryCodeSchema),
    tags: TripTagListSchema,
    guestNames: TripGuestNameListSchema,
    budgetAmountMinor: AmountMinorSchema.nullable(),
    budgetCurrency: CurrencyCodeSchema.nullable(),
    visibility: TripVisibilitySchema,
    favorite: z.boolean(),
    version: z.number().int().min(1),
    createdById: UuidV7Schema,
    updatedById: UuidV7Schema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
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
    joinedAt: IsoTimestampSchema,
  })
  .strict();
export type TripParticipant = z.infer<typeof TripParticipantSchema>;
