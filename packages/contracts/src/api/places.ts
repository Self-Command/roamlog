import { z } from "zod";

import { CountryCodeSchema } from "../common/ids";
import { PlaceProviderSchema } from "../entities/stop";
import { IanaTimeZoneSchema } from "../entities/trip";

export const PlaceTypeSchema = z.enum(["city", "region", "country", "poi", "other"]);
export type PlaceType = z.infer<typeof PlaceTypeSchema>;

export const PlaceSchema = z
  .object({
    provider: PlaceProviderSchema,
    providerPlaceId: z.string().min(1).max(200).nullable(),
    name: z.string().min(1).max(200),
    country: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    timeZone: IanaTimeZoneSchema.nullable(),
    type: PlaceTypeSchema,
  })
  .strict();
export type Place = z.infer<typeof PlaceSchema>;

export const PlaceSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120),
    limit: z.coerce.number().int().min(1).max(10).default(6),
    lang: z.enum(["zh", "en"]).optional(),
  })
  .strict();
export type PlaceSearchQuery = z.infer<typeof PlaceSearchQuerySchema>;

export const PlaceSearchResponseSchema = z
  .object({
    items: z.array(PlaceSchema).max(10),
    provider: PlaceProviderSchema,
    degraded: z.boolean(),
    cached: z.boolean(),
  })
  .strict();
export type PlaceSearchResponse = z.infer<typeof PlaceSearchResponseSchema>;
