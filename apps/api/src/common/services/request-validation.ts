import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

export function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new BadRequestException({
    code: "VALIDATION_ERROR",
    message: "The request did not pass validation.",
    errors: result.error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || undefined,
      code: "INVALID_INPUT",
      message: issue.message,
    })),
  });
}
