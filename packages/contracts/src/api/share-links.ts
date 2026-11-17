import { z } from "zod";

import {
  CountryCodeSchema,
  DateOnlySchema,
  IsoTimestampSchema,
  UuidV7Schema,
} from "../common/ids";
import { ShareLinkCreatedSchema, ShareLinkSchema } from "../entities/share-link";
import { MediaSchema } from "../entities/media";
import { JournalEntrySchema } from "../entities/journal";
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
    coverMediaId: UuidV7Schema.nullable(),
    origin: z.string().min(1).max(120),
    destinations: z.array(z.string().min(1).max(120)),
    countryCodes: z.array(CountryCodeSchema),
    tags: z.array(z.string().min(1).max(40)),
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
    startDate: DateOnlySchema,
    endDate: DateOnlySchema,
    notes: z.string().max(4000),
    order: z.number().int().nonnegative(),
  })
  .strict();
export type PublicStop = z.infer<typeof PublicStopSchema>;

export const PublicMediaSchema = MediaSchema.pick({
  id: true,
  width: true,
  height: true,
  blurhash: true,
  variants: true,
  caption: true,
  date: true,
  location: true,
});
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
