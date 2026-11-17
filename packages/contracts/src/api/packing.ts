import { z } from "zod";

import { UuidV7Schema } from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { PackingCategorySchema } from "../entities/enums";
import { PackingItemSchema } from "../entities/packing";
import { BooleanQuerySchema, MessageResponseSchema } from "./common";

export const PackingListQuerySchema = CursorQuerySchema.extend({
  category: PackingCategorySchema.optional(),
  packed: BooleanQuerySchema.optional(),
  assigneeId: UuidV7Schema.optional(),
  sort: createSortSchema(["order", "createdAt", "name"]).optional(),
});
export type PackingListQuery = z.infer<typeof PackingListQuerySchema>;

export const PackingPageSchema = CursorPageSchema(PackingItemSchema);
export type PackingPage = z.infer<typeof PackingPageSchema>;

export const CreatePackingItemRequestSchema = z
  .object({
    category: PackingCategorySchema,
    name: z.string().min(1).max(160),
    quantity: z.number().int().min(1).max(999).optional(),
    assigneeId: UuidV7Schema.nullable().optional(),
    order: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CreatePackingItemRequest = z.infer<typeof CreatePackingItemRequestSchema>;

export const UpdatePackingItemRequestSchema = z
  .object({
    version: z.number().int().min(1),
    category: PackingCategorySchema.optional(),
    name: z.string().min(1).max(160).optional(),
    quantity: z.number().int().min(1).max(999).optional(),
    packed: z.boolean().optional(),
    assigneeId: UuidV7Schema.nullable().optional(),
    order: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, {
    message: "At least one packing field must change.",
  });
export type UpdatePackingItemRequest = z.infer<typeof UpdatePackingItemRequestSchema>;

export const ReorderPackingRequestSchema = z
  .object({
    items: z
      .array(z.object({ id: UuidV7Schema, order: z.number().int().nonnegative() }).strict())
      .min(1),
  })
  .strict();
export type ReorderPackingRequest = z.infer<typeof ReorderPackingRequestSchema>;

export const ReorderPackingResponseSchema = z.array(PackingItemSchema);
export type ReorderPackingResponse = z.infer<typeof ReorderPackingResponseSchema>;

export const BulkPackingUpdateSchema = UpdatePackingItemRequestSchema.and(
  z.object({ id: UuidV7Schema }),
);
export type BulkPackingUpdate = z.infer<typeof BulkPackingUpdateSchema>;

export const BulkPackingRequestSchema = z
  .object({
    create: z.array(CreatePackingItemRequestSchema).optional(),
    update: z.array(BulkPackingUpdateSchema).optional(),
    deleteIds: z.array(UuidV7Schema).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.create?.length ?? 0) + (value.update?.length ?? 0) + (value.deleteIds?.length ?? 0) >
      0,
    { message: "At least one bulk packing change is required." },
  );
export type BulkPackingRequest = z.infer<typeof BulkPackingRequestSchema>;

export const BulkPackingResponseSchema = z.object({ items: z.array(PackingItemSchema) }).strict();
export type BulkPackingResponse = z.infer<typeof BulkPackingResponseSchema>;

export const DeletePackingItemResponseSchema = MessageResponseSchema;
export type DeletePackingItemResponse = z.infer<typeof DeletePackingItemResponseSchema>;
