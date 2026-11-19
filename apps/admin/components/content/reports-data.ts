"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  AdminReportDetailSchema,
  AdminReportPageSchema,
  ResolveReportResponseSchema,
  type AdminReportDetail,
  type AdminReportPage,
  type ModerationActionKind,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
  type ResolveReportResponse,
} from "@roamlog/contracts";

import { AdminMutationError, toAdminApiFailure, type AdminApiFailure } from "../../lib/admin-api-error";

export interface AdminReportsParams {
  status?: ReportStatus;
  targetType?: ReportTargetType;
  reason?: ReportReason;
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ResolveReportInput {
  id: string;
  action: ModerationActionKind;
  note?: string;
}

function reportsUrl(params: AdminReportsParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `/v1/admin/reports?${query}` : "/v1/admin/reports";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function adminJson<T>(url: string, schema: { parse: (value: unknown) => T }): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  const data = text ? parseJson(text) : null;

  if (response.status < 200 || response.status >= 300) {
    throw new AdminMutationError(toAdminApiFailure(response.status, data, response.headers));
  }
  if (data === null) {
    throw new AdminMutationError({
      code: "ADMIN_RESPONSE_INVALID",
      status: response.status,
      title: "Admin API response was not JSON",
      detail: "The Admin API returned an empty or malformed response.",
      degraded: [],
    });
  }

  try {
    return schema.parse(data);
  } catch (error) {
    throw new AdminMutationError({
      code: "ADMIN_RESPONSE_INVALID",
      status: response.status,
      title: "Admin API response did not match the contract",
      detail: error instanceof Error ? error.message : "The Admin API response could not be parsed.",
      degraded: [],
    });
  }
}

async function resolveReport(input: ResolveReportInput): Promise<ResolveReportResponse> {
  const response = await fetch(`/v1/admin/reports/${encodeURIComponent(input.id)}/resolve`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      action: input.action,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    }),
  });
  const text = await response.text();
  const data = text ? parseJson(text) : null;

  if (response.status < 200 || response.status >= 300) {
    throw new AdminMutationError(toAdminApiFailure(response.status, data, response.headers));
  }
  if (data === null) {
    throw new AdminMutationError({
      code: "ADMIN_RESPONSE_INVALID",
      status: response.status,
      title: "Admin API response was not JSON",
      detail: "The Admin API returned an empty or malformed response.",
      degraded: [],
    });
  }
  return ResolveReportResponseSchema.parse(data);
}

export function useAdminReports(params: AdminReportsParams) {
  return useQuery<AdminReportPage, AdminMutationError>({
    queryKey: ["admin", "reports", params],
    queryFn: () => adminJson(reportsUrl(params), AdminReportPageSchema),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAdminReportDetail(id: string | null) {
  return useQuery<AdminReportDetail, AdminMutationError>({
    queryKey: ["admin", "reports", "detail", id],
    queryFn: () => adminJson(`/v1/admin/reports/${encodeURIComponent(id ?? "")}`, AdminReportDetailSchema),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useResolveReport(onResolved?: () => void) {
  const queryClient = useQueryClient();
  return useMutation<ResolveReportResponse, AdminMutationError, ResolveReportInput>({
    mutationFn: resolveReport,
    onSuccess: () => {
      // Re-pull the queue so the row leaves / re-enters the active tab with the
      // server's status, instead of patching a single local row.
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
      onResolved?.();
    },
  });
}

export function reportFailure(error: unknown): AdminApiFailure | null {
  if (error instanceof AdminMutationError) {
    return error.failure;
  }
  if (error instanceof Error) {
    return {
      code: "ADMIN_API_NETWORK",
      status: 0,
      title: "Admin API unavailable",
      detail: error.message,
      degraded: [],
    };
  }
  return null;
}