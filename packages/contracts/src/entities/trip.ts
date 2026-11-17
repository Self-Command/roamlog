import { z } from "zod";

import {
  CountryCodeSchema,
  DateOnlySchema,
  IsoTimestampSchema,
  UuidV7Schema,
} from "../common/ids";
import { AmountMinorSchema, CurrencyCodeSchema } from "../common/money";
import { TripStatusSchema, TripVisibilitySchema } from "./enums";

export const TripSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
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
    guestNames: z.array(z.string().min(1).max(120)),
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
