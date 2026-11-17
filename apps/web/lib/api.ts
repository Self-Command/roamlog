import {
  ItineraryListResponseSchema,
  MeResponseSchema,
  ProblemDetailsSchema,
  TripPageSchema,
  TripSchema,
  WorkspaceListResponseSchema,
  type ItineraryListResponse,
  type MeResponse,
  type ProblemDetails,
  type Trip,
  type TripPage,
  type WorkspaceListResponse,
} from "@roamlog/contracts";

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

async function requestJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    signal,
    credentials: "include",
    headers: {
      accept: "application/json",
    },
  });
  const text = await response.text();
  let body: unknown = null;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, "API returned a non-JSON response.", "INVALID_JSON");
    }
  }

  if (!response.ok) {
    const problemResult = ProblemDetailsSchema.safeParse(body);
    const problem = problemResult.success ? problemResult.data : undefined;
    throw new ApiError(
      response.status,
      problem?.detail ?? problem?.title ?? `API request failed with status ${response.status}.`,
      problem?.code ?? "API_REQUEST_FAILED",
      problem,
    );
  }

  return body;
}

function invalidResponse(path: string): ApiError {
  return new ApiError(
    200,
    `API response did not match the contract for ${path}.`,
    "INVALID_RESPONSE",
  );
}

export async function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  const result = MeResponseSchema.safeParse(await requestJson("/v1/me", signal));
  if (!result.success) throw invalidResponse("/v1/me");
  return result.data;
}

export async function fetchWorkspaces(signal?: AbortSignal): Promise<WorkspaceListResponse> {
  const result = WorkspaceListResponseSchema.safeParse(await requestJson("/v1/workspaces", signal));
  if (!result.success) throw invalidResponse("/v1/workspaces");
  return result.data;
}

export async function fetchTrips(workspaceId: string, signal?: AbortSignal): Promise<TripPage> {
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/trips?limit=100&sort=updatedAt:desc`;
  const result = TripPageSchema.safeParse(await requestJson(path, signal));
  if (!result.success) throw invalidResponse(path);
  return result.data;
}

export async function fetchTrip(tripId: string, signal?: AbortSignal): Promise<Trip> {
  const path = `/v1/trips/${encodeURIComponent(tripId)}`;
  const result = TripSchema.safeParse(await requestJson(path, signal));
  if (!result.success) throw invalidResponse(path);
  return result.data;
}

export async function fetchItinerary(
  tripId: string,
  signal?: AbortSignal,
): Promise<ItineraryListResponse> {
  const path = `/v1/trips/${encodeURIComponent(tripId)}/itinerary`;
  const result = ItineraryListResponseSchema.safeParse(await requestJson(path, signal));
  if (!result.success) throw invalidResponse(path);
  return result.data;
}
