"use client";

import {
  getGetBudgetSummaryQueryKey,
  getListExpensesQueryKey,
  getListPackingQueryKey,
  getListShareLinksQueryKey,
  getListStopsQueryKey,
  getListTripActivityQueryKey,
  getListTripMediaQueryKey,
  getListTripParticipantsQueryKey,
  listExpenses,
  listPacking,
  listStops,
  useGetBudgetSummary,
  useListExpenses,
  useListPacking,
  useListShareLinks,
  useListStops,
  useListTripActivity,
  useListTripMedia,
  useListTripParticipants,
} from "@roamlog/api-client";
import {
  ProblemDetailsSchema,
  type BudgetSummary,
  type ExpensePage,
  type MediaPage,
  type PackingPage,
  type ShareLink,
  type Stop,
  type TripActivityPage,
  type TripParticipant,
} from "@roamlog/contracts";

import { ApiError } from "@/lib/api";

/**
 * Scoped data access for the trip workspace.
 *
 * Why this file exists: `apps/web/lib/query.ts` only wires trips, itinerary,
 * entries, comments, members, activity and auth. The trip workbench needs stops,
 * expenses, packing, media, share links, participants and the budget summary,
 * which `lib/query.ts` does not expose (and that file is owned by another task).
 *
 * Everything below calls the **generated** client hooks from
 * `@roamlog/api-client`, i.e. the real OpenAPI endpoints. Two properties of the
 * generated client matter here and are compensated deliberately:
 *
 * 1. Orval returns `{ status, data }` and never throws for 4xx/5xx. Treating a
 *    `403` body as data would render `undefined` rows, so every result is
 *    normalised into `loading | error | ready` with a real `ApiError`.
 * 2. Generated mutations do not invalidate caches. `tripWorkspaceQueryKeys`
 *    below lists exactly the generated query keys for one trip so the workspace
 *    can refresh them after a mutation.
 */

export type AsyncResult<T> =
  | { state: "loading" }
  | { state: "error"; error: ApiError; retry: () => void }
  | { state: "ready"; data: T };

interface QueryEnvelope {
  status: number;
  data: unknown;
}

/** Structural view of a generated `useQuery` result. */
interface SettledQuery {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: QueryEnvelope | undefined;
  refetch: () => Promise<unknown>;
}

function problemFrom(body: unknown) {
  const parsed = ProblemDetailsSchema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
}

export function failureFrom(
  status: number,
  body: unknown,
  _path: string,
  fallback?: string,
): ApiError {
  const problem = problemFrom(body);
  return new ApiError(
    status,
    problem?.detail ?? problem?.title ?? fallback ?? "读取失败，请稍后重试。",
    problem?.code ?? (status === 401 ? "UNAUTHORIZED" : "API_REQUEST_FAILED"),
    problem,
  );
}

export function toApiError(error: unknown, _path: string): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, "网络连接失败，请稍后重试。", "NETWORK_ERROR");
}

/**
 * Turns an Orval envelope into a settled result. A `4xx`/`5xx` envelope becomes
 * an error state, never "empty data".
 */
function settle<T>(query: SettledQuery, path: string): AsyncResult<T> {
  const retry = () => {
    void query.refetch();
  };

  if (query.isError) {
    return { state: "error", error: toApiError(query.error, path), retry };
  }
  if (query.data === undefined) {
    return { state: "loading" };
  }
  if (query.data.status >= 400) {
    return { state: "error", error: failureFrom(query.data.status, query.data.data, path), retry };
  }
  return { state: "ready", data: query.data.data as T };
}

/** Throws `ApiError` when a generated mutation answered `4xx`/`5xx`. */
export function assertMutationOk(result: { status: number; data: unknown }, path: string): void {
  if (result.status >= 400) {
    throw failureFrom(result.status, result.data, path);
  }
}

export const tripWorkspaceKeys = {
  stops: (tripId: string) => getListStopsQueryKey(tripId),
  expenses: (tripId: string) => getListExpensesQueryKey(tripId),
  packing: (tripId: string) => getListPackingQueryKey(tripId),
  media: (tripId: string) => getListTripMediaQueryKey(tripId),
  shareLinks: (tripId: string) => getListShareLinksQueryKey(tripId),
  participants: (tripId: string) => getListTripParticipantsQueryKey(tripId),
  activity: (tripId: string) => getListTripActivityQueryKey(tripId),
  budget: (tripId: string) => getGetBudgetSummaryQueryKey(tripId),
};

