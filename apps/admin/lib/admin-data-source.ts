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
  useListAdminComments,
  useListAdminEmails,
  useListAdminEntries,
  useListAdminFlags,
  useListAdminJobs,
  useListAdminMedia,
  useListAdminTrips,
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
import type {
  AdminUserDetail,
  AdminWorkspaceDetail,
  AuditLog,
  EmailStatus,
  MediaStatus,
  PlatformRole,
  TripVisibility,
} from "@roamlog/contracts";
import { useQueryClient } from "@tanstack/react-query";

import { assertAdminResponse, toAdminApiFailure, type AdminApiFailure } from "./admin-api-error";
import { getAdminDataMode, type AdminDataMode } from "./admin-data-mode";
import {
  MOCK_AUDIT_LOGS,
  MOCK_ADMIN_DASHBOARD,
  MOCK_ADMIN_USERS,
  MOCK_ADMIN_WORKSPACES,
  type AdminDashboardData,
} from "./fixtures";
import {
  MOCK_ADMIN_CONTENT,
  MOCK_ADMIN_EMAILS,
  MOCK_ADMIN_FAILED_JOBS,
  MOCK_ADMIN_FLAGS,
  MOCK_ADMIN_MEDIA,
  MOCK_ADMIN_QUEUES,
  MOCK_ADMIN_SYSTEM,
  type AdminContentItem,
  type AdminEmailRecord,
  type AdminFailedJob,
  type AdminFlagRecord,
  type AdminMediaItem,
  type AdminQueueSummary,
  type AdminSystemSnapshot,
} from "./ops-fixtures";

export interface AdminDataSource {
  readonly mode: "fixture" | "msw";
  getDashboard(): AdminDashboardData;
  listUsers(): readonly AdminUserDetail[];
  listWorkspaces(): readonly AdminWorkspaceDetail[];
  listAuditLogs(): readonly AuditLog[];
  listContent(): readonly AdminContentItem[];
  listMedia(): readonly AdminMediaItem[];
  listEmails(): readonly AdminEmailRecord[];
  listQueues(): readonly AdminQueueSummary[];
  listFailedJobs(): readonly AdminFailedJob[];
  listFlags(): readonly AdminFlagRecord[];
  getSystem(): AdminSystemSnapshot;
}

export const fixtureAdminDataSource: AdminDataSource = {
  mode: "fixture",
  getDashboard: () => MOCK_ADMIN_DASHBOARD,
  listUsers: () => MOCK_ADMIN_USERS,
  listWorkspaces: () => MOCK_ADMIN_WORKSPACES,
  listAuditLogs: () => MOCK_AUDIT_LOGS,
  listContent: () => MOCK_ADMIN_CONTENT,
  listMedia: () => MOCK_ADMIN_MEDIA,
  listEmails: () => MOCK_ADMIN_EMAILS,
  listQueues: () => MOCK_ADMIN_QUEUES,
  listFailedJobs: () => MOCK_ADMIN_FAILED_JOBS,
  listFlags: () => MOCK_ADMIN_FLAGS,
  getSystem: () => MOCK_ADMIN_SYSTEM,
};

let activeAdminDataSource: AdminDataSource = fixtureAdminDataSource;

/** Fixture source retained for the default 3001 preview and component tests. */
export function getAdminDataSource(): AdminDataSource {
  return activeAdminDataSource;
}

export function configureAdminDataSource(source: AdminDataSource): void {
  activeAdminDataSource = source;
}

