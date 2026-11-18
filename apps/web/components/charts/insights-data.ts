"use client";

import type { ExpenseWithSplits, JournalEntry } from "@roamlog/contracts";
import { useQueries, useQuery } from "@tanstack/react-query";

import { useDataAdapter } from "@/lib/data-provider";
import { useTripsQuery, useWorkspaceBySlug } from "@/lib/query";

interface CollectedPage<T> {
  items: T[];
  truncated: boolean;
}

async function collectPages<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ items: T[]; nextCursor: string | null; hasMore: boolean }>,
  maxPages = 20,
): Promise<CollectedPage<T>> {
  const items: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.hasMore) return { items, truncated: false };
    if (!result.nextCursor || result.nextCursor === cursor) {
      return { items, truncated: true };
    }
    cursor = result.nextCursor;
  }

  return { items, truncated: true };
}

export function useInsightsData(workspaceSlug: string) {
  const adapter = useDataAdapter();
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripsQuery = useTripsQuery(workspace?.id, { limit: 100 });
  const trips = tripsQuery.data?.items ?? [];
  const workspaceId = workspace?.id;

  const entriesQuery = useQuery({
    queryKey: ["v1", "insights", "entries", workspaceId],
    queryFn: ({ signal }) =>
      collectPages((cursor) =>
        adapter.fetchEntries(
          workspaceId ?? "",
          { limit: 100, ...(cursor ? { cursor } : {}) },
          signal,
        ),
      ),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    retry: 1,
  });

  const expenseQueries = useQueries({
    queries: trips.map((trip) => ({
      queryKey: ["v1", "insights", "expenses", trip.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        collectPages((cursor) =>
          adapter.fetchExpenses(trip.id, { limit: 100, ...(cursor ? { cursor } : {}) }, signal),
        ),
      staleTime: 30_000,
      retry: 1,
    })),
  });

  const entries = entriesQuery.data?.items ?? [];
  const expenses = expenseQueries.flatMap(
    (query) => query.data?.items ?? ([] as ExpenseWithSplits[]),
  );
  const secondaryLoading = entriesQuery.isPending || expenseQueries.some((query) => query.isPending);
  const secondaryError =
    (entriesQuery.error as Error | null) ??
    (expenseQueries.find((query) => query.error)?.error as Error | undefined) ??
    null;
  const truncated =
    (entriesQuery.data?.truncated ?? false) || expenseQueries.some((query) => query.data?.truncated);

  function retrySecondary() {
    void entriesQuery.refetch();
    for (const query of expenseQueries) void query.refetch();
  }

  return {
    workspace,
    workspacesQuery,
    tripsQuery,
    trips,
    tripsTruncated: tripsQuery.data?.hasMore ?? false,
    entries: entries as JournalEntry[],
    expenses,
    secondaryLoading,
    secondaryError,
    truncated,
    retrySecondary,
  };
}