/** Every generated query key the workspace renders, for one trip. */
export function tripWorkspaceQueryKeys(tripId: string): readonly (readonly unknown[])[] {
  return [
    tripWorkspaceKeys.stops(tripId),
    tripWorkspaceKeys.expenses(tripId),
    tripWorkspaceKeys.packing(tripId),
    tripWorkspaceKeys.media(tripId),
    tripWorkspaceKeys.shareLinks(tripId),
    tripWorkspaceKeys.participants(tripId),
    tripWorkspaceKeys.activity(tripId),
    tripWorkspaceKeys.budget(tripId),
  ];
}

const STALE_TIME = 15_000;

export function useStops(tripId: string): AsyncResult<Stop[]> {
  const query = useListStops(tripId, { query: { staleTime: STALE_TIME } });
  return settle<Stop[]>(query, `/v1/trips/${tripId}/stops`);
}

export function useExpenses(tripId: string): AsyncResult<ExpensePage> {
  const query = useListExpenses(
    tripId,
    { limit: 100, sort: "date:desc" },
    { query: { staleTime: STALE_TIME } },
  );
  return settle<ExpensePage>(query, `/v1/trips/${tripId}/expenses`);
}

export function usePacking(tripId: string): AsyncResult<PackingPage> {
  const query = useListPacking(
    tripId,
    { limit: 100, sort: "order:asc" },
    { query: { staleTime: STALE_TIME } },
  );
  return settle<PackingPage>(query, `/v1/trips/${tripId}/packing`);
}

export function useTripMedia(tripId: string): AsyncResult<MediaPage> {
  const query = useListTripMedia(
    tripId,
    { limit: 100, sort: "createdAt:desc" },
    { query: { staleTime: STALE_TIME } },
  );
  return settle<MediaPage>(query, `/v1/trips/${tripId}/media`);
}

export function useShareLinks(tripId: string): AsyncResult<ShareLink[]> {
  const query = useListShareLinks(tripId, { query: { staleTime: STALE_TIME } });
  return settle<ShareLink[]>(query, `/v1/trips/${tripId}/share-links`);
}

export function useParticipants(tripId: string): AsyncResult<TripParticipant[]> {
  const query = useListTripParticipants(tripId, { query: { staleTime: STALE_TIME } });
  return settle<TripParticipant[]>(query, `/v1/trips/${tripId}/participants`);
}

export function useBudgetSummary(tripId: string): AsyncResult<BudgetSummary> {
  const query = useGetBudgetSummary(tripId, { query: { staleTime: STALE_TIME } });
  return settle<BudgetSummary>(query, `/v1/trips/${tripId}/budget/summary`);
}

export function useTripActivityItems(tripId: string): AsyncResult<TripActivityPage> {
  const query = useListTripActivity(
    tripId,
    { limit: 50, sort: "createdAt:desc" },
    { query: { staleTime: STALE_TIME } },
  );
  return settle<TripActivityPage>(query, `/v1/trips/${tripId}/activity`);
}

/**
 * Re-reads one entity's current `version` to retry a `409` conflict.
 *
 * `ConflictDialog`'s 「覆盖保存」 must write onto the version the server has now;
 * reading it from a fresh GET is the only honest way to do that. Returns `null`
 * when the entity is gone or the read failed, in which case the caller aborts
 * instead of guessing a version.
 */
export async function latestStopVersion(tripId: string, stopId: string): Promise<number | null> {
  const response = await listStops(tripId);
  if (response.status !== 200) return null;
  return response.data.find((stop) => stop.id === stopId)?.version ?? null;
}

export async function latestExpenseVersion(
  tripId: string,
  expenseId: string,
): Promise<number | null> {
  const response = await listExpenses(tripId, { limit: 100 });
  if (response.status !== 200) return null;
  return response.data.items.find((expense) => expense.id === expenseId)?.version ?? null;
}

export async function latestPackingVersion(
  tripId: string,
  itemId: string,
): Promise<number | null> {
  const response = await listPacking(tripId, { limit: 100 });
  if (response.status !== 200) return null;
  return response.data.items.find((item) => item.id === itemId)?.version ?? null;
}
