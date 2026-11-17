import { z } from "zod";

import { JsonObjectSchema } from "./ids";

export const ProblemDetailErrorSchema = z
  .object({
    field: z.string().min(1).optional(),
    code: z.string().min(1).max(80),
    message: z.string().min(1),
    meta: JsonObjectSchema.optional(),
  })
  .strict();

const ProblemDetailsShape = {
  type: z.url(),
  title: z.string().min(1).max(120),
  status: z.number().int().min(100).max(599),
  detail: z.string().min(1).optional(),
  instance: z.string().min(1).optional(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  errors: z.array(ProblemDetailErrorSchema).default([]),
};

export const ProblemDetailsSchema = z.object(ProblemDetailsShape).strict();
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export type ProblemDetailsInput = {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  type?: string;
  instance?: string;
  errors?: z.input<typeof ProblemDetailErrorSchema>[];
};

function defaultTitle(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    case 422:
      return "Unprocessable Content";
    case 429:
      return "Too Many Requests";
    case 500:
      return "Internal Server Error";
    default:
      return status >= 500 ? "Server Error" : "Request Error";
  }
}

function errorType(code: string): string {
  return `https://roamlog.app/errors/${code.toLowerCase().replaceAll("_", "-")}`;
}

export function problemDetails(input: ProblemDetailsInput): ProblemDetails {
  return ProblemDetailsSchema.parse({
    type: input.type ?? errorType(input.code),
    title: input.title ?? defaultTitle(input.status),
    status: input.status,
    code: input.code,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    ...(input.instance === undefined ? {} : { instance: input.instance }),
    ...(input.errors === undefined ? {} : { errors: input.errors }),
  });
}
