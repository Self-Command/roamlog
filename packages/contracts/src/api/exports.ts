import { z } from "zod";

import { UuidV7Schema } from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { ExportFormatSchema, ExportScopeSchema, ExportStatusSchema } from "../entities/enums";
import { ExportSchema } from "../entities/export";
import { MessageResponseSchema } from "./common";

export const CreateExportRequestSchema = z
  .object({
    scope: ExportScopeSchema,
    tripId: UuidV7Schema.nullable().optional(),
    format: ExportFormatSchema,
    includeComments: z.boolean().default(false),
    includeExpenses: z.boolean().default(false),
    includeMedia: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === "trip" && !value.tripId) {
      ctx.addIssue({
        code: "custom",
        message: "tripId is required when scope=trip.",
        path: ["tripId"],
      });
    }
    if (value.scope !== "trip" && value.tripId) {
      ctx.addIssue({
        code: "custom",
        message: "tripId is only valid when scope=trip.",
        path: ["tripId"],
      });
    }
  });
export type CreateExportRequest = z.infer<typeof CreateExportRequestSchema>;

export const ExportListQuerySchema = CursorQuerySchema.extend({
  status: ExportStatusSchema.optional(),
  scope: ExportScopeSchema.optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type ExportListQuery = z.infer<typeof ExportListQuerySchema>;

export const ExportPageSchema = CursorPageSchema(ExportSchema);
export type ExportPage = z.infer<typeof ExportPageSchema>;

export const ExportDetailSchema = ExportSchema.extend({
  downloadUrl: z.url().nullable(),
});
export type ExportDetail = z.infer<typeof ExportDetailSchema>;

export const DeleteExportResponseSchema = MessageResponseSchema;
export type DeleteExportResponse = z.infer<typeof DeleteExportResponseSchema>;
