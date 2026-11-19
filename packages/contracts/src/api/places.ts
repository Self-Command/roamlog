import { z } from "zod";

import { CountryCodeSchema } from "../common/ids";
import { IanaTimeZoneSchema } from "../entities/trip";

export const PlaceTypeSchema = z.enum(["city", "region", "country", "poi", "other"]);
export type PlaceType = z.infer<typeof PlaceTypeSchema>;

/**
 * Search-provider enum. It is defined separately from the stored `Stop`
 * `PlaceProviderSchema` for readability, but the two **must** carry the same
 * values: every place a search returns has to be storable on a stop without
 * being relabelled. Stops persist `address`/`bbox` since 0006 and `geoapify`
 * since 0007; `entities.test.ts` asserts the two value sets never drift.
 */
export const PlaceSearchProviderSchema = z.enum(["geoapify", "photon", "local"]);
export type PlaceSearchProvider = z.infer<typeof PlaceSearchProviderSchema>;

/**
 * Geographic bounding box in **GeoJSON order: `[west, south, east, north]`**
 * (minimum longitude, minimum latitude, maximum longitude, maximum latitude).
 *
 * This order is part of the contract: providers that expose another order are
 * re-ordered in their normalizer (Photon's `extent` is
 * `[west, north, east, south]`).
 */
export const PlaceBboxSchema = z
  .tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ])
  .superRefine(([west, south, east, north], ctx) => {
    if (west > east) {
      ctx.addIssue({
        code: "custom",
        message: "bbox west must be less than or equal to east.",
        path: [0],
      });
    }
    if (south > north) {
      ctx.addIssue({
        code: "custom",
        message: "bbox south must be less than or equal to north.",
        path: [1],
      });
    }
  });
export type PlaceBbox = z.infer<typeof PlaceBboxSchema>;

export const PlaceSchema = z
  .object({
    provider: PlaceSearchProviderSchema,
    providerPlaceId: z.string().min(1).max(200).nullable(),
    name: z.string().min(1).max(200),
    /** Full formatted address, for example `京都市, 京都府, 日本`. */
    address: z.string().min(1).max(500).nullable(),
    country: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** IANA time zone; Geoapify returns one, the Photon fallback cannot. */
    timeZone: IanaTimeZoneSchema.nullable(),
    /** `[west, south, east, north]`; see `PlaceBboxSchema`. */
    bbox: PlaceBboxSchema.nullable(),
    /** Provider ranking weight in `[0, 1]`, used for stable sorting. */
    importance: z.number().finite().min(0).max(1).nullable(),
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
    provider: PlaceSearchProviderSchema,
    degraded: z.boolean(),
    cached: z.boolean(),
  })
  .strict();
export type PlaceSearchResponse = z.infer<typeof PlaceSearchResponseSchema>;
