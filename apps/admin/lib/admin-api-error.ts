import type { ProblemDetails } from "@roamlog/api-client";

export interface AdminApiFailure {
  code: string;
  status: number;
  title: string;
  detail: string;
  degraded: string[];
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

export function toAdminApiFailure(
  status: number,
  data: unknown,
  headers?: Headers | null,
): AdminApiFailure {
  const degraded = (headers?.get("x-roamlog-degraded") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (isProblemDetails(data)) {
    return {
      code: data.code,
      status: data.status || status,
      title: data.title,
      detail: data.detail ?? data.title,
      degraded,
    };
  }

  return {
    code: `HTTP_${status}`,
    status,
    title: status === 401 ? "Session required" : "Admin API request failed",
    detail:
      status === 401
        ? "The Admin session is missing or has expired. Sign in again to continue."
        : "The Admin API returned an unexpected response.",
    degraded,
  };
}

export class AdminMutationError extends Error {
  readonly failure: AdminApiFailure;

  constructor(failure: AdminApiFailure) {
    super(failure.detail);
    this.name = "AdminMutationError";
    this.failure = failure;
  }
}

export function assertAdminResponse<T>(
  response: { status: number; data: T; headers?: Headers },
  context: string,
): T {
  const degraded = (response.headers?.get("x-roamlog-degraded") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (response.status >= 200 && response.status < 300) {
    if (degraded.length > 0) {
      console.warn(`[admin-api] ${context} degraded: ${degraded.join(", ")}`);
    }
    return response.data;
  }

  throw new AdminMutationError(toAdminApiFailure(response.status, response.data, response.headers));
}
