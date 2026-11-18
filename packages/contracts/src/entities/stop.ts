import { z } from "zod";

import { CountryCodeSchema, DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { IanaTimeZoneSchema } from "./trip";

export const PlaceProviderSchema = z.enum(["photon", "local"]);
export type PlaceProvider = z.infer<typeof PlaceProviderSchema>;

export const StopSchema = z
  .object({
    id: UuidV7Schema,
    tripId: UuidV7Schema,
    workspaceId: UuidV7Schema,
    city: z.string().min(1).max(120),
    country: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    provider: PlaceProviderSchema.nullable(),
    providerPlaceId: z.string().min(1).max(200).nullable(),
    timeZone: IanaTimeZoneSchema.nullable(),
    startDate: DateOnlySchema,
    endDate: DateOnlySchema,
    notes: z.string().max(4000),
    order: z.number().int().nonnegative(),
    version: z.number().int().min(1),
    createdById: UuidV7Schema,
    updatedById: UuidV7Schema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((stop, ctx) => {
    if (stop.endDate < stop.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "Stop endDate must be on or after startDate.",
        path: ["endDate"],
      });
    }
  });
export type Stop = z.infer<typeof StopSchema>;
