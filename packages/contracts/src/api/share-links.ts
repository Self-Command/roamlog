import { z } from "zod";

import { CountryCodeSchema, DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { ShareLinkCreatedSchema, ShareLinkSchema } from "../entities/share-link";
import { JournalEntrySchema } from "../entities/journal";
import { TripCoverSchema, TripDestinationListSchema, TripTagListSchema } from "../entities/trip";
import { TripStatusSchema } from "../entities/enums";
import { BudgetSummarySchema } from "./expenses";
import { MessageResponseSchema } from "./common";

export const CreateShareLinkRequestSchema = z
  .object({
    expiresAt: IsoTimestampSchema.nullable().optional(),
    password: z.string().min(8).max(128).optional(),
    allowIndex: z.boolean().optional(),
    showBudget: z.boolean().optional(),
  })
  .strict();
export type CreateShareLinkRequest = z.infer<typeof CreateShareLinkRequestSchema>;

export const ShareLinkListResponseSchema = z.array(ShareLinkSchema);
export type ShareLinkListResponse = z.infer<typeof ShareLinkListResponseSchema>;

export const ShareLinkCreateResponseSchema = ShareLinkCreatedSchema;
export type ShareLinkCreateResponse = z.infer<typeof ShareLinkCreateResponseSchema>;

export const DeleteShareLinkResponseSchema = MessageResponseSchema;
export type DeleteShareLinkResponse = z.infer<typeof DeleteShareLinkResponseSchema>;

export const PublicShareQuerySchema = z.object({
  password: z.string().min(1).max(128).optional(),
});
export type PublicShareQuery = z.infer<typeof PublicShareQuerySchema>;

export const PublicShareTokenSchema = z.string().min(32).max(256);

export const PublicTripSchema = z
  .object({
    id: UuidV7Schema,
    title: z.string().min(1).max(160),
    summary: z.string().max(1000),
    status: TripStatusSchema,
    startDate: DateOnlySchema,
    endDate: DateOnlySchema,
    durationDays: z.number().int().positive(),
    coverMediaId: UuidV7Schema.nullable(),
    cover: TripCoverSchema.nullable(),
    origin: z.string().min(1).max(120),
    destinations: TripDestinationListSchema,
    countryCodes: z.array(CountryCodeSchema),
    tags: TripTagListSchema,
  })
  .strict();
export type PublicTrip = z.infer<typeof PublicTripSchema>;

export const PublicStopSchema = z
  .object({
    id: UuidV7Schema,
    city: z.string().min(1).max(120),
    country: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    address: z
      .string()
      .max(400)
      .nullable()
      .describe("Formatted place address. The bbox stays private."),
    startDate: DateOnlySchema,
    endDate: DateOnlySchema,
    notes: z.string().max(4000),
    order: z.number().int().nonnegative(),
  })
  .strict();
export type PublicStop = z.infer<typeof PublicStopSchema>;

export const PublicMediaSchema = z
  .object({
    id: UuidV7Schema,
    url: z.url().describe("Signed display URL."),
    thumbUrl: z.url().nullable().describe("Signed thumbnail URL, when available."),
    expiresAt: IsoTimestampSchema,
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    blurhash: z.string().max(200).nullable(),
    caption: z.string().max(500).nullable(),
    date: DateOnlySchema.nullable(),
    location: z.string().max(200).nullable(),
  })
  .strict();
export type PublicMedia = z.infer<typeof PublicMediaSchema>;

export const PublicEntrySchema = JournalEntrySchema.pick({
  id: true,
  title: true,
  date: true,
  location: true,
  lat: true,
  lng: true,
  mood: true,
  weather: true,
  contentHtml: true,
  excerpt: true,
  tags: true,
}).extend({
  media: z.array(PublicMediaSchema),
});
export type PublicEntry = z.infer<typeof PublicEntrySchema>;

export const PublicTripResponseSchema = z
  .object({
    trip: PublicTripSchema,
    stops: z.array(PublicStopSchema),
    entries: z.array(PublicEntrySchema),
    media: z.array(PublicMediaSchema),
    budget: BudgetSummarySchema.nullable(),
  })
  .strict();
export type PublicTripResponse = z.infer<typeof PublicTripResponseSchema>;
