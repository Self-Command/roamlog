"use client";

import type { Trip, WorkspaceWithRole } from "@roamlog/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { ApiError, isForbidden, isVersionConflict } from "@/lib/api";
import { queryKeys } from "@/lib/query";

import { roleLabel, tripCapabilities, type TripCapabilities } from "./capabilities";
import { toApiError, tripWorkspaceQueryKeys } from "./queries";

export interface WorkspaceMutationRequest<T> {
  /** Entity label shown by the 409 conflict dialog, e.g. 「这笔支出」. */
  label: string;
  /** Performs the network call. Must throw on failure (`assertMutationOk`). */
  execute: () => Promise<T>;
  /**
   * Re-runs the same change after the caller refreshed the entity version.
   * `ConflictDialog`'s 「覆盖保存」 calls this; without it the dialog reloads
   * instead of silently dropping the user's edit.
   */
  retryAfterConflict?: () => Promise<T>;
  /** Message shown when the server answers `403`. */
  forbidden: string;
  /** Message shown for any other failure. */
  failure: string;
}

export interface WorkspaceConflict {
  label: string;
  retry?: () => Promise<unknown>;
}

interface TripWorkspaceContextValue {
  trip: Trip;
  workspace: WorkspaceWithRole;
  workspaceSlug: string;
  role: string;
  capabilities: TripCapabilities;
  pending: boolean;
  error: string | null;
  conflict: WorkspaceConflict | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  mutate: <T>(request: WorkspaceMutationRequest<T>) => Promise<T | null>;
  resolveConflict: (mode: "reload" | "overwrite") => Promise<void>;
  dismissConflict: () => void;
}

const TripWorkspaceContext = createContext<TripWorkspaceContextValue | null>(null);

export function useTripWorkspace(): TripWorkspaceContextValue {
  const value = useContext(TripWorkspaceContext);
  if (!value) {
    throw new Error("useTripWorkspace must be used inside <TripWorkspaceProvider>.");
  }
  return value;
}

/** Same message the workspace shows for a `403`, reused by disabled controls. */
export function forbiddenMessage(role: string, action: string): string {
  return `${roleLabel(role)} 角色不能${action}。`;
}

function describeFailure(error: ApiError, fallback: string): string {
  if (error.status === 0) {
    return `网络中断，操作没有保存。${error.message}`;
  }
  return error.problem?.detail ?? fallback;
}

export function TripWorkspaceProvider({
  trip,
  workspace,
  workspaceSlug,
  children,
}: {
  trip: Trip;
  workspace: WorkspaceWithRole;
  workspaceSlug: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<WorkspaceConflict | null>(null);

  const capabilities = useMemo(() => tripCapabilities(workspace.role), [workspace.role]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(trip.id) }),
      queryClient.invalidateQueries({ queryKey: ["v1", "trips"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tripEntries(trip.id) }),
      ...tripWorkspaceQueryKeys(trip.id).map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    ]);
  }, [queryClient, trip.id]);

  const mutate = useCallback(
    async <T,>(request: WorkspaceMutationRequest<T>): Promise<T | null> => {
      setError(null);
      setPending(true);
      try {
        const result = await request.execute();
        await refresh();
        return result;
      } catch (cause) {
        const failure = toApiError(cause, request.label);
        if (isVersionConflict(failure)) {
          setConflict({ label: request.label, retry: request.retryAfterConflict });
          return null;
        }
        setError(
          isForbidden(failure)
            ? request.forbidden
            : describeFailure(failure, request.failure),
        );
        return null;
      } finally {
        setPending(false);
      }
    },
    [refresh],
  );

  const resolveConflict = useCallback(
    async (mode: "reload" | "overwrite") => {
      const current = conflict;
      setConflict(null);
      if (mode === "reload" || !current?.retry) {
        await refresh();
        return;
      }

      setPending(true);
      try {
        await current.retry();
        await refresh();
      } catch (cause) {
        const failure = toApiError(cause, current.label);
        if (isVersionConflict(failure)) {
          setConflict(current);
          return;
        }
        setError(describeFailure(failure, "覆盖保存失败，请重新加载后再试。"));
      } finally {
        setPending(false);
      }
    },
    [conflict, refresh],
  );

  const value = useMemo<TripWorkspaceContextValue>(
    () => ({
      trip,
      workspace,
      workspaceSlug,
      role: workspace.role,
      capabilities,
      pending,
      error,
      conflict,
      clearError: () => {
        setError(null);
      },
      refresh,
      mutate,
      resolveConflict,
      dismissConflict: () => {
        setConflict(null);
      },
    }),
    [capabilities, conflict, error, mutate, pending, refresh, resolveConflict, trip, workspace, workspaceSlug],
  );

  return <TripWorkspaceContext.Provider value={value}>{children}</TripWorkspaceContext.Provider>;
}