export interface AdminResource<T> {
  mode: AdminDataMode;
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

function fixtureResource<T>(data: T): AdminResource<T> {
  return {
    mode: "fixture",
    data,
    isLoading: false,
    error: null,
    degraded: [],
    refetch: () => undefined,
  };
}

function networkFailure(error: unknown): AdminApiFailure {
  return {
    code: "ADMIN_API_NETWORK",
    status: 0,
    title: "Admin API unavailable",
    detail:
      error instanceof Error ? error.message : "The Admin API request could not be completed.",
    degraded: [],
  };
}

function failureFromQuery<T>(query: ApiQuery<T>): AdminApiFailure | null {
  if (query.error) {
    return networkFailure(query.error);
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
  mode: AdminDataMode,
  queries: readonly ApiQuery<unknown>[],
  map: () => T,
): AdminResource<T> {
  const error = queries.map(failureFromQuery).find((value) => value !== null) ?? null;
  const isReady = queries.every((query) => query.data && query.data.status < 300);
  const isLoading = queries.some((query) => query.isLoading);

  return {
    mode,
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

function workspaceName(
  workspaceId: string,
  workspaces: readonly AdminWorkspacePageItemsItem[],
): string {
  return (
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId.slice(-8)
  );
}

function userName(userId: string | null, users: readonly AdminUserPageItemsItem[]): string {
  if (!userId) {
    return "Unknown user";
  }
  return users.find((user) => user.id === userId)?.name ?? userId.slice(-8);
}

export function mapAdminUsers(
  users: readonly AdminUserPageItemsItem[],
): readonly AdminUserDetail[] {
  return users.map((user) => ({
    ...user,
    workspaceCount: 0,
    tripCount: 0,
    entryCount: 0,
    activeSessionCount: 0,
  }));
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

export function mapAdminContent(input: {
  trips: readonly {
    id: string;
    workspaceId: string;
    title: string;
    summary: string;
    visibility: TripVisibility;
    createdById: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  }[];
  entries: readonly {
    id: string;
    workspaceId: string;
    title: string;
    excerpt: string;
    createdById: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  }[];
  comments: readonly {
    id: string;
    workspaceId: string;
    targetType: string;
    body: string;
    authorId: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  }[];
  users: readonly AdminUserPageItemsItem[];
  workspaces: readonly AdminWorkspacePageItemsItem[];
}): readonly AdminContentItem[] {
  return [
    ...input.trips.map((trip) => ({
      id: trip.id,
      kind: "trip" as const,
      title: trip.title,
      excerpt: trip.summary,
      workspaceId: trip.workspaceId,
      workspaceName: workspaceName(trip.workspaceId, input.workspaces),
      authorName: userName(trip.createdById, input.users),
      visibility: trip.visibility,
      status: trip.deletedAt ? ("deleted" as const) : ("published" as const),
      reportCount: 0,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      shareToken: null,
    })),
    ...input.entries.map((entry) => ({
      id: entry.id,
      kind: "entry" as const,
      title: entry.title,
      excerpt: entry.excerpt,
      workspaceId: entry.workspaceId,
      workspaceName: workspaceName(entry.workspaceId, input.workspaces),
      authorName: userName(entry.createdById, input.users),
      visibility: "workspace" as const,
      status: entry.deletedAt ? ("deleted" as const) : ("published" as const),
      reportCount: 0,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      shareToken: null,
    })),
    ...input.comments.map((comment) => ({
      id: comment.id,
      kind: "comment" as const,
      title: `Re: ${comment.targetType}`,
      excerpt: comment.body,
      workspaceId: comment.workspaceId,
      workspaceName: workspaceName(comment.workspaceId, input.workspaces),
      authorName: userName(comment.authorId, input.users),
      visibility: "workspace" as const,
      status: comment.deletedAt ? ("deleted" as const) : ("published" as const),
      reportCount: 0,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      shareToken: null,
    })),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function mapAdminMedia(
  media: readonly AdminMediaPageItemsItem[],
  workspaces: readonly AdminWorkspacePageItemsItem[],
): readonly AdminMediaItem[] {
  return media.map((item) => ({
    id: item.id,
    fileName: item.key.split("/").at(-1) ?? item.key,
    workspaceId: item.workspaceId,
    workspaceName: workspaceName(item.workspaceId, workspaces),
    mimeType: item.mimeType,
    sizeBytes: item.size,
    status: item.status as MediaStatus,
    usage: item.tripId === null ? "orphan" : "linked",
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

const QUEUE_LABELS: Record<string, string> = {
  "media-processing": "媒体处理",
  email: "邮件投递",
  export: "数据导出",
  maintenance: "维护任务",
};

export function mapAdminQueues(
  queues: readonly {
    name: string;
    waiting: number;
    active: number;
    failed: number;
    completed: number;
    paused: boolean;
  }[],
): readonly AdminQueueSummary[] {
  return queues.map((queue) => ({
    name: queue.name,
    label: QUEUE_LABELS[queue.name] ?? queue.name,
    waiting: queue.waiting,
    active: queue.active,
    failed: queue.failed,
    completed: queue.completed,
    throughputPerMinute: 0,
    paused: queue.paused,
  }));
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

export function mapAdminSystem(system: AdminSystem): AdminSystemSnapshot {
  const checks = Object.entries(system.checks).map(([name, value]) => ({
    name,
    status: value.status as "up" | "down",
    latencyMs: value.latencyMs,
    detail: `${name} readiness probe`,
  }));
  const migrations =
    system.migration.version && system.migration.appliedAt
      ? [
          {
            version: system.migration.version,
            name: "latest applied migration",
            appliedAt: system.migration.appliedAt,
            status: "applied" as const,
          },
        ]
      : [];

  return {
    apiVersion: system.version,
    workerVersion: system.worker.version,
    environment:
      system.environment === "production"
        ? "production"
        : system.environment === "staging"
          ? "staging"
          : "local",
    nodeVersion: system.nodeVersion,
    buildTime: system.buildTime,
    startedAt: system.startedAt,
    uptimeSeconds: system.uptimeSeconds,
    workerStatus: system.worker.status,
    workerConsumers: system.worker.consumers,
    checks,
    migrations,
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

export function useAdminDashboardResource(): AdminResource<AdminDashboardData> {
  const mode = getAdminDataMode();
  const metrics = useGetAdminMetrics({ query: { enabled: mode === "api" } });
  const audit = useListAdminAudit({ limit: 6 }, { query: { enabled: mode === "api" } });
  const emails = useListAdminEmails({ limit: 100 }, { query: { enabled: mode === "api" } });

  if (mode === "fixture") {
    return fixtureResource(MOCK_ADMIN_DASHBOARD);
  }

  return combineResources(mode, [metrics, audit, emails], () =>
    mapAdminDashboard({
      metrics: dataOf(metrics, {} as Parameters<typeof mapAdminDashboard>[0]["metrics"]),
      audit: itemsOf<AuditLog>(audit),
      emails: itemsOf<AdminEmailPageItemsItem>(emails),
    }),
  );
}

export function useAdminUsersResource(): AdminResource<readonly AdminUserDetail[]> {
  const mode = getAdminDataMode();
  const query = useListAdminUsers({ limit: 100 }, { query: { enabled: mode === "api" } });
  if (mode === "fixture") {
    return fixtureResource(MOCK_ADMIN_USERS);
  }
  return combineResources(mode, [query], () => mapAdminUsers(itemsOf(query)));
}

export function useAdminWorkspacesResource(): AdminResource<readonly AdminWorkspaceDetail[]> {
  const mode = getAdminDataMode();
  const workspaces = useListAdminWorkspaces({ limit: 100 }, { query: { enabled: mode === "api" } });
  const users = useListAdminUsers({ limit: 100 }, { query: { enabled: mode === "api" } });
  if (mode === "fixture") {
    return fixtureResource(MOCK_ADMIN_WORKSPACES);
  }
  return combineResources(mode, [workspaces, users], () =>
    mapAdminWorkspaces(
      itemsOf<AdminWorkspacePageItemsItem>(workspaces),
      itemsOf<AdminUserPageItemsItem>(users),
    ),
  );
}

export function useAdminContentResource(): AdminResource<readonly AdminContentItem[]> {
  const mode = getAdminDataMode();
  const trips = useListAdminTrips({ limit: 100 }, { query: { enabled: mode === "api" } });
  const entries = useListAdminEntries({ limit: 100 }, { query: { enabled: mode === "api" } });
  const comments = useListAdminComments({ limit: 100 }, { query: { enabled: mode === "api" } });
  const users = useListAdminUsers({ limit: 100 }, { query: { enabled: mode === "api" } });
  const workspaces = useListAdminWorkspaces({ limit: 100 }, { query: { enabled: mode === "api" } });
  if (mode === "fixture") {
    return fixtureResource(MOCK_ADMIN_CONTENT);
  }
  return combineResources(mode, [trips, entries, comments, users, workspaces], () =>
    mapAdminContent({
      trips: itemsOf(trips),
      entries: itemsOf(entries),
      comments: itemsOf(comments),
      users: itemsOf(users),
      workspaces: itemsOf(workspaces),
    }),
  );
}

export function useAdminMediaResource(): AdminResource<readonly AdminMediaItem[]> {
  const mode = getAdminDataMode();
  const media = useListAdminMedia({ limit: 100 }, { query: { enabled: mode === "api" } });
  const workspaces = useListAdminWorkspaces({ limit: 100 }, { query: { enabled: mode === "api" } });
  if (mode === "fixture") {
    return fixtureResource(MOCK_ADMIN_MEDIA);
  }
  return combineResources(mode, [media, workspaces], () =>
    mapAdminMedia(itemsOf(media), itemsOf(workspaces)),
  );
}

export function useAdminAuditResource(): AdminResource<readonly AuditLog[]> {
  const mode = getAdminDataMode();
  const query = useListAdminAudit({ limit: 100 }, { query: { enabled: mode === "api" } });
  if (mode === "fixture") {
    return fixtureResource(MOCK_AUDIT_LOGS);
  }
  return combineResources(mode, [query], () => itemsOf<AuditLog>(query));
}

export function useAdminFlagsResource(): AdminResource<{
  flags: readonly AdminFlagRecord[];
  workspaces: readonly AdminWorkspaceDetail[];
}> {
  const mode = getAdminDataMode();
  const flags = useListAdminFlags({ query: { enabled: mode === "api" } });
  const workspaces = useListAdminWorkspaces({ limit: 100 }, { query: { enabled: mode === "api" } });
  const users = useListAdminUsers({ limit: 100 }, { query: { enabled: mode === "api" } });
  if (mode === "fixture") {
    return fixtureResource({ flags: MOCK_ADMIN_FLAGS, workspaces: MOCK_ADMIN_WORKSPACES });
  }
  return combineResources(mode, [flags, workspaces, users], () => ({
    flags: mapAdminFlags(dataOf<readonly AdminFlagListResponseItem[]>(flags, []), itemsOf(users)),
    workspaces: mapAdminWorkspaces(itemsOf(workspaces), itemsOf(users)),
  }));
}

export function useAdminEmailsResource(): AdminResource<readonly AdminEmailRecord[]> {
  const mode = getAdminDataMode();
  const query = useListAdminEmails({ limit: 100 }, { query: { enabled: mode === "api" } });
  if (mode === "fixture") {
    return fixtureResource(MOCK_ADMIN_EMAILS);
  }
  return combineResources(mode, [query], () => mapAdminEmails(itemsOf(query)));
}

export function useAdminQueuesResource(): AdminResource<{
  queues: readonly AdminQueueSummary[];
  failedJobs: readonly AdminFailedJob[];
}> {
  const mode = getAdminDataMode();
  const metrics = useGetAdminMetrics({ query: { enabled: mode === "api" } });
  const jobs = useListAdminJobs(
    { status: "failed", limit: 100 },
    { query: { enabled: mode === "api" } },
  );
  if (mode === "fixture") {
    return fixtureResource({ queues: MOCK_ADMIN_QUEUES, failedJobs: MOCK_ADMIN_FAILED_JOBS });
  }
  return combineResources(mode, [metrics, jobs], () => ({
    queues: mapAdminQueues(
      dataOf<{ queues: Parameters<typeof mapAdminQueues>[0] }>(metrics, { queues: [] }).queues,
    ),
    failedJobs: mapAdminJobs(itemsOf(jobs)),
  }));
}

export function useAdminSystemResource(): AdminResource<AdminSystemSnapshot> {
  const mode = getAdminDataMode();
  const query = useGetAdminSystem({ query: { enabled: mode === "api" } });
  if (mode === "fixture") {
    return fixtureResource(MOCK_ADMIN_SYSTEM);
  }
  return combineResources(mode, [query], () =>
    mapAdminSystem(dataOf<AdminSystem>(query, {} as AdminSystem)),
  );
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
