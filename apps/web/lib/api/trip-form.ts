"use client";

/**
 * Thin adapters between the generated Orval client and the trip form.
 *
 * The generated hooks resolve 4xx/5xx responses as data instead of throwing, so
 * the form would never see a ProblemDetails payload. These wrappers call the
 * generated endpoint functions directly and normalize every non-2xx response
 * into `ApiError`, which keeps `problem.errors[].field` available for 422s.
 */

import {
  createTrip as createTripRequest,
  getTrip as getTripRequest,
  searchPlaces as searchPlacesRequest,
  updateTrip as updateTripRequest,
} from "@roamlog/api-client";
import {
  PlaceSearchResponseSchema,
  TripSchema,
  type CreateTripRequest,
  type Place,
  type PlaceSearchResponse,
  type Trip,
  type UpdateTripRequest,
} from "@roamlog/contracts";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as React from "react";

import { queryKeys } from "@/lib/query";

import { replaceTripAccessGrants } from "./access-grants";
import { errorFromResponse, invalidResponse } from "./errors";
import { unwrap } from "./shared";

export interface TripAccessGrantsInput {
  workspaces: string[];
  users: string[];
}

const accessGrantsByPayload = new WeakMap<object, TripAccessGrantsInput>();

/**
 * Attaches the audience write to the exact payload object handed to `onSubmit`.
 *
 * The trip request and the grants replacement are two HTTP calls, but the form
 * owns only one save seam. Keeping the grants in a WeakMap means the generated
 * `createTrip` / `updateTrip` JSON stays contract-clean, while the mutation hook
 * that sees the same object can run `PUT /access-grants` immediately after the
 * trip write. It is intentionally not an enumerable field: a network retry must
 * never leak `accessGrants` into `CreateTripRequest` / `UpdateTripRequest`.
 */
export function withTripAccessGrants<T extends object>(
  payload: T,
  grants: TripAccessGrantsInput,
): T {
  accessGrantsByPayload.set(payload, grants);
  return payload;
}

function tripAccessGrantsOf(payload: object): TripAccessGrantsInput | undefined {
  return accessGrantsByPayload.get(payload);
}

export class TripAccessGrantsSaveError extends Error {
  readonly stage: "created" | "updated";
  readonly trip: Trip;
  readonly reason: unknown;

  constructor(stage: "created" | "updated", trip: Trip, reason: unknown) {
    super("Trip saved, but access grants were not.");
    this.name = "TripAccessGrantsSaveError";
    this.stage = stage;
    this.trip = trip;
    this.reason = reason;
  }
}

function isVersionOnlyRetry(input: UpdateTripRequest, trip: Trip | null): boolean {
  if (!trip) return false;
  const keys = Object.keys(input);
  return keys.length === 1 && keys[0] === "version" && input.version === trip.version;
}

export const tripFormKeys = {
  trip: (tripId: string) => queryKeys.trip(tripId),
};

export function useTripFormTripQuery(tripId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.trip(tripId ?? "unknown"),
    queryFn: async ({ signal }) => {
      if (!tripId) throw new Error("tripId is required");
      const result = await getTripRequest(tripId, { signal });
      return unwrap(result, TripSchema, `/v1/trips/${tripId}`);
    },
    enabled: Boolean(tripId),
  });
}

function invalidateTripCaches(queryClient: QueryClient, workspaceId: string | undefined) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.trips(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: ["trips"] });
  void queryClient.invalidateQueries({ queryKey: ["workspace-activity"] });
}

export function useCreateTripFormMutation(workspaceId: string) {
  const queryClient = useQueryClient();
  // A grants failure happens after the trip row exists. Remember it so the
  // banner's retry only retries PUT /access-grants instead of creating a second
  // trip. The form is remounted when the person leaves the page.
  const createdTripRef = React.useRef<Trip | null>(null);

  return useMutation({
    mutationFn: async (input: CreateTripRequest): Promise<Trip> => {
      const trip =
        createdTripRef.current ??
        unwrap(
          await createTripRequest(workspaceId, input),
          TripSchema,
          `/v1/workspaces/${workspaceId}/trips`,
        );
      createdTripRef.current = trip;
      queryClient.setQueryData(queryKeys.trip(trip.id), trip);
      invalidateTripCaches(queryClient, workspaceId);

      const grants = tripAccessGrantsOf(input);
      if (grants) {
        try {
          await replaceTripAccessGrants(trip.id, grants);
        } catch (reason) {
          throw new TripAccessGrantsSaveError("created", trip, reason);
        }
      }

      createdTripRef.current = null;
      return trip;
    },
    onSuccess: (trip) => {
      queryClient.setQueryData(queryKeys.trip(trip.id), trip);
      invalidateTripCaches(queryClient, workspaceId);
    },
  });
}

export function useUpdateTripFormMutation(tripId: string) {
  const queryClient = useQueryClient();
  // Mirrors the create case: after PATCH succeeds and PUT fails, the retry must
  // not PATCH an already-saved payload with a stale version.
  const updatedTripRef = React.useRef<Trip | null>(null);

  return useMutation({
    mutationFn: async (input: UpdateTripRequest): Promise<Trip> => {
      const isRetry = isVersionOnlyRetry(input, updatedTripRef.current);
      const trip = isRetry
        ? (updatedTripRef.current as Trip)
        : unwrap(await updateTripRequest(tripId, input), TripSchema, `/v1/trips/${tripId}`);

      updatedTripRef.current = trip;
      queryClient.setQueryData(queryKeys.trip(trip.id), trip);
      invalidateTripCaches(queryClient, undefined);

      const grants = tripAccessGrantsOf(input);
      if (grants) {
        try {
          await replaceTripAccessGrants(tripId, grants);
        } catch (reason) {
          throw new TripAccessGrantsSaveError("updated", trip, reason);
        }
      }

      updatedTripRef.current = null;
      return trip;
    },
    onSuccess: (trip) => {
      queryClient.setQueryData(queryKeys.trip(trip.id), trip);
      invalidateTripCaches(queryClient, undefined);
    },
  });
}

/**
 * The rate-limit guard answers 429 with a non-ProblemDetails body, so the retry
 * delay has to come from the `Retry-After` header instead of `problem.errors`.
 */
export class PlaceSearchRateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Place search is rate limited. Retry in ${retryAfterSeconds}s.`);
    this.name = "PlaceSearchRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface PlaceSearchOutcome {
  items: Place[];
  degraded: boolean;
  cached: boolean;
  provider: PlaceSearchResponse["provider"];
}

function retryAfterSecondsFrom(headers: Headers): number {
  const raw = headers.get("retry-after");
  const seconds = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return 30;
  return Math.ceil(seconds);
}

export async function searchPlacesForTripForm(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceSearchOutcome> {
  const result = await searchPlacesRequest({ q: query, limit: 6 }, { signal });
  if (result.status === 429) {
    throw new PlaceSearchRateLimitError(retryAfterSecondsFrom(result.headers));
  }
  if (result.status >= 400) {
    throw errorFromResponse(result.status, result.data, "/v1/places/search");
  }
  const parsed = PlaceSearchResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw invalidResponse("/v1/places/search", parsed.error.issues[0]?.message);
  }
  return {
    items: parsed.data.items,
    degraded: parsed.data.degraded,
    cached: parsed.data.cached,
    provider: parsed.data.provider,
  };
}
