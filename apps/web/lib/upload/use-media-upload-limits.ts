"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getMediaUploadLimits,
  type MediaUploadLimits,
} from "@/lib/api/media";

/**
 * Server-owned batch-upload limits for one workspace.
 *
 * The endpoint is admin-configurable, so every number the upload UI shows comes
 * from here; nothing is restated in the client. `getMediaUploadLimits` resolves
 * `null` when the endpoint is unavailable, which is a normal state during the
 * rollout — the picker stays usable and the copy simply omits numbers.
 */
export const mediaUploadLimitsQueryKey = (workspaceId: string) =>
  ["v1", "workspaces", workspaceId, "media", "limits"] as const;

const LIMITS_STALE_TIME_MS = 30_000;

export interface UseMediaUploadLimitsResult {
  limits: MediaUploadLimits | null;
  isLoading: boolean;
  refresh: () => void;
}

export function useMediaUploadLimits(
  workspaceId: string,
  options: { enabled?: boolean } = {},
): UseMediaUploadLimitsResult {
  const query = useQuery({
    queryKey: mediaUploadLimitsQueryKey(workspaceId),
    queryFn: () => getMediaUploadLimits(workspaceId),
    enabled: options.enabled ?? true,
    staleTime: LIMITS_STALE_TIME_MS,
    retry: false,
  });
  return {
    limits: query.data ?? null,
    isLoading: query.isPending,
    refresh: () => {
      void query.refetch();
    },
  };
}