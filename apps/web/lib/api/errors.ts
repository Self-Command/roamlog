import { ProblemDetailsSchema, type ProblemDetails } from "@roamlog/contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem?: ProblemDetails;

  constructor(
    status: number,
    message: string,
    code = "API_REQUEST_FAILED",
    problem?: ProblemDetails,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.problem = problem;
  }
}

export function problemFromBody(body: unknown): ProblemDetails | undefined {
  const result = ProblemDetailsSchema.safeParse(body);
  return result.success ? result.data : undefined;
}

export function errorFromResponse(status: number, body: unknown, path: string): ApiError {
  const problem = problemFromBody(body);
  return new ApiError(
    status,
    problem?.detail ??
      problem?.title ??
      `API request to ${path} failed with status ${status}.`,
    problem?.code ?? (status === 401 ? "UNAUTHORIZED" : "API_REQUEST_FAILED"),
    problem,
  );
}

export function invalidResponse(path: string, detail?: string): ApiError {
  return new ApiError(
    200,
    detail ?? `API response did not match the contract for ${path}.`,
    "INVALID_RESPONSE",
  );
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && (error.status === 409 || error.code === "VERSION_CONFLICT");
}

export function isForbidden(error: unknown): boolean {
  return isApiError(error) && error.status === 403;
}
