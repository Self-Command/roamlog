import { z } from "zod";

import { CountryCodeSchema, DateOnlySchema, UuidV7Schema } from "../common/ids";
import { AmountMinorSchema, CurrencyCodeSchema } from "../common/money";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { ActivitySchema } from "../entities/activity";
import { TripParticipantSchema, TripSchema } from "../entities/trip";
import { TripStatusSchema, TripVisibilitySchema } from "../entities/enums";
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

const CreateTripShape = {
  title: z.string().min(1).max(160),
  summary: z.string().max(1000).optional(),
  status: TripStatusSchema.optional(),
  startDate: DateOnlySchema,
  endDate: DateOnlySchema,
  coverMediaId: UuidV7Schema.nullable().optional(),
  origin: z.string().min(1).max(120).optional(),
  destinations: z.array(z.string().min(1).max(120)).optional(),
  countryCodes: z.array(CountryCodeSchema).optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  guestNames: z.array(z.string().min(1).max(120)).optional(),
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
  });
export type CreateTripRequest = z.infer<typeof CreateTripRequestSchema>;

const UpdateTripShape = {
  version: z.number().int().min(1),
  title: z.string().min(1).max(160).optional(),
  summary: z.string().max(1000).optional(),
  status: TripStatusSchema.optional(),
  startDate: DateOnlySchema.optional(),
  endDate: DateOnlySchema.optional(),
  coverMediaId: UuidV7Schema.nullable().optional(),
  origin: z.string().min(1).max(120).optional(),
  destinations: z.array(z.string().min(1).max(120)).optional(),
  countryCodes: z.array(CountryCodeSchema).optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  guestNames: z.array(z.string().min(1).max(120)).optional(),
  budgetAmountMinor: AmountMinorSchema.nullable().optional(),
  budgetCurrency: CurrencyCodeSchema.nullable().optional(),
  visibility: TripVisibilitySchema.optional(),
  favorite: z.boolean().optional(),
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
