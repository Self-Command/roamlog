"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  ShieldAlert,
} from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type {
  AccountStatus,
  AdminWorkspaceDetail,
  AdminWorkspaceListItem,
  WorkspacePlan,
  WorkspaceRole,
} from "@roamlog/contracts";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@roamlog/ui";

import {
  adminWorkspacesExportUrl,
  downloadAdminCsv,
  useAdminWorkspaceDetail,
  useAdminWorkspaceTrips,
  useAdminWorkspacesPage,
  type AdminMutationPort,
  type AdminWorkspaceListParams,
} from "../../lib/admin-data-source";
import { AdminMutationError } from "../../lib/admin-api-error";
import type { AdminConsoleRole } from "../../lib/admin-types";
import { formatBytes, formatDateTime } from "../../lib/format";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { BulkSelectionBar } from "../admin-ui/bulk-selection-bar";
import { DestructiveActionDialog } from "../admin-ui/destructive-action-dialog";
import { AccountStatusBadge, PlanBadge } from "../admin-ui/status-badge";

type WorkspaceAction =
  | { kind: "suspend"; workspace: AdminWorkspaceListItem }
  | { kind: "restore"; workspace: AdminWorkspaceListItem }
  | { kind: "delete"; workspace: AdminWorkspaceListItem }
  | { kind: "change-plan"; workspace: AdminWorkspaceListItem; plan: WorkspacePlan }
  | {
      kind: "transfer-owner";
      workspace: AdminWorkspaceListItem;
      ownerId: string;
      ownerName: string;
    }
  | { kind: "bulk-suspend"; workspaces: AdminWorkspaceListItem[] }
  | { kind: "bulk-restore"; workspaces: AdminWorkspaceListItem[] }
  | { kind: "bulk-delete"; workspaces: AdminWorkspaceListItem[] };

type BulkWorkspaceAction = Extract<
  WorkspaceAction,
  { kind: "bulk-suspend" | "bulk-restore" | "bulk-delete" }
>;

interface WorkspacesViewProps {
  role: AdminConsoleRole;
  mutations?: AdminMutationPort;
  exportCsv?: (params: AdminWorkspaceListParams) => Promise<void>;
}

interface StoredWorkspaceFilters {
  query: string;
  status: "all" | AccountStatus;
  plan: "all" | WorkspacePlan;
  sort: string;
}

const WORKSPACE_SORT_OPTIONS = [
  { value: "createdAt:desc", label: "最新创建" },
  { value: "createdAt:asc", label: "最早创建" },
  { value: "name:asc", label: "名称 A→Z" },
] as const;

const PAGE_SIZE = 25;
const FILTER_STORAGE_KEY = "roamlog.admin.workspaces.filters";
const DEFAULT_FILTERS: StoredWorkspaceFilters = {
  query: "",
  status: "all",
  plan: "all",
  sort: "createdAt:desc",
};
const PLAN_LABELS: Record<WorkspacePlan, string> = { free: "Free", pro: "Pro", team: "Team" };
function isBulkWorkspaceAction(action: WorkspaceAction): action is BulkWorkspaceAction {
  return (
    action.kind === "bulk-suspend" ||
    action.kind === "bulk-restore" ||
    action.kind === "bulk-delete"
  );
}

function readStoredFilters(): StoredWorkspaceFilters {
  if (typeof window === "undefined") {
    return DEFAULT_FILTERS;
  }
  try {
    const raw = window.sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_FILTERS;
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspaceFilters>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      status:
        parsed.status === "active" || parsed.status === "suspended" || parsed.status === "deleted"
          ? parsed.status
          : "all",
      plan: parsed.plan === "free" || parsed.plan === "pro" || parsed.plan === "team"
        ? parsed.plan
        : "all",
      sort: WORKSPACE_SORT_OPTIONS.some((option) => option.value === parsed.sort)
        ? (parsed.sort as string)
        : "createdAt:desc",
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const actionCopy: Record<
  WorkspaceAction["kind"],
  { title: string; description: string; confirmLabel: string; action: string }
> = {
  suspend: {
    title: "暂停工作区",
    description: "Workspace 成员将暂时无法访问旅行与协作内容。恢复后会保留全部数据。",
    confirmLabel: "确认暂停",
    action: "admin.workspace.suspend",
  },
  restore: {
    title: "恢复工作区",
    description: "Workspace 将重新对成员开放，操作由后端执行并写入审计。",
    confirmLabel: "确认恢复",
    action: "admin.workspace.restore",
  },
  delete: {
    title: "删除工作区",
    description: "Workspace 进入软删除状态，管理员可在后续运营页恢复。",
    confirmLabel: "确认删除",
    action: "admin.workspace.delete",
  },
  "change-plan": {
    title: "变更套餐",
    description:
      "套餐由后端写入 Workspace.plan 并记录审计。当前权限模型以 admin:workspaces:delete 动作约束该变更。",
    confirmLabel: "确认变更",
    action: "admin.workspace.change-plan",
  },
  "transfer-owner": {
    title: "转移所有权",
    description:
      "新 Owner 必须是当前活跃成员；后端会在同一事务内调整双方 Workspace 角色并写入审计。",
    confirmLabel: "确认转移",
    action: "admin.workspace.transfer-owner",
  },
  "bulk-suspend": {
    title: "批量暂停工作区",
    description: "所选 Workspace 会暂停访问，操作由后端执行并写入审计。",
    confirmLabel: "确认批量暂停",
    action: "admin.workspace.bulk-suspend",
  },
  "bulk-restore": {
    title: "批量恢复工作区",
    description: "所选 Workspace 会恢复访问，操作由后端执行并写入审计。",
    confirmLabel: "确认批量恢复",
    action: "admin.workspace.bulk-restore",
  },
  "bulk-delete": {
    title: "批量删除工作区",
    description: "所选 Workspace 进入软删除状态，操作由后端执行并写入审计。",
    confirmLabel: "确认批量删除",
    action: "admin.workspace.bulk-delete",
  },
};

export function WorkspacesView({
  role,
  mutations,
  exportCsv,
}: WorkspacesViewProps) {
  const [storedFilters] = useState<StoredWorkspaceFilters>(() => readStoredFilters());
  const [query, setQuery] = useState(storedFilters.query);
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>(storedFilters.status);
  const [planFilter, setPlanFilter] = useState<"all" | WorkspacePlan>(storedFilters.plan);
  const [sortFilter, setSortFilter] = useState(storedFilters.sort);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailWorkspace, setDetailWorkspace] = useState<AdminWorkspaceListItem | null>(null);
  const [pendingAction, setPendingAction] = useState<WorkspaceAction | null>(null);
  const [nextPlan, setNextPlan] = useState<WorkspacePlan>("free");
  const [nextOwnerId, setNextOwnerId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const readOnly = role === "analyst";
  const canSuspend = canPlatform(role, "admin:workspaces:suspend");
  const canRestore = canPlatform(role, "admin:workspaces:restore");
  const canDelete = canPlatform(role, "admin:workspaces:delete");
  const canManageContract = canDelete;
  const canExport = canDelete;
  const debouncedQuery = useDebouncedValue(query, 250);
  const apiParams = useMemo<AdminWorkspaceListParams>(
    () => ({
      q: debouncedQuery.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      plan: planFilter === "all" ? undefined : planFilter,
      sort: sortFilter,
      cursor: cursorStack[pageIndex],
      limit: PAGE_SIZE,
    }),
    [cursorStack, debouncedQuery, pageIndex, planFilter, sortFilter, statusFilter],
  );
  const api = useAdminWorkspacesPage(apiParams);
  const detail = useAdminWorkspaceDetail(detailWorkspace?.id ?? null, detailWorkspace !== null);
  const trips = useAdminWorkspaceTrips(detailWorkspace?.id ?? null, detailWorkspace !== null);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({
        query,
        status: statusFilter,
        plan: planFilter,
        sort: sortFilter,
      }),
      );
    } catch {
      // Session storage can be unavailable in hardened browser contexts.
    }
  }, [planFilter, query, sortFilter, statusFilter]);

  const visibleWorkspaces: readonly AdminWorkspaceListItem[] = api.data?.items ?? [];
  const allVisibleSelected =
    visibleWorkspaces.length > 0 &&
    visibleWorkspaces.every((workspace) => selectedIds.has(workspace.id));
  const bulkWorkspaces = visibleWorkspaces.filter((workspace) => selectedIds.has(workspace.id));
  const detailData: AdminWorkspaceDetail | null = detail.data ?? null;

  function resetPagination() {
    setCursorStack([undefined]);
    setPageIndex(0);
    setSelectedIds(new Set());
  }

  function changeQuery(value: string) {
    setQuery(value);
    resetPagination();
  }

  function changeStatus(value: "all" | AccountStatus) {
    setStatusFilter(value);
    resetPagination();
  }

  function changePlanFilter(value: "all" | WorkspacePlan) {
    setPlanFilter(value);
    resetPagination();
  }

  function changeSort(value: string) {
    if (WORKSPACE_SORT_OPTIONS.some((option) => option.value === value)) {
      setSortFilter(value);
      resetPagination();
    }
  }

  function goNextPage() {
    const next = api.data?.nextCursor;
    if (!next) {
      return;
    }
    setCursorStack((current) => [...current.slice(0, pageIndex + 1), next]);
    setPageIndex((current) => current + 1);
    setSelectedIds(new Set());
  }

  function goPreviousPage() {
    if (pageIndex === 0) {
      return;
    }
    setPageIndex((current) => current - 1);
    setSelectedIds(new Set());
  }

  function setSelected(workspaceId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(workspaceId);
      } else {
        next.delete(workspaceId);
      }
      return next;
    });
  }

  function openAction(action: WorkspaceAction) {
    setPendingAction(action);
  }

  function actionTarget(action: WorkspaceAction): string {
    return isBulkWorkspaceAction(action)
      ? `${action.workspaces.length} 个工作区`
      : action.workspace.name;
  }

  function mutationFailureMessage(error: unknown, fallback: string): string {
    return error instanceof AdminMutationError
      ? `操作失败：${error.failure.code} · ${error.failure.detail}`
      : fallback;
  }

  async function confirmAction() {
    if (!pendingAction) {
      return;
    }

    const action = pendingAction;
    const copy = actionCopy[action.kind];

    if (mutations) {
      try {
        if (isBulkWorkspaceAction(action)) {
          await Promise.all(
            action.workspaces.map((workspace) =>
              action.kind === "bulk-delete"
                ? mutations.deleteWorkspace(workspace.id)
                : mutations.updateWorkspace(workspace.id, {
                    status: action.kind === "bulk-restore" ? "active" : "suspended",
                  }),
            ),
          );
        } else if (action.kind === "suspend" || action.kind === "restore") {
          await mutations.updateWorkspace(action.workspace.id, {
            status: action.kind === "suspend" ? "suspended" : "active",
          });
        } else if (action.kind === "delete") {
          await mutations.deleteWorkspace(action.workspace.id);
        } else if (action.kind === "change-plan") {
          await mutations.updateWorkspace(action.workspace.id, { plan: action.plan });
        } else if (action.kind === "transfer-owner") {
          await mutations.updateWorkspace(action.workspace.id, { ownerId: action.ownerId });
        }
      } catch (error) {
        setStatusMessage(
          mutationFailureMessage(error, "操作失败，请检查 API 与权限后重试。"),
        );
        setPendingAction(null);
        return;
      }

      setPendingAction(null);
      if (action.kind === "delete") {
        setDetailWorkspace(null);
      }
      setSelectedIds(new Set());
      setStatusMessage(`已提交：${copy.action}（审计由后端写入）`);
      return;
    }

    setStatusMessage("未连接 Admin API，操作未提交。");
    setPendingAction(null);
  }

  async function handleExport() {
    if (isExporting || !canExport) {
      return;
    }
    setIsExporting(true);
    setStatusMessage("");
    try {
      if (exportCsv) {
        await exportCsv(apiParams);
      } else {
        await downloadAdminCsv(
          adminWorkspacesExportUrl(apiParams),
          "roamlog-admin-workspaces.csv",
        );
      }
      setStatusMessage("Workspace CSV 已按当前筛选导出。");
    } catch (error) {
      setStatusMessage(
        mutationFailureMessage(error, "导出失败，请检查 Admin API 与会话后重试。"),
      );
    } finally {
      setIsExporting(false);
    }
  }

  const copy = pendingAction ? actionCopy[pendingAction.kind] : null;
  const detailLoading = detail.isLoading && !detail.data;
  const countValue = (value: number | undefined): string | number =>
    detailLoading ? "…" : value === undefined ? "未接入" : value;

  const apiMembers = detail.data?.members;
  const members: ReadonlyArray<{
    userId: string;
    name: string;
    email: string;
    role: WorkspaceRole;
    status: "active" | "suspended";
  }> | undefined =
    apiMembers === undefined
      ? undefined
      : apiMembers.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
          role: member.role,
          status: member.status,
        }));

  const recentTrips: ReadonlyArray<{
    id: string;
    title: string;
    status: string;
    updatedAt: string;
  }> | undefined =
    trips.data === undefined || trips.data === null
      ? undefined
      : trips.data.items.map((trip) => ({
          id: trip.id,
          title: trip.title,
          status: trip.status,
          updatedAt: trip.updatedAt,
        }));

  const invitations = detail.data?.invitations;
  const ownerName = detailData?.owner.name ?? detailWorkspace?.owner?.name;
  const ownerEmail = detailData?.owner.email ?? detailWorkspace?.owner?.email;

  function openPlanAction(workspace: AdminWorkspaceListItem) {
    setNextPlan(workspace.plan);
    openAction({ kind: "change-plan", workspace, plan: workspace.plan });
  }

  function openTransferAction(workspace: AdminWorkspaceListItem) {
    const candidate = members?.find((member) => member.userId !== detailData?.owner.id);
    setNextOwnerId(candidate?.userId ?? members?.[0]?.userId ?? "");
    openAction({
      kind: "transfer-owner",
      workspace,
      ownerId: candidate?.userId ?? members?.[0]?.userId ?? "",
      ownerName: candidate?.name ?? members?.[0]?.name ?? "",
    });
  }

  const transferCandidates = members?.filter(
    (member) => member.status === "active" && member.userId !== detailData?.owner.id,
  );

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="TRUST & SAFETY / WORKSPACES"
        title="工作区"
        description="按服务端搜索与筛选读取租户体量、成员、套餐与所有权，并执行受平台角色约束的运营操作。"
        readOnly={readOnly}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={isExporting || !canExport}
              title={
                isExporting
                  ? "正在生成 CSV"
                  : !canExport
                    ? "仅 admin 及以上可导出 Workspace CSV（后端动作 admin:workspaces:delete）"
                    : "按当前搜索与筛选导出全部匹配工作区（服务端 CSV）"
              }
              onClick={() => void handleExport()}
            >
              <Download aria-hidden="true" />
              {isExporting ? "导出中…" : "导出 CSV"}
            </Button>
            <div className="rounded-control border border-hairline bg-surface-1 px-3 py-2">
              <p className="type-eyebrow">本页活跃成员</p>
              <p className="mt-1 font-mono text-[11px] text-body">
                {visibleWorkspaces.reduce(
                  (total, workspace) => total + (workspace.memberCount ?? 0),
                  0,
                )}
              </p>
            </div>
          </div>
        }
      />

      <AdminFilterBar>
        <label className="min-w-0 flex-1">
          <span className="type-eyebrow">搜索工作区</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            placeholder="名称或 slug"
            value={query}
            onChange={(event) => changeQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">状态</span>
          <Select
            className="mt-1.5 h-9"
            value={statusFilter}
            onChange={(event) => changeStatus(event.currentTarget.value as "all" | AccountStatus)}
          >
            <option value="all">全部状态</option>
            <option value="active">Active</option>
            <option value="suspended">已暂停</option>
            <option value="deleted">已删除</option>
          </Select>
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">套餐</span>
          <Select
            className="mt-1.5 h-9"
            value={planFilter}
            onChange={(event) => changePlanFilter(event.currentTarget.value as "all" | WorkspacePlan)}
          >
            <option value="all">全部套餐</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="team">Team</option>
          </Select>
        </label>
        <label className="w-full md:w-44">
          <span className="type-eyebrow">排序</span>
          <Select
            className="mt-1.5 h-9"
            value={sortFilter}
            onChange={(event) => changeSort(event.currentTarget.value)}
          >
            {WORKSPACE_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <span className="flex h-9 items-center border-l border-hairline pl-3 font-mono text-[10px] text-muted max-md:hidden">
          {`${visibleWorkspaces.length} 条 / 第 ${pageIndex + 1} 页`}
        </span>
      </AdminFilterBar>

      {readOnly ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          Analyst 只能查看工作区数据；暂停、套餐与所有权操作保持可见但不可用。
        </div>
      ) : null}

      <BulkSelectionBar
        count={selectedIds.size}
        noun="个工作区"
        onClear={() => setSelectedIds(new Set())}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                !canRestore || !bulkWorkspaces.some((workspace) => workspace.status === "suspended")
              }
              title={canRestore ? "批量恢复所选工作区" : "当前平台角色不可恢复工作区"}
              onClick={() => setPendingAction({ kind: "bulk-restore", workspaces: bulkWorkspaces })}
            >
              批量恢复
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                !canSuspend || !bulkWorkspaces.every((workspace) => workspace.status === "active")
              }
              title={canSuspend ? "批量暂停所选工作区" : "当前平台角色不可暂停工作区"}
              onClick={() => setPendingAction({ kind: "bulk-suspend", workspaces: bulkWorkspaces })}
            >
              批量暂停
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!canDelete}
              title={canDelete ? "批量软删除所选工作区" : "当前平台角色不可删除工作区"}
              onClick={() => setPendingAction({ kind: "bulk-delete", workspaces: bulkWorkspaces })}
            >
              批量删除
            </Button>
          </>
        }
      />

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">Workspace 列表</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              tenants / server page {pageIndex + 1}
            </p>
          </div>
        </div>

        {api.error ? (
          <div role="alert" className="m-4 rounded-control border border-accent-red/25 p-4">
            <p className="type-eyebrow text-accent-red">加载失败</p>
            <p className="mt-1 text-[12px] text-body">加载失败，请稍后重试</p>
            <details className="mt-2 font-mono text-[9px] text-muted">
              <summary className="cursor-pointer select-none">错误详情</summary>
              <p className="mt-1 break-all">
                {api.error.code} · HTTP {api.error.status || "network"} · {api.error.detail}
              </p>
            </details>
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => api.refetch()}>
              重试
            </Button>
          </div>
        ) : api.isLoading && !api.data ? (
          <p role="status" className="m-4 text-[12px] text-muted">
            正在读取 Workspace 列表…
          </p>
        ) : visibleWorkspaces.length === 0 ? (
          <EmptyState
            title="没有匹配工作区"
            description="调整关键词、状态或套餐筛选后再试。"
            className="m-4"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1140px] border-collapse text-left text-[12px]">
              <caption className="sr-only">Workspace 平台列表</caption>
              <thead>
                <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <Checkbox
                      aria-label="全选当前工作区"
                      checked={allVisibleSelected}
                      onCheckedChange={(checked) => {
                        if (checked === true) {
                          setSelectedIds(new Set(visibleWorkspaces.map((workspace) => workspace.id)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    工作区
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    套餐
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    状态
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    Owner
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    成员
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    旅行
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    日志
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    媒体
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    更新
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-normal">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {visibleWorkspaces.map((workspace) => (
                  <tr
                    key={workspace.id}
                    aria-label={`工作区 ${workspace.name}`}
                    className="h-12 transition-colors hover:bg-surface-2/60"
                  >
                    <td className="px-3 py-1.5">
                      <Checkbox
                        aria-label={`选择 ${workspace.name}`}
                        checked={selectedIds.has(workspace.id)}
                        onCheckedChange={(checked) => setSelected(workspace.id, checked === true)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setDetailWorkspace(workspace)}
                        className="group flex max-w-[270px] items-center gap-2.5 rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-hairline-strong bg-surface-2 text-muted">
                          <Building2 aria-hidden="true" className="size-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium text-ink group-hover:underline group-hover:underline-offset-4">
                            {workspace.name}
                          </span>
                          <span className="block truncate font-mono text-[9px] text-muted">
                            {workspace.slug}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <PlanBadge plan={workspace.plan} />
                    </td>
                    <td className="px-3 py-1.5">
                      <AccountStatusBadge status={workspace.status} />
                    </td>
                    <td className="px-3 py-1.5">
                      {workspace.owner ? (
                        <>
                          <span className="block truncate text-[11px] text-body">
                            {workspace.owner.name}
                          </span>
                          <span className="block truncate font-mono text-[9px] text-muted">
                            {workspace.owner.email}
                          </span>
                        </>
                      ) : (
                        <span
                          className="font-mono text-[10px] text-muted"
                          title="列表响应未提供 Owner；需要 GET /v1/admin/workspaces 返回 owner"
                        >
                          未接入
                        </span>
                      )}
                    </td>
                    {(
                      [
                        ["成员", workspace.memberCount],
                        ["旅行", workspace.tripCount],
                        ["日志", workspace.entryCount],
                      ] as const
                    ).map(([label, value]) => (
                      <td
                        key={label}
                        className="px-3 py-1.5 font-mono text-[10px] text-muted"
                        title={
                          value === undefined
                            ? `列表响应未提供${label}计数；需要 GET /v1/admin/workspaces 返回 ${label} 计数`
                            : undefined
                        }
                      >
                        {value ?? "未接入"}
                      </td>
                    ))}
                    <td
                      className="px-3 py-1.5 font-mono text-[10px] text-muted"
                      title={
                        workspace.mediaBytes === undefined
                          ? "列表响应未提供媒体字节；需要 GET /v1/admin/workspaces 返回 mediaBytes"
                          : undefined
                      }
                    >
                      {workspace.mediaBytes === undefined
                        ? "未接入"
                        : formatBytes(workspace.mediaBytes)}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">
                      {formatDateTime(workspace.updatedAt)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="工作区详情"
                          title="查看成员、邀请、套餐与所有权"
                          onClick={() => setDetailWorkspace(workspace)}
                        >
                          <ChevronRight aria-hidden="true" />
                        </Button>
                        <Button
                          variant={workspace.status === "active" ? "ghost" : "outline"}
                          size="sm"
                          aria-label={workspace.status === "active" ? "暂停工作区" : "恢复工作区"}
                          disabled={workspace.status === "active" ? !canSuspend : !canRestore}
                          title={
                            workspace.status === "active"
                              ? canSuspend
                                ? "暂停工作区"
                                : "当前平台角色不可暂停工作区"
                              : canRestore
                                ? "恢复工作区"
                                : "当前平台角色不可恢复工作区"
                          }
                          onClick={() =>
                            setPendingAction({
                              kind: workspace.status === "active" ? "suspend" : "restore",
                              workspace,
                            })
                          }
                        >
                          {workspace.status === "active" ? "暂停" : "恢复"}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label="删除工作区"
                          disabled={!canDelete || workspace.status === "deleted"}
                          title={
                            canDelete ? "软删除工作区" : "当前平台角色不可删除工作区"
                          }
                          onClick={() => setPendingAction({ kind: "delete", workspace })}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              第 {pageIndex + 1} 页 · 本页 {visibleWorkspaces.length} 条
              {api.data?.hasMore ? " · 还有更多" : " · 已到最后一页"}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={pageIndex === 0 || api.isLoading}
                title={pageIndex === 0 ? "已是第一页" : "上一页"}
                onClick={goPreviousPage}
              >
                <ChevronLeft aria-hidden="true" />
                上一页
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!api.data?.hasMore || api.isLoading}
                title={!api.data?.hasMore ? "已到最后一页" : "下一页"}
                onClick={goNextPage}
              >
                下一页
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
        </div>
      </section>

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>

      <Sheet
        open={detailWorkspace !== null}
        onOpenChange={(open) => !open && setDetailWorkspace(null)}
      >
        <SheetContent>
          {detailWorkspace ? (
            <>
              <SheetHeader>
                <p className="type-eyebrow">WORKSPACE DETAIL</p>
                <SheetTitle>{detailWorkspace.name}</SheetTitle>
                <SheetDescription>{detailWorkspace.slug}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-wrap gap-2">
                <PlanBadge plan={detailData?.plan ?? detailWorkspace.plan} />
                <AccountStatusBadge status={detailData?.status ?? detailWorkspace.status} />
                <Badge tone="neutral">{detailWorkspace.defaultCurrency}</Badge>
              </div>

              {detail.error ? (
                <div role="alert" className="mt-4 rounded-control border border-accent-red/25 p-3">
                  <p className="type-eyebrow text-accent-red">DETAIL ERROR</p>
                  <p className="mt-1 text-[11px] leading-5 text-body">{detail.error.detail}</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => detail.refetch()}>
                    重试详情
                  </Button>
                </div>
              ) : null}

              <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline">
                {[
                  ["成员", detailData?.memberCount],
                  ["旅行", detailData?.tripCount],
                  ["日志", detailData?.entryCount],
                  [
                    "周起始日",
                    (detailData?.weekStartsOn ?? detailWorkspace.weekStartsOn) === 1 ? "周一" : "周日",
                  ],
                ].map(([label, value]) => (
                  <div key={String(label)} className="bg-surface-1 p-3">
                    <dt className="type-eyebrow">{label}</dt>
                    <dd className="mt-1.5 font-serif text-2xl text-ink">
                      {typeof value === "number" ? countValue(value) : value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-6 rounded-control border border-hairline bg-surface-1 p-3">
                <p className="type-eyebrow">Owner</p>
                <p className="mt-2 text-sm text-ink">{ownerName ?? "未接入"}</p>
                <p className="mt-1 font-mono text-[9px] text-muted">
                  {ownerEmail ?? "需要 GET /v1/admin/workspaces/:id 返回 owner"}
                </p>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline">
                <div className="bg-surface-1 p-3">
                  <p className="type-eyebrow">存储用量</p>
                  <p
                    className="mt-1.5 font-serif text-xl text-ink"
                    title={
                      detailData?.mediaBytes === undefined
                        ? "需要 GET /v1/admin/workspaces/:id 返回 mediaBytes"
                        : undefined
                    }
                  >
                    {detailData?.mediaBytes === undefined
                      ? detailLoading
                        ? "…"
                        : "未接入"
                      : formatBytes(detailData.mediaBytes)}
                  </p>
                </div>
                <div className="bg-surface-1 p-3">
                  <p className="type-eyebrow">成员总数</p>
                  <p className="mt-1.5 font-serif text-xl text-ink">
                    {countValue(detailData?.memberCount ?? detailWorkspace.memberCount)}
                  </p>
                </div>
              </div>

              <section aria-labelledby="workspace-members-heading" className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="workspace-members-heading" className="type-eyebrow">
                    成员
                  </h3>
                  <span className="font-mono text-[9px] text-muted">
                    {members === undefined
                      ? detailLoading
                        ? "读取中"
                        : "未接入"
                      : `${members.length} records`}
                  </span>
                </div>
                {members === undefined ? (
                  <p className="mt-2 text-[11px] leading-5 text-muted">
                    {detailLoading
                      ? "正在读取成员明细…"
                      : "未接入：需要 GET /v1/admin/workspaces/:id 返回 members[]（userId、name、email、role、status、joinedAt）。"}
                  </p>
                ) : members.length > 0 ? (
                  <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
                    {members.map((member) => (
                      <li
                        key={member.userId}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[11px] text-body">{member.name}</p>
                          <p className="truncate font-mono text-[9px] text-muted">{member.email}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge tone="slate">{member.role}</Badge>
                          {member.status === "suspended" ? (
                            <Badge tone="yellow">Suspended</Badge>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[11px] text-muted">没有成员记录。</p>
                )}
              </section>

              <section aria-labelledby="workspace-invitations-heading" className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="workspace-invitations-heading" className="type-eyebrow">
                    邀请状态
                  </h3>
                  <span className="font-mono text-[9px] text-muted">
                    {invitations === undefined
                      ? detailLoading
                        ? "读取中"
                        : "未接入"
                      : `${invitations.length} records`}
                  </span>
                </div>
                {invitations === undefined ? (
                  <p className="mt-2 text-[11px] leading-5 text-muted">
                    {detailLoading
                      ? "正在读取邀请记录…"
                      : "未接入：需要 GET /v1/admin/workspaces/:id 返回 invitations[]（email、role、expiresAt、acceptedAt、revokedAt）。"}
                  </p>
                ) : invitations.length > 0 ? (
                  <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
                    {invitations.map((invitation) => (
                      <li
                        key={invitation.id}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[11px] text-body">{invitation.email}</p>
                          <p className="truncate font-mono text-[9px] text-muted">
                            过期 {formatDateTime(invitation.expiresAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge tone="slate">{invitation.role}</Badge>
                          <Badge
                            tone={
                              invitation.acceptedAt
                                ? "green"
                                : invitation.revokedAt
                                  ? "red"
                                  : "yellow"
                            }
                          >
                            {invitation.acceptedAt
                              ? "Accepted"
                              : invitation.revokedAt
                                ? "Revoked"
                                : "Pending"}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[11px] text-muted">没有邀请记录。</p>
                )}
              </section>

              <section aria-labelledby="workspace-trips-heading" className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="workspace-trips-heading" className="type-eyebrow">
                    最近旅行
                  </h3>
                  <span className="font-mono text-[9px] text-muted">
                    {recentTrips === undefined
                      ? trips.isLoading
                        ? "读取中"
                        : "未接入"
                      : `${recentTrips.length} records`}
                  </span>
                </div>
                {trips.error ? (
                  <p role="alert" className="mt-2 text-[11px] text-accent-red">
                    最近旅行读取失败：{trips.error.code} · {trips.error.detail}
                  </p>
                ) : recentTrips === undefined ? (
                  <p className="mt-2 text-[11px] leading-5 text-muted">
                    {trips.isLoading
                      ? "正在读取最近旅行…"
                      : "未接入：需要 GET /v1/admin/trips?workspaceId=... 返回该租户旅行。"}
                  </p>
                ) : recentTrips.length > 0 ? (
                  <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
                    {recentTrips.map((trip) => (
                      <li key={trip.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] text-body">{trip.title}</p>
                          <p className="mt-0.5 font-mono text-[9px] text-muted">
                            {formatDateTime(trip.updatedAt)}
                          </p>
                        </div>
                        <Badge tone={trip.status === "completed" ? "green" : "blue"}>
                          {trip.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[11px] text-muted">没有近期旅行记录。</p>
                )}
              </section>

              <div className="mt-6 rounded-control border border-hairline bg-surface-1 p-3">
                <p className="type-eyebrow">Workspace settings</p>
                <div className="mt-2 flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-muted">时区</span>
                  <span className="font-mono text-[10px] text-body">
                    {detailData?.timezone ?? detailWorkspace.timezone}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-muted">可见性 / 密度</span>
                  <span className="font-mono text-[10px] text-body">
                    {(detailData?.settings.defaultVisibility ??
                      detailWorkspace.settings.defaultVisibility) ?? "workspace"}{" "}
                    /{" "}
                    {(detailData?.settings.density ?? detailWorkspace.settings.density) ??
                      "comfortable"}
                  </span>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <h3 className="type-eyebrow">运营操作</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    disabled={!canManageContract}
                    title={
                      canManageContract
                        ? "变更套餐并写入审计"
                        : "仅 admin 及以上可变更套餐（后端动作 admin:workspaces:delete）"
                    }
                    onClick={() => openPlanAction(detailWorkspace)}
                  >
                    变更套餐
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!canManageContract || !transferCandidates?.length}
                    title={
                      !canManageContract
                        ? "仅 admin 及以上可转移所有权（后端动作 admin:workspaces:delete）"
                        : transferCandidates?.length
                          ? "转移给活跃成员"
                          : "需要成员详情中存在其他活跃成员"
                    }
                    onClick={() => openTransferAction(detailWorkspace)}
                  >
                    转移所有权
                  </Button>
                </div>
                <p className="text-xs leading-5 text-muted">
                  套餐与所有权通过 PATCH /v1/admin/workspaces/:id 实际提交，后端校验成员资格并在同一事务内写入审计。
                </p>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <DestructiveActionDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={copy?.title ?? ""}
        description={copy?.description ?? ""}
        targetName={pendingAction ? actionTarget(pendingAction) : ""}
        confirmationLabel={
          pendingAction && isBulkWorkspaceAction(pendingAction)
            ? "输入选中数量确认"
            : "输入工作区名称确认"
        }
        confirmActionLabel={copy?.confirmLabel ?? "确认"}
        onConfirm={confirmAction}
        roleOptions={
          pendingAction?.kind === "change-plan"
            ? Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }))
            : pendingAction?.kind === "transfer-owner"
              ? (transferCandidates ?? []).map((member) => ({
                  value: member.userId,
                  label: `${member.name} · ${member.role}`,
                }))
              : undefined
        }
        roleLabel={
          pendingAction?.kind === "transfer-owner" ? "新 Owner" : "新套餐"
        }
        roleValue={
          pendingAction?.kind === "transfer-owner" ? nextOwnerId : nextPlan
        }
        onRoleValueChange={
          pendingAction?.kind === "transfer-owner"
            ? (value) => {
                setNextOwnerId(value);
                const member = transferCandidates?.find((entry) => entry.userId === value);
                if (member && pendingAction.kind === "transfer-owner") {
                  setPendingAction({
                    ...pendingAction,
                    ownerId: member.userId,
                    ownerName: member.name,
                  });
                }
              }
            : pendingAction?.kind === "change-plan"
              ? (value) => {
                  if (value === "free" || value === "pro" || value === "team") {
                    setNextPlan(value);
                    if (pendingAction.kind === "change-plan") {
                      setPendingAction({ ...pendingAction, plan: value });
                    }
                  }
                }
              : undefined
        }
      />
    </div>
  );
}