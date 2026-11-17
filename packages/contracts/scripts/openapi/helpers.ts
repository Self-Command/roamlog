import type {
  OpenAPIRegistry,
  ResponseConfig,
  RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import { ProblemDetailsSchema } from "../../src/common/problem-details";
import { IdempotencyKeySchema } from "../../src/api/common";
import { resolveRegisteredSchema } from "./schemas";

type RequestConfig = NonNullable<RouteConfig["request"]>;
type Method = RouteConfig["method"];

export type OperationSpec = {
  method: Method;
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description?: string;
  params?: NonNullable<RequestConfig["params"]>;
  query?: NonNullable<RequestConfig["query"]>;
  headers?: NonNullable<RequestConfig["headers"]>;
  body?: z.ZodType;
  response?: z.ZodType;
  responseDescription?: string;
  status?: number;
  public?: boolean;
  versioned?: boolean;
  idempotent?: boolean;
  errors?: number[];
};

function problemResponse(description: string): ResponseConfig {
  return {
    description,
    content: {
      "application/json": {
        schema: resolveRegisteredSchema(ProblemDetailsSchema),
      },
    },
  };
}

const defaultErrors: Record<number, string> = {
  400: "The request is malformed or fails schema validation.",
  401: "Authentication is required.",
  403: "The caller is not allowed to perform this action.",
  404: "The requested resource was not found in an accessible Workspace.",
  409: "The resource version is stale or the operation conflicts with current state.",
  422: "The request is syntactically valid but violates a business rule.",
  429: "The caller exceeded the rate limit.",
  500: "An unexpected server error occurred.",
  503: "A required service is unavailable.",
};

export function registerOperation(registry: OpenAPIRegistry, spec: OperationSpec): void {
  const status = spec.status ?? (spec.method === "post" ? 201 : 200);
  const responseSchema = spec.response ? resolveRegisteredSchema(spec.response) : undefined;
  const responses: RouteConfig["responses"] = {
    [status]: responseSchema
      ? {
          description: spec.responseDescription ?? "Successful response.",
          content: {
            "application/json": {
              schema: responseSchema,
            },
          },
        }
      : { description: spec.responseDescription ?? "Successful response." },
  };

  const errors = new Set(
    spec.errors ??
      (spec.public ? [400, 404, 429, 500, 503] : [400, 401, 403, 404, 429, 500]),
  );
  if (spec.versioned) {
    errors.add(409);
  }
  for (const code of errors) {
    responses[code] = problemResponse(defaultErrors[code] ?? "Request failed.");
  }

  const request: RequestConfig = {};
  if (spec.params) request.params = resolveRegisteredSchema(spec.params);
  if (spec.query) request.query = resolveRegisteredSchema(spec.query);
  if (spec.body) {
    request.body = {
      required: true,
      content: {
        "application/json": {
          schema: resolveRegisteredSchema(spec.body),
        },
      },
    };
  }

  if (spec.idempotent) {
    request.headers = z
      .object({
        "idempotency-key": IdempotencyKeySchema.optional(),
      });
  } else if (spec.headers) {
    request.headers = spec.headers;
  }

  registry.registerPath({
    method: spec.method,
    path: spec.path,
    operationId: spec.operationId,
    tags: [spec.tag],
    summary: spec.summary,
    ...(spec.description ? { description: spec.description } : {}),
    ...(Object.keys(request).length > 0 ? { request } : {}),
    responses,
    ...(spec.public ? { security: [] } : {}),
  });
}
