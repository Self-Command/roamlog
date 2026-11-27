import {
  exportAdminAuditCsv,
  resendAdminEmail,
  useClearAdminQueue,
  useDeleteAdminContent,
  useDeleteAdminMedia,
  useDeleteAdminUser,
  useDeleteAdminWorkspace,
  useForceLogoutAdminUser,
  useGetAdminMetrics,
  useGetAdminSystem,
  useListAdminAudit,
  useListAdminEmails,
  useListAdminFlags,
  useListAdminJobs,
  useListAdminMedia,
  useListAdminUsers,
  useListAdminWorkspaces,
  usePauseAdminQueue,
  useResetAdminUserTwoFactor,
  useRestoreAdminContent,
  useResumeAdminQueue,
  useRetryAdminJob,
  useUpdateAdminFlag,
  useUpdateAdminUser,
  useUpdateAdminWorkspace,
  type AdminEmailPageItemsItem,
  type AdminFlagListResponseItem,
  type AdminJobPageItemsItem,
  type AdminMediaPageItemsItem,
  type AdminSystem,
  type AdminUserPageItemsItem,
  type AdminWorkspacePageItemsItem,
  type ExportAdminAuditCsvParams,
  type UpdateAdminUserRequest,
  type UpdateAdminWorkspaceRequest,
} from "@roamlog/api-client";
import {
  AdminTripPageSchema,
  AdminUserDetailSchema,
  AdminUserPageSchema,
  AdminWorkspaceDetailSchema,
  AdminWorkspacePageSchema,
  type AdminTripPage,
  type AdminUserDetail,
  type AdminUserListItem,
  type AdminUserPage,
  type AdminWorkspaceDetail,
  type AdminWorkspaceListItem,
  type AdminWorkspacePage,
  type AccountStatus,
  type PlatformRole,
  type WorkspacePlan,
} from "@roamlog/contracts";
import type {
  AdminMetrics,
  AuditLog,
  EmailStatus,
  MediaStatus,
} from "@roamlog/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  assertAdminResponse,
  toAdminApiFailure,
  AdminMutationError,
  type AdminApiFailure,
} from "./admin-api-error";
import { type AdminDashboardData } from "./admin-types";
import {
  type AdminEmailRecord,
  type AdminFailedJob,
  type AdminFlagRecord,
  type AdminMediaItem,
  type AdminQueueSummary,
  type AdminSystemSnapshot,
} from "./admin-ops-types";

export interface AdminResource<T> {
  data: T | null;
  isLoading: boolean;
  error: AdminApiFailure | null;
  degraded: string[];
  refetch: () => void;
}

type ApiEnvelope<T> = {
  status: number;
  data: T;
  headers: Headers;
};

type ApiQuery<T> = {
  data?: ApiEnvelope<T>;
  error: unknown;
  isLoading: boolean;
  isFetching?: boolean;
  refetch: () => unknown;
};

function networkFailure(): AdminApiFailure {
  return {
    code: "ADMIN_API_NETWORK",
    status: 0,
    title: "后台服务暂时不可用",
    detail: "后台服务暂时没有响应，请稍后重试。",
    degraded: [],
  };
}

function failureFromQuery<T>(query: ApiQuery<T>): AdminApiFailure | null {
  if (query.error) {
    return networkFailure();
  }
  if (query.data && query.data.status >= 400) {
    return toAdminApiFailure(query.data.status, query.data.data, query.data.headers);
  }
  return null;
}

function dataOf<T>(query: ApiQuery<unknown>, fallback: T): T {
  return query.data && query.data.status < 300 ? (query.data.data as T) : fallback;
}

function itemsOf<T>(query: ApiQuery<unknown>): readonly T[] {
  return dataOf<{ items: T[] }>(query, { items: [] }).items;
}

