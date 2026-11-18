import { z } from "zod";

import { CountryCodeSchema, DateOnlySchema, UuidV7Schema } from "../common/ids";
import { ItineraryItemSchema } from "../entities/itinerary";
import { PlaceProviderSchema, StopSchema } from "../entities/stop";
import { IanaTimeZoneSchema } from "../entities/trip";
import { ItineraryItemTypeSchema, TimeOfDaySchema } from "../entities/enums";
import { MessageResponseSchema } from "./common";

export const StopListResponseSchema = z.array(StopSchema);
export type StopListResponse = z.infer<typeof StopListResponseSchema>;

export const CreateStopRequestSchema = z
  .object({
    city: z.string().min(1).max(120),
    country: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    provider: PlaceProviderSchema.nullable().optional(),
    providerPlaceId: z.string().min(1).max(200).nullable().optional(),
    timeZone: IanaTimeZoneSchema.nullable().optional(),
    startDate: DateOnlySchema,
    endDate: DateOnlySchema,
    notes: z.string().max(4000).optional(),
    order: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((stop, ctx) => {
    if (stop.endDate < stop.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "endDate must be on or after startDate.",
        path: ["endDate"],
      });
    }
  });
export type CreateStopRequest = z.infer<typeof CreateStopRequestSchema>;

export const UpdateStopRequestSchema = z
  .object({
    version: z.number().int().min(1),
    city: z.string().min(1).max(120).optional(),
    country: z.string().min(1).max(120).optional(),
    countryCode: CountryCodeSchema.optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    provider: PlaceProviderSchema.nullable().optional(),
    providerPlaceId: z.string().min(1).max(200).nullable().optional(),
    timeZone: IanaTimeZoneSchema.nullable().optional(),
    startDate: DateOnlySchema.optional(),
    endDate: DateOnlySchema.optional(),
    notes: z.string().max(4000).optional(),
    order: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((stop, ctx) => {
    if (Object.keys(stop).length <= 1) {
      ctx.addIssue({ code: "custom", message: "At least one stop field must change." });
    }
    if (stop.startDate && stop.endDate && stop.endDate < stop.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "endDate must be on or after startDate.",
        path: ["endDate"],
      });
    }
  });
export type UpdateStopRequest = z.infer<typeof UpdateStopRequestSchema>;

export const ReorderStopsRequestSchema = z
  .object({
    items: z
      .array(z.object({ id: UuidV7Schema, order: z.number().int().nonnegative() }).strict())
      .min(1),
  })
  .strict();
export type ReorderStopsRequest = z.infer<typeof ReorderStopsRequestSchema>;

export const ReorderStopsResponseSchema = z.array(StopSchema);
export type ReorderStopsResponse = z.infer<typeof ReorderStopsResponseSchema>;

export const DeleteStopResponseSchema = MessageResponseSchema;
export type DeleteStopResponse = z.infer<typeof DeleteStopResponseSchema>;

export const ItineraryListResponseSchema = z.array(ItineraryItemSchema);
export type ItineraryListResponse = z.infer<typeof ItineraryListResponseSchema>;

export const CreateItineraryItemRequestSchema = z
  .object({
    date: DateOnlySchema,
    startTime: TimeOfDaySchema.nullable().optional(),
    endTime: TimeOfDaySchema.nullable().optional(),
    title: z.string().min(1).max(180),
    type: ItineraryItemTypeSchema,
    location: z.string().min(1).max(200),
    notes: z.string().max(4000).optional(),
    done: z.boolean().optional(),
    order: z.number().int().nonnegative().optional(),
    assigneeId: UuidV7Schema.nullable().optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.startTime && item.endTime && item.endTime < item.startTime) {
      ctx.addIssue({
        code: "custom",
        message: "endTime must be on or after startTime.",
        path: ["endTime"],
      });
    }
  });
export type CreateItineraryItemRequest = z.infer<typeof CreateItineraryItemRequestSchema>;

export const UpdateItineraryItemRequestSchema = z
  .object({
    version: z.number().int().min(1),
    date: DateOnlySchema.optional(),
    startTime: TimeOfDaySchema.nullable().optional(),
    endTime: TimeOfDaySchema.nullable().optional(),
    title: z.string().min(1).max(180).optional(),
    type: ItineraryItemTypeSchema.optional(),
    location: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).optional(),
    done: z.boolean().optional(),
    order: z.number().int().nonnegative().optional(),
    assigneeId: UuidV7Schema.nullable().optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (Object.keys(item).length <= 1) {
      ctx.addIssue({ code: "custom", message: "At least one itinerary field must change." });
    }
    if (item.startTime && item.endTime && item.endTime < item.startTime) {
      ctx.addIssue({
        code: "custom",
        message: "endTime must be on or after startTime.",
        path: ["endTime"],
      });
    }
  });
export type UpdateItineraryItemRequest = z.infer<typeof UpdateItineraryItemRequestSchema>;

export const ReorderItineraryRequestSchema = ReorderStopsRequestSchema;
export type ReorderItineraryRequest = z.infer<typeof ReorderItineraryRequestSchema>;

export const ReorderItineraryResponseSchema = z.array(ItineraryItemSchema);
export type ReorderItineraryResponse = z.infer<typeof ReorderItineraryResponseSchema>;

export const DeleteItineraryItemResponseSchema = MessageResponseSchema;
export type DeleteItineraryItemResponse = z.infer<typeof DeleteItineraryItemResponseSchema>;