function degradedFromQueries(queries: readonly ApiQuery<unknown>[]): string[] {
  return [
    ...new Set(
      queries.flatMap((query) =>
        (query.data?.headers.get("x-roamlog-degraded") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ),
  ];
}

function combineResources<T>(
  queries: readonly ApiQuery<unknown>[],
  map: () => T,
): AdminResource<T> {
  const error = queries.map(failureFromQuery).find((value) => value !== null) ?? null;
  const isReady = queries.every((query) => query.data && query.data.status < 300);
  const isLoading = queries.some((query) => query.isLoading);

  return {
    data: !error && isReady ? map() : null,
    isLoading,
    error,
    degraded: degradedFromQueries(queries),
    refetch: () => {
      for (const query of queries) {
        void query.refetch();
      }
    },
  };
}

interface AdminQueryLike<T> {
  data?: T;
  error: unknown;
  isLoading: boolean;
  refetch: () => unknown;
}

function queryResource<T>(
  query: AdminQueryLike<T>,
  fallback: T | null = null,
): AdminResource<T> {
  const error = query.error
    ? query.error instanceof AdminMutationError
      ? query.error.failure
      : networkFailure()
    : null;

  return {
    data: error ? null : (query.data ?? fallback),
    isLoading: query.isLoading,
    error,
    degraded: [],
    refetch: () => {
      void query.refetch();
    },
  };
}

function adminUrl(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function adminJsonRequest<T>(
  url: string,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  const data = text ? parseJson(text) : null;

  if (response.status < 200 || response.status >= 300) {
    throw new AdminMutationError(toAdminApiFailure(response.status, data, response.headers));
  }
  if (data === null) {
    throw new AdminMutationError({
      code: "ADMIN_RESPONSE_INVALID",
      status: response.status,
      title: "后台服务返回了无法识别的数据",
      detail: "后台服务没有返回可读取的数据，请稍后重试。",
      degraded: [],
    });
  }

  try {
    return schema.parse(data);
  } catch {
    throw new AdminMutationError({
      code: "ADMIN_RESPONSE_INVALID",
      status: response.status,
      title: "后台服务返回了无法识别的数据",
      detail: "后台服务返回的数据格式不正确，请稍后重试。",
      degraded: [],
    });
  }
}

/**
 * Same-origin write helper for Admin endpoints that the generated client does
 * not cover yet (feature flag create/delete). Errors surface as
 * `AdminMutationError`, exactly like the generated mutations.
 */
async function adminJsonMutation(
  path: string,
  method: "POST" | "DELETE",
  body: unknown,
): Promise<unknown> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const data = text ? parseJson(text) : null;

  if (response.status < 200 || response.status >= 300) {
    throw new AdminMutationError(toAdminApiFailure(response.status, data, response.headers));
  }

  return data;
}

export interface AdminUserListParams {
  q?: string;
  status?: AccountStatus;
  platformRole?: PlatformRole;
  sort?: string;
  cursor?: string;
  limit?: number;
}

export interface AdminWorkspaceListParams {
  q?: string;
  status?: AccountStatus;
  plan?: WorkspacePlan;
  sort?: string;
  cursor?: string;
  limit?: number;
}

export function adminUsersExportUrl(params: AdminUserListParams): string {
  return adminUrl("/v1/admin/users/export", {
    q: params.q,
    status: params.status,
    platformRole: params.platformRole,
    sort: params.sort,
  });
}

export function adminWorkspacesExportUrl(params: AdminWorkspaceListParams): string {
  return adminUrl("/v1/admin/workspaces/export", {
    q: params.q,
    status: params.status,
    plan: params.plan,
    sort: params.sort,
  });
}

export function useAdminUsersPage(
  params: AdminUserListParams,
  enabled = true,
): AdminResource<AdminUserPage> {
  const query = useQuery({
    queryKey: ["admin", "users", "page", params],
    queryFn: () =>
      adminJsonRequest(
        adminUrl("/v1/admin/users", {
          q: params.q,
          status: params.status,
          platformRole: params.platformRole,
          sort: params.sort,
          cursor: params.cursor,
          limit: params.limit,
        }),
        AdminUserPageSchema,
      ),
    enabled,
  });

  return queryResource<AdminUserPage>(query);
}

export function useAdminUserDetail(
  userId: string | null,
  enabled = true,
): AdminResource<AdminUserDetail> {
  const query = useQuery({
    queryKey: ["admin", "users", "detail", userId],
    queryFn: () =>
      adminJsonRequest(
        adminUrl(`/v1/admin/users/${encodeURIComponent(userId ?? "")}`),
        AdminUserDetailSchema,
      ),
    enabled: enabled && Boolean(userId),
  });

  return queryResource<AdminUserDetail>(query);
}

export function useAdminWorkspacesPage(
  params: AdminWorkspaceListParams,
  enabled = true,
): AdminResource<AdminWorkspacePage> {
  const query = useQuery({
    queryKey: ["admin", "workspaces", "page", params],
    queryFn: () =>
      adminJsonRequest(
        adminUrl("/v1/admin/workspaces", {
          q: params.q,
          status: params.status,
          plan: params.plan,
          sort: params.sort,
          cursor: params.cursor,
          limit: params.limit,
        }),
        AdminWorkspacePageSchema,
      ),
    enabled,
  });

  return queryResource<AdminWorkspacePage>(query);
}

export function useAdminWorkspaceDetail(
  workspaceId: string | null,
  enabled = true,
): AdminResource<AdminWorkspaceDetail> {
  const query = useQuery({
    queryKey: ["admin", "workspaces", "detail", workspaceId],
    queryFn: () =>
      adminJsonRequest(
        adminUrl(`/v1/admin/workspaces/${encodeURIComponent(workspaceId ?? "")}`),
        AdminWorkspaceDetailSchema,
      ),
    enabled: enabled && Boolean(workspaceId),
  });

  return queryResource<AdminWorkspaceDetail>(query);
}

export function useAdminWorkspaceTrips(
  workspaceId: string | null,
  enabled = true,
): AdminResource<AdminTripPage> {
  const query = useQuery({
    queryKey: ["admin", "workspaces", "trips", workspaceId],
    queryFn: () =>
      adminJsonRequest(
        adminUrl("/v1/admin/trips", {
          workspaceId: workspaceId ?? undefined,
          limit: 5,
          sort: "updatedAt:desc",
        }),
        AdminTripPageSchema,
      ),
    enabled: enabled && Boolean(workspaceId),
  });

  return queryResource<AdminTripPage>(query);
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** CSV generation for on-demand downloads; the API also serves a server-generated export. */
export function buildAdminCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadCsvText(content: string, filename: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export async function downloadAdminCsv(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url, { headers: { Accept: "text/csv" } });
  const text = await response.text();

  if (response.status < 200 || response.status >= 300) {
    const data = text ? parseJson(text) : null;
    throw new AdminMutationError(toAdminApiFailure(response.status, data, response.headers));
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackName;
  downloadCsvText(text, filename);
}

export type AdminDashboardSourceStatus = "ready" | "loading" | "error";

export interface AdminDashboardSourceState {
  status: AdminDashboardSourceStatus;
  error: AdminApiFailure | null;
  refetch: () => void;
}

export interface AdminDashboardSources {
  metrics: AdminDashboardSourceState;
  emails: AdminDashboardSourceState;
  audit: AdminDashboardSourceState;
}

export interface AdminDashboardResourceData extends AdminDashboardData {
  sources: AdminDashboardSources;
}

const AUTH_FAILURE_CODES = new Set([
  "ADMIN_ACCESS_DENIED",
  "ADMIN_ACTION_FORBIDDEN",
  "ADMIN_2FA_REQUIRED",
  "UNAUTHENTICATED",
]);

const EMPTY_EMAIL_COUNTS: Record<EmailStatus, number> = {
  queued: 0,
  sent: 0,
  delivered: 0,
  bounced: 0,
  complained: 0,
  failed: 0,
};

const EMPTY_ADMIN_METRICS: AdminMetrics = {
  users: { total: 0, active: 0, suspended: 0, new24h: 0 },
  workspaces: { total: 0, active: 0, suspended: 0, new24h: 0 },
  trips: 0,
  entries: 0,
  comments: 0,
  media: { count: 0, bytes: 0 },
  exports: { queued: 0, processing: 0, ready: 0, failed: 0, expired: 0 },
  emails: EMPTY_EMAIL_COUNTS,
  queues: [],
  generatedAt: new Date(0).toISOString(),
};

function dashboardSourceState(query: ApiQuery<unknown>): AdminDashboardSourceState {
  const error = failureFromQuery(query);
  const refetch = () => {
    void query.refetch();
  };

  if (error) {
    return { status: "error", error, refetch };
  }
  if (query.data && query.data.status < 300) {
    return { status: "ready", error: null, refetch };
  }
  return { status: "loading", error: null, refetch };
}

function combineDashboardResources(
  queries: {
    metrics: ApiQuery<unknown>;
    emails: ApiQuery<unknown>;
    audit: ApiQuery<unknown>;
  },
  map: () => AdminDashboardData,
): AdminResource<AdminDashboardResourceData> {
  const sources = {
    metrics: dashboardSourceState(queries.metrics),
    emails: dashboardSourceState(queries.emails),
    audit: dashboardSourceState(queries.audit),
  } satisfies AdminDashboardSources;
  const failures = Object.values(sources).flatMap((source) =>
    source.error ? [source.error] : [],
  );
  const authFailure = failures.find((failure) => AUTH_FAILURE_CODES.has(failure.code));
  const allFailed = Object.values(sources).every((source) => source.status === "error");
  const fatalError = authFailure ?? (allFailed ? (failures[0] ?? null) : null);

  return {
    data: fatalError ? null : { ...map(), sources },
    isLoading: Object.values(queries).every((query) => query.isLoading),
    error: fatalError,
    degraded: degradedFromQueries(Object.values(queries)),
    refetch: () => {
      for (const query of Object.values(queries)) {
        void query.refetch();
      }
    },
  };
}

function workspaceName(
  workspaceId: string,
  workspaces: readonly AdminWorkspacePageItemsItem[],
): string {
  return (
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId.slice(-8)
  );
}

function mediaVariantUrl(variants: unknown): string | null {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) {
    return null;
  }
  const record = variants as Record<string, unknown>;
  for (const name of ["thumb", "medium", "large", "original"]) {
    const variant = record[name];
    if (
      variant &&
      typeof variant === "object" &&
      !Array.isArray(variant) &&
      typeof (variant as Record<string, unknown>).url === "string"
    ) {
      const url = (variant as Record<string, unknown>).url;
      if (typeof url === "string" && url.length > 0) {
        return url;
      }
    }
  }
  return null;
}

function userName(userId: string | null, users: readonly AdminUserPageItemsItem[]): string {
  if (!userId) {
    return "Unknown user";
  }
  return users.find((user) => user.id === userId)?.name ?? userId.slice(-8);
}

export function mapAdminUsers(
  users: readonly AdminUserListItem[],
): readonly AdminUserListItem[] {
  // Detail counters are only authoritative on GET /admin/users/:id. The list
  // response ships no invented zeros, so keep the rows exactly as served.
  return users;
}

export function mapAdminWorkspaces(
  workspaces: readonly AdminWorkspacePageItemsItem[],
  users: readonly AdminUserPageItemsItem[],
): readonly AdminWorkspaceDetail[] {
  return workspaces.map((workspace) => {
    const owner = users.find((user) => user.id === workspace.ownerId);
    return {
      ...workspace,
      memberCount: 0,
      tripCount: 0,
      entryCount: 0,
      owner: {
        id: workspace.ownerId,
        name: owner?.name ?? workspace.ownerId.slice(-8),
        email: owner?.email ?? "unknown@roamlog.local",
        image: owner?.image ?? null,
      },
    };
  });
}


export function mapAdminMedia(
  media: readonly AdminMediaPageItemsItem[],
  workspaces: readonly AdminWorkspacePageItemsItem[],
): readonly AdminMediaItem[] {
  return media.map((item) => ({
    id: item.id,
    fileName: item.originalFileName ?? item.key.split("/").at(-1) ?? item.key,
    workspaceId: item.workspaceId,
    workspaceName: workspaceName(item.workspaceId, workspaces),
    mimeType: item.mimeType,
    sizeBytes: item.size,
    status: item.status as MediaStatus,
    usage: item.tripId === null ? "orphan" : "linked",
    thumbnailUrl: mediaVariantUrl(item.variants),
    caption: item.caption,
    createdAt: item.createdAt,
    deletedAt: item.deletedAt,
  }));
}

export function mapAdminEmails(
  emails: readonly AdminEmailPageItemsItem[],
): readonly AdminEmailRecord[] {
  return emails.map((email) => ({
    id: email.id,
    to: email.to,
    template: email.template,
    subject: email.subject,
    providerId: email.providerId,
    status: email.status as EmailStatus,
    error: email.error,
    createdAt: email.createdAt,
    updatedAt: email.updatedAt,
  }));
}

/**
 * Queue counters as served by `GET /v1/admin/metrics`. The extra operational
 * fields are declared locally so this module keeps type-checking before the
 * OpenAPI client is regenerated from `packages/contracts`.
 */
export interface AdminQueueMetricsRow {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  delayed?: number;
  paused: boolean;
  throughputPerMinute?: number | null;
  throughputWindowSeconds?: number | null;
  lastCompletedAt?: string | null;
  lastFailedAt?: string | null;
}

const QUEUE_LABELS: Record<string, string> = {
  media: "媒体处理",
  email: "邮件投递",
  export: "数据导出",
  reminders: "行程提醒",
  maintenance: "维护任务",
};

/** `NaN` marks "not wired": Redis could not produce a completion window. */
export const UNKNOWN_THROUGHPUT = Number.NaN;

export function mapAdminQueues(
  queues: readonly AdminQueueMetricsRow[],
): readonly AdminQueueSummary[] {
  return queues.map((queue) => ({
    name: queue.name,
    label: QUEUE_LABELS[queue.name] ?? queue.name,
    waiting: queue.waiting,
    active: queue.active,
    failed: queue.failed,
    completed: queue.completed,
    throughputPerMinute:
      typeof queue.throughputPerMinute === "number" && Number.isFinite(queue.throughputPerMinute)
        ? queue.throughputPerMinute
        : UNKNOWN_THROUGHPUT,
    paused: queue.paused,
  }));
}

export function formatThroughput(value: number): string {
  // A missing completion window is a value this console cannot read, not a
  // subsystem that failed to connect — "未接入" would misread as a broken queue.
  return Number.isFinite(value) ? `${value.toFixed(1)} 任务/分钟` : "暂不可用";
}

/**
 * Recipient addresses are personal data; the console only ever renders the
 * local-part initial plus the domain (`a***@domain`).
 */
export function maskEmail(value: string): string {
  const separator = value.lastIndexOf("@");
  if (separator <= 0) {
    return "***";
  }
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

export function mapAdminJobs(jobs: readonly AdminJobPageItemsItem[]): readonly AdminFailedJob[] {
  return jobs
    .filter((job) => job.status === "failed")
    .map((job) => ({
      id: job.id,
      queue: job.queue,
      name: job.name,
      attempts: job.attempts,
      failedReason: job.failedReason ?? "No failure reason was recorded.",
      payloadSummary: JSON.stringify(job.data),
      createdAt: job.createdAt,
      processedAt: job.processedAt,
    }));
}

export function mapAdminFlags(
  flags: readonly AdminFlagListResponseItem[],
  users: readonly AdminUserPageItemsItem[],
): readonly AdminFlagRecord[] {
  return flags.map((flag) => {
    const allowlist = flag.rules.workspaceAllowlist;
    return {
      key: flag.key,
      label: flag.key,
      description: flag.description,
      enabled: flag.enabled,
      rolloutPercentage: flag.rolloutPercentage,
      workspaceAllowlist: Array.isArray(allowlist)
        ? allowlist.filter((value): value is string => typeof value === "string")
        : [],
      updatedByName: userName(flag.updatedById, users),
      updatedAt: flag.updatedAt,
    };
  });
}

export interface AdminWorkerSignalDetail {
  signal: "consumer-clients" | "activity-derived" | "unavailable";
  consumers: number;
  blockedConsumers: number;
  lastJobAt: string | null;
  lastJobStatus: "completed" | "failed" | null;
  lastJobQueue: string | null;
}

export interface AdminSystemQueueRow {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

/**
 * Extra operational detail that the Admin console needs but that the base
 * snapshot type does not carry. Both fields are optional so an older snapshot
 * stays assignable; the system view reads them defensively.
 */
export interface AdminSystemSnapshotDetail extends AdminSystemSnapshot {
  workerSignal?: AdminWorkerSignalDetail | null;
  queues?: readonly AdminSystemQueueRow[];
}

type AdminSystemWorkerWire = AdminSystem["worker"] & {
  signal?: AdminWorkerSignalDetail["signal"];
  blockedConsumers?: number;
  lastJobAt?: string | null;
  lastJobStatus?: "completed" | "failed" | null;
  lastJobQueue?: string | null;
};

export function mapAdminSystem(system: AdminSystem): AdminSystemSnapshotDetail {
  const checks = Object.entries(system.checks).map(([name, value]) => ({
    name,
    status: value.status as "up" | "down",
    latencyMs: value.latencyMs,
    detail: `${name} 服务健康检查`,
  }));
  const migrations =
    system.migration.version && system.migration.appliedAt
      ? [
          {
            version: system.migration.version,
            name: "最近应用的迁移",
            appliedAt: system.migration.appliedAt,
            status: "applied" as const,
          },
        ]
      : [];
  const worker = system.worker as AdminSystemWorkerWire;

  return {
    apiVersion: system.version,
    workerVersion: worker.version,
    environment:
      system.environment === "production"
        ? "production"
        : system.environment === "staging"
          ? "staging"
          : "local",
    nodeVersion: system.nodeVersion,
    // An absent build timestamp must stay absent: the API no longer substitutes
    // the container start time, and the view renders "未接入" for empty values.
    buildTime: system.buildTime ?? "",
    startedAt: system.startedAt,
    uptimeSeconds: system.uptimeSeconds,
    workerStatus: worker.status,
    workerConsumers: worker.consumers,
    checks,
    migrations,
    workerSignal:
      worker.signal === undefined
        ? null
        : {
            signal: worker.signal,
            consumers: worker.consumers,
            blockedConsumers: worker.blockedConsumers ?? worker.consumers,
            lastJobAt: worker.lastJobAt ?? null,
            lastJobStatus: worker.lastJobStatus ?? null,
            lastJobQueue: worker.lastJobQueue ?? null,
          },
    queues: system.queues.map((queue) => ({
      name: queue.name,
      waiting: queue.waiting,
      active: queue.active,
      failed: queue.failed,
      delayed: queue.delayed,
      paused: queue.paused,
    })),
  };
}

export function mapAdminDashboard(input: {
  metrics: {
    users: { total: number; active: number; suspended: number; new24h: number };
    workspaces: { total: number; active: number; suspended: number; new24h: number };
    trips: number;
    entries: number;
    comments: number;
    media: { count: number; bytes: number };
    exports: Record<string, number>;
    queues: Array<{
      name: string;
      waiting: number;
      active: number;
      failed: number;
      completed: number;
      paused: boolean;
    }>;
    generatedAt: string;
  };
  audit: readonly AuditLog[];
  emails: readonly AdminEmailPageItemsItem[];
}): AdminDashboardData {
  const counts = input.emails.reduce(
    (result, email) => {
      if (email.status === "queued") result.queued += 1;
      if (email.status === "delivered") result.delivered += 1;
      if (email.status === "bounced") result.bounced += 1;
      if (email.status === "complained") result.complained += 1;
      if (email.status === "failed") result.failed += 1;
      return result;
    },
    { queued: 0, delivered: 0, bounced: 0, complained: 0, failed: 0 },
  );

  return {
    metrics: {
      ...input.metrics,
      exports: input.metrics.exports as AdminDashboardData["metrics"]["exports"],
    },
    trend: [
      {
        period: input.metrics.generatedAt.slice(5, 10),
        users: input.metrics.users.total,
        workspaces: input.metrics.workspaces.total,
      },
    ],
    emailHealth: counts,
    recentAudit: [...input.audit],
    generatedAt: input.metrics.generatedAt,
  };
}

export function useAdminDashboardResource(): AdminResource<AdminDashboardResourceData> {
  const metrics = useGetAdminMetrics();
  const audit = useListAdminAudit({ limit: 6 });
  const emails = useListAdminEmails({ limit: 100 });


  return combineDashboardResources({ metrics, audit, emails }, () =>
    mapAdminDashboard({
      metrics: dataOf(metrics, EMPTY_ADMIN_METRICS),
      audit: itemsOf<AuditLog>(audit),
      emails: itemsOf<AdminEmailPageItemsItem>(emails),
    }),
  );
}

export function useAdminUsersResource(): AdminResource<readonly AdminUserListItem[]> {
  // The page shell only needs a small, permission-checked request to gate the
  // view. UsersView owns the searchable, cursor-paginated query below.
  const query = useListAdminUsers(
    { limit: 1, sort: "createdAt:desc" },
  );
  return combineResources([query], () => itemsOf<AdminUserListItem>(query));
}

export function useAdminWorkspacesResource(): AdminResource<readonly AdminWorkspaceListItem[]> {
  // See useAdminUsersResource: the view owns the real paginated query.
  const query = useListAdminWorkspaces(
    { limit: 1, sort: "createdAt:desc" },
  );
  return combineResources([query], () => itemsOf<AdminWorkspaceListItem>(query));
}


export function useAdminMediaResource(): AdminResource<readonly AdminMediaItem[]> {
  const media = useListAdminMedia({ limit: 100 });
  const workspaces = useListAdminWorkspaces({ limit: 100 });
  return combineResources([media, workspaces], () =>
    mapAdminMedia(itemsOf(media), itemsOf(workspaces)),
  );
}

export function useAdminAuditResource(): AdminResource<readonly AuditLog[]> {
  const query = useListAdminAudit({ limit: 100 });
  return combineResources([query], () => itemsOf<AuditLog>(query));
}

export function useAdminFlagsResource(): AdminResource<{
  flags: readonly AdminFlagRecord[];
  workspaces: readonly AdminWorkspaceDetail[];
}> {
  const flags = useListAdminFlags();
  const workspaces = useListAdminWorkspaces({ limit: 100 });
  const users = useListAdminUsers({ limit: 100 });
  return combineResources([flags, workspaces, users], () => ({
    flags: mapAdminFlags(dataOf<readonly AdminFlagListResponseItem[]>(flags, []), itemsOf(users)),
    workspaces: mapAdminWorkspaces(itemsOf(workspaces), itemsOf(users)),
  }));
}

export function useAdminEmailsResource(): AdminResource<readonly AdminEmailRecord[]> {
  const query = useListAdminEmails({ limit: 100 });
  return combineResources([query], () => mapAdminEmails(itemsOf(query)));
}

export function useAdminQueuesResource(): AdminResource<{
  queues: readonly AdminQueueSummary[];
  failedJobs: readonly AdminFailedJob[];
}> {
  const metrics = useGetAdminMetrics();
  const jobs = useListAdminJobs(
    { status: "failed", limit: 100 },
  );
  return combineResources([metrics, jobs], () => ({
    queues: mapAdminQueues(
      dataOf<{ queues: readonly AdminQueueMetricsRow[] }>(metrics, { queues: [] }).queues,
    ),
    failedJobs: mapAdminJobs(itemsOf(jobs)),
  }));
}

export function useAdminSystemResource(): AdminResource<AdminSystemSnapshotDetail> {
  const query = useGetAdminSystem();
  return combineResources([query], () =>
    mapAdminSystem(dataOf<AdminSystem>(query, {} as AdminSystem)),
  );
}

/** Real per-status delivery totals aggregated in PostgreSQL by `/v1/admin/metrics`. */
export function useAdminEmailCountsResource(): AdminResource<{
  counts: Record<EmailStatus, number> | null;
}> {
  const metrics = useGetAdminMetrics();
  return combineResources([metrics], () => {
    const data = dataOf<AdminMetrics>(metrics, EMPTY_ADMIN_METRICS);
    // Older API payloads carry no per-status email aggregation; report that as
    // "not wired" instead of rendering a zero that looks like a real count.
    return {
      counts: data.emails ? { ...EMPTY_EMAIL_COUNTS, ...data.emails } : null,
    };
  });
}

export interface AdminMutationPort {
  updateUser(id: string, data: UpdateAdminUserRequest): Promise<void>;
  deleteUser(id: string): Promise<void>;
  forceLogoutUser(id: string): Promise<void>;
  resetUserTwoFactor(id: string): Promise<void>;
  updateWorkspace(id: string, data: UpdateAdminWorkspaceRequest): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  deleteContent(type: "trip" | "entry" | "comment", id: string): Promise<void>;
  restoreContent(type: "trip" | "entry" | "comment", id: string): Promise<void>;
  deleteMedia(id: string): Promise<void>;
  updateFlag(
    key: string,
    data: {
      description?: string;
      enabled: boolean;
      rolloutPercentage: number;
      workspaceAllowlist: string[];
    },
  ): Promise<void>;
  createFlag(data: {
    key: string;
    description: string;
    enabled: boolean;
    rolloutPercentage: number;
    workspaceAllowlist: string[];
  }): Promise<void>;
  deleteFlag(key: string): Promise<void>;
  resendEmail(id: string): Promise<void>;
  retryJob(queue: string, jobId: string): Promise<void>;
  pauseQueue(queue: string): Promise<void>;
  resumeQueue(queue: string): Promise<void>;
  clearQueue(queue: string): Promise<void>;
  exportAuditCsv(params: ExportAdminAuditCsvParams): Promise<string>;
}

export function useAdminMutationPort(): AdminMutationPort {
  const queryClient = useQueryClient();
  const updateUserMutation = useUpdateAdminUser();
  const deleteUserMutation = useDeleteAdminUser();
  const forceLogoutMutation = useForceLogoutAdminUser();
  const resetTwoFactorMutation = useResetAdminUserTwoFactor();
  const updateWorkspaceMutation = useUpdateAdminWorkspace();
  const deleteWorkspaceMutation = useDeleteAdminWorkspace();
  const deleteContentMutation = useDeleteAdminContent();
  const restoreContentMutation = useRestoreAdminContent();
  const deleteMediaMutation = useDeleteAdminMedia();
  const updateFlagMutation = useUpdateAdminFlag();
  const retryJobMutation = useRetryAdminJob();
  const pauseQueueMutation = usePauseAdminQueue();
  const resumeQueueMutation = useResumeAdminQueue();
  const clearQueueMutation = useClearAdminQueue();

  async function complete(
    operation: Promise<{ status: number; data: unknown; headers: Headers }>,
    context: string,
  ) {
    assertAdminResponse(await operation, context);
    await queryClient.invalidateQueries();
  }

  return {
    updateUser: async (id, data) =>
      complete(updateUserMutation.mutateAsync({ id, data }), "update user"),
    deleteUser: async (id) => complete(deleteUserMutation.mutateAsync({ id }), "delete user"),
    forceLogoutUser: async (id) =>
      complete(forceLogoutMutation.mutateAsync({ id }), "force logout"),
    resetUserTwoFactor: async (id) =>
      complete(resetTwoFactorMutation.mutateAsync({ id }), "reset user 2FA"),
    updateWorkspace: async (id, data) =>
      complete(updateWorkspaceMutation.mutateAsync({ id, data }), "update workspace"),
    deleteWorkspace: async (id) =>
      complete(deleteWorkspaceMutation.mutateAsync({ id }), "delete workspace"),
    deleteContent: async (type, id) =>
      complete(deleteContentMutation.mutateAsync({ type, id }), "delete content"),
    restoreContent: async (type, id) =>
      complete(restoreContentMutation.mutateAsync({ type, id }), "restore content"),
    deleteMedia: async (id) => complete(deleteMediaMutation.mutateAsync({ id }), "delete media"),
    updateFlag: async (key, data) =>
      complete(
        updateFlagMutation.mutateAsync({
          key,
          data: {
            description: data.description,
            enabled: data.enabled,
            rolloutPercentage: data.rolloutPercentage,
            rules: { workspaceAllowlist: data.workspaceAllowlist },
          },
        }),
        "update feature flag",
      ),
    createFlag: async (data) => {
      await adminJsonMutation("/v1/admin/flags", "POST", {
        key: data.key,
        description: data.description,
        enabled: data.enabled,
        rolloutPercentage: data.rolloutPercentage,
        ...(data.workspaceAllowlist.length > 0
          ? { rules: { workspaceAllowlist: data.workspaceAllowlist } }
          : {}),
      });
      await queryClient.invalidateQueries();
    },
    deleteFlag: async (key) => {
      await adminJsonMutation(`/v1/admin/flags/${encodeURIComponent(key)}`, "DELETE", undefined);
      await queryClient.invalidateQueries();
    },
    resendEmail: async (id) =>
      complete(
        resendAdminEmail(id, {
          headers: { "Idempotency-Key": crypto.randomUUID() },
        }),
        "resend email",
      ),
    retryJob: async (queue, jobId) =>
      complete(retryJobMutation.mutateAsync({ queue, jobId }), "retry job"),
    pauseQueue: async (queue) => complete(pauseQueueMutation.mutateAsync({ queue }), "pause queue"),
    resumeQueue: async (queue) =>
      complete(resumeQueueMutation.mutateAsync({ queue }), "resume queue"),
    clearQueue: async (queue) => complete(clearQueueMutation.mutateAsync({ queue }), "clear queue"),
    exportAuditCsv: async (params) =>
      assertAdminResponse(
        (await exportAdminAuditCsv(params)) as {
          status: number;
          data: unknown;
          headers: Headers;
        },
        "export audit CSV",
      ) as string,
  };
}

export function platformRoleOf(value: string): PlatformRole {
  return value === "support" || value === "analyst" || value === "admin" || value === "super_admin"
    ? value
    : "user";
}
