"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, MoreHorizontal, ShieldAlert } from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type {
  AccountStatus,
  AdminUserDetail,
  AdminUserListItem,
  PlatformRole,
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
  adminUsersExportUrl,
  buildAdminCsv,
  downloadAdminCsv,
  downloadCsvText,
  getAdminDataSource,
  useAdminUserDetail,
  useAdminUsersPage,
  type AdminMutationPort,
  type AdminUserListParams,
} from "../../lib/admin-data-source";
import type { AdminDataMode } from "../../lib/admin-data-mode";
import { AdminMutationError } from "../../lib/admin-api-error";
import { ADMIN_ROLE_LABELS, ADMIN_CONSOLE_ROLES, type AdminConsoleRole } from "../../lib/fixtures";
import { formatDateTime } from "../../lib/format";
import { recordMockAuditEvent } from "../../lib/mock-audit";
import { getUserContext } from "../../lib/ops-fixtures";
import { cn } from "../admin-shell/cn";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { BulkSelectionBar } from "../admin-ui/bulk-selection-bar";
import { DestructiveActionDialog } from "../admin-ui/destructive-action-dialog";
import { AccountStatusBadge, PlatformRoleBadge } from "../admin-ui/status-badge";

type UserAction =
  | { kind: "suspend"; user: AdminUserListItem }
  | { kind: "restore"; user: AdminUserListItem }
  | { kind: "delete"; user: AdminUserListItem }
  | { kind: "change-role"; user: AdminUserListItem }
  | { kind: "force-logout"; user: AdminUserListItem }
  | { kind: "reset-2fa"; user: AdminUserListItem }
  | { kind: "bulk-suspend"; users: AdminUserListItem[] }
  | { kind: "bulk-restore"; users: AdminUserListItem[] }
  | { kind: "bulk-delete"; users: AdminUserListItem[] };

type BulkUserAction = Extract<
  UserAction,
  { kind: "bulk-suspend" | "bulk-restore" | "bulk-delete" }
>;

interface UsersViewProps {
  role: AdminConsoleRole;
  users?: readonly AdminUserListItem[];
  mode?: AdminDataMode;
  mutations?: AdminMutationPort;
  exportCsv?: (params: AdminUserListParams) => Promise<void>;
}

interface StoredUserFilters {
  query: string;
  status: "all" | AccountStatus;
  role: "all" | PlatformRole;
  sort: string;
}

const USER_SORT_OPTIONS = [
  { value: "createdAt:desc", label: "最新创建" },
  { value: "createdAt:asc", label: "最早创建" },
  { value: "lastActiveAt:desc", label: "最近活跃" },
  { value: "name:asc", label: "姓名 A→Z" },
] as const;

const PAGE_SIZE = 25;
const FILTER_STORAGE_KEY = "roamlog.admin.users.filters";
const DEFAULT_FILTERS: StoredUserFilters = {
  query: "",
  status: "all",
  role: "all",
  sort: "createdAt:desc",
};
const USER_CSV_COLUMNS = [
  "id",
  "email",
  "emailVerified",
  "name",
  "platformRole",
  "status",
  "createdAt",
  "lastActiveAt",
  "deletedAt",
  "workspaceCount",
  "tripCount",
  "entryCount",
  "commentCount",
  "mediaCount",
  "activeSessionCount",
] as const;

function isBulkUserAction(action: UserAction): action is BulkUserAction {
  return (
    action.kind === "bulk-suspend" ||
    action.kind === "bulk-restore" ||
    action.kind === "bulk-delete"
  );
}

function readStoredFilters(mode: AdminDataMode): StoredUserFilters {
  if (mode !== "api" || typeof window === "undefined") {
    return DEFAULT_FILTERS;
  }
  try {
    const raw = window.sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_FILTERS;
    }
    const parsed = JSON.parse(raw) as Partial<StoredUserFilters>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      status:
        parsed.status === "active" || parsed.status === "suspended" || parsed.status === "deleted"
          ? parsed.status
          : "all",
      role:
        parsed.role === "user" ||
        parsed.role === "support" ||
        parsed.role === "analyst" ||
        parsed.role === "admin" ||
        parsed.role === "super_admin"
          ? parsed.role
          : "all",
      sort: USER_SORT_OPTIONS.some((option) => option.value === parsed.sort)
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

const userActionCopy: Record<
  UserAction["kind"],
  { title: string; description: string; confirmLabel: string; action: string }
> = {
  suspend: {
    title: "暂停账户",
    description: "账户将立即失去后台与用户端访问权限，现有会话仍由单独操作撤销。",
    confirmLabel: "确认暂停",
    action: "admin.user.suspend",
  },
  restore: {
    title: "恢复账户",
    description: "账户将恢复用户端访问权限，并重新出现在活跃账户列表中。",
    confirmLabel: "确认恢复",
    action: "admin.user.restore",
  },
  delete: {
    title: "删除用户",
    description: "用户进入软删除状态，后续需由管理员恢复。操作由后端执行并写入审计。",
    confirmLabel: "确认删除",
    action: "admin.user.delete",
  },
  "change-role": {
    title: "修改平台角色",
    description: "平台角色与 Workspace 角色完全独立，变更将影响整个后台能力范围。",
    confirmLabel: "确认修改",
    action: "admin.user.change-role",
  },
  "force-logout": {
    title: "强制登出",
    description: "撤销该用户的全部活跃会话，操作由后端执行并写入审计。",
    confirmLabel: "确认登出",
    action: "admin.user.force-logout",
  },
  "reset-2fa": {
    title: "重置 2FA",
    description: "清除现有 TOTP 绑定，用户下次登录必须重新注册双因素认证。",
    confirmLabel: "确认重置",
    action: "admin.user.reset-2fa",
  },
  "bulk-suspend": {
    title: "批量暂停账户",
    description: "所选账户会进入暂停状态，操作由后端执行并写入审计。",
    confirmLabel: "确认批量暂停",
    action: "admin.user.bulk-suspend",
  },
  "bulk-restore": {
    title: "批量恢复账户",
    description: "所选已暂停账户会恢复访问，操作由后端执行并写入审计。",
    confirmLabel: "确认批量恢复",
    action: "admin.user.bulk-restore",
  },
  "bulk-delete": {
    title: "批量删除账户",
    description: "所选账户进入软删除状态，需由管理员恢复。操作由后端执行并写入审计。",
    confirmLabel: "确认批量删除",
    action: "admin.user.bulk-delete",
  },
};

export function UsersView({ role, users, mode = "fixture", mutations, exportCsv }: UsersViewProps) {
  const sourceUsers = users ?? getAdminDataSource().listUsers();
  const [records, setRecords] = useState<readonly AdminUserListItem[]>(sourceUsers);
  const [storedFilters] = useState<StoredUserFilters>(() => readStoredFilters(mode));
  const [query, setQuery] = useState(storedFilters.query);
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>(storedFilters.status);
  const [roleFilter, setRoleFilter] = useState<"all" | PlatformRole>(storedFilters.role);
  const [sortFilter, setSortFilter] = useState(storedFilters.sort);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailUser, setDetailUser] = useState<AdminUserListItem | null>(null);
  const [pendingAction, setPendingAction] = useState<UserAction | null>(null);
  const [nextRole, setNextRole] = useState<AdminConsoleRole>("support");
  const [statusMessage, setStatusMessage] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const readOnly = role === "analyst";
  const canSuspend = canPlatform(role, "admin:users:suspend");
  const canRestore = canPlatform(role, "admin:users:restore");
  const canDelete = canPlatform(role, "admin:users:delete");
  const canChangeRole = canPlatform(role, "admin:users:change-role");
  const canForceLogout = canPlatform(role, "admin:users:force-logout");
  const canResetTwoFactor = canPlatform(role, "admin:users:reset-2fa");
  const canExport = canPlatform(role, "admin:users:delete");
  const isApi = mode === "api";

  const debouncedQuery = useDebouncedValue(query, 250);
  const apiParams = useMemo<AdminUserListParams>(
    () => ({
      q: debouncedQuery.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      platformRole: roleFilter === "all" ? undefined : roleFilter,
      sort: sortFilter,
      cursor: cursorStack[pageIndex],
      limit: PAGE_SIZE,
    }),
    [cursorStack, debouncedQuery, pageIndex, roleFilter, sortFilter, statusFilter],
  );
  const api = useAdminUsersPage(apiParams, isApi);
  const detail = useAdminUserDetail(detailUser?.id ?? null, isApi && detailUser !== null);

  useEffect(() => {
    if (!isApi) {
      return;
    }
    try {
      window.sessionStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({
        query,
        status: statusFilter,
        role: roleFilter,
        sort: sortFilter,
      }),
      );
    } catch {
      // Session storage can be unavailable in hardened browser contexts.
    }
  }, [isApi, query, roleFilter, sortFilter, statusFilter]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return records.filter((user) => {
      const matchesQuery =
        !normalizedQuery ||
        `${user.name} ${user.email}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || user.status === statusFilter;
      const matchesRole = roleFilter === "all" || user.platformRole === roleFilter;
      return matchesQuery && matchesStatus && matchesRole;
    });
  }, [query, records, roleFilter, statusFilter]);

  const visibleUsers: readonly AdminUserListItem[] = isApi
    ? (api.data?.items ?? [])
    : filteredUsers;
  const allVisibleSelected =
    visibleUsers.length > 0 && visibleUsers.every((user) => selectedIds.has(user.id));
  const bulkUsers = visibleUsers.filter((user) => selectedIds.has(user.id));
  const detailData: AdminUserDetail | null = isApi
    ? (detail.data ?? null)
    : ((detailUser as AdminUserDetail | null) ?? null);

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

  function changeRole(value: "all" | PlatformRole) {
    setRoleFilter(value);
    resetPagination();
  }

  function changeSort(value: string) {
    if (USER_SORT_OPTIONS.some((option) => option.value === value)) {
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

  function setSelected(userId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  }

  function openAction(action: UserAction) {
    if (action.kind === "change-role" && action.user.platformRole !== "user") {
      setNextRole(action.user.platformRole as AdminConsoleRole);
    } else {
      setNextRole("support");
    }
    setPendingAction(action);
  }

  function actionTargetName(action: UserAction): string {
    return isBulkUserAction(action) ? `${action.users.length} 位用户` : action.user.name;
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
    const copy = userActionCopy[action.kind];

    if (isApi && mutations) {
      try {
        if (isBulkUserAction(action)) {
          await Promise.all(
            action.users.map((user) =>
              action.kind === "bulk-delete"
                ? mutations.deleteUser(user.id)
                : mutations.updateUser(user.id, {
                    status: action.kind === "bulk-restore" ? "active" : "suspended",
                  }),
            ),
          );
        } else if (action.kind === "suspend" || action.kind === "restore") {
          await mutations.updateUser(action.user.id, {
            status: action.kind === "suspend" ? "suspended" : "active",
          });
        } else if (action.kind === "delete") {
          await mutations.deleteUser(action.user.id);
        } else if (action.kind === "change-role") {
          await mutations.updateUser(action.user.id, { platformRole: nextRole });
        } else if (action.kind === "force-logout") {
          await mutations.forceLogoutUser(action.user.id);
        } else if (action.kind === "reset-2fa") {
          await mutations.resetUserTwoFactor(action.user.id);
        }
      } catch (error) {
        setStatusMessage(
          mutationFailureMessage(error, "操作失败，请检查 API 与权限后重试。"),
        );
        setPendingAction(null);
        return;
      }

      setPendingAction(null);
      setDetailUser(null);
      setSelectedIds(new Set());
      setStatusMessage(`已提交：${copy.action}（审计由后端写入）`);
      return;
    }

    if (isBulkUserAction(action)) {
      const ids = new Set(action.users.map((user) => user.id));
      setRecords((current) =>
        current.map((user) =>
          ids.has(user.id)
            ? {
                ...user,
                status:
                  action.kind === "bulk-restore"
                    ? "active"
                    : action.kind === "bulk-delete"
                      ? "deleted"
                      : "suspended",
              }
            : user,
        ),
      );
      setSelectedIds(new Set());
    } else if (action.kind === "suspend" || action.kind === "restore") {
      const nextStatus: AccountStatus = action.kind === "suspend" ? "suspended" : "active";
      setRecords((current) =>
        current.map((user) =>
          user.id === action.user.id ? { ...user, status: nextStatus } : user,
        ),
      );
    } else if (action.kind === "delete") {
      setRecords((current) =>
        current.map((user) =>
          user.id === action.user.id ? { ...user, status: "deleted" } : user,
        ),
      );
    } else if (action.kind === "change-role") {
      setRecords((current) =>
        current.map((user) =>
          user.id === action.user.id ? { ...user, platformRole: nextRole } : user,
        ),
      );
    }

    recordMockAuditEvent({
      action: copy.action,
      targetType: "user",
      targetId: isBulkUserAction(action) ? `batch-${action.users.length}` : action.user.id,
      targetName: actionTargetName(action),
      metadata: {
        previousRole: role,
        mock: true,
        ...(action.kind === "change-role" ? { nextRole } : {}),
      },
    });

    setStatusMessage(`模拟审计事件已记录：${copy.action}`);
    setPendingAction(null);
  }

  async function handleExport() {
    if (isExporting || (isApi && !canExport)) {
      return;
    }
    setIsExporting(true);
    setStatusMessage("");
    try {
      if (exportCsv) {
        await exportCsv(apiParams);
      } else if (isApi) {
        await downloadAdminCsv(
          adminUsersExportUrl(apiParams),
          "roamlog-admin-users.csv",
        );
      } else {
        downloadCsvText(
          buildAdminCsv(
            USER_CSV_COLUMNS,
            filteredUsers.map((user) => ({
              ...user,
              workspaceCount: (user as Partial<AdminUserDetail>).workspaceCount,
              tripCount: (user as Partial<AdminUserDetail>).tripCount,
              entryCount: (user as Partial<AdminUserDetail>).entryCount,
              commentCount: (user as Partial<AdminUserDetail>).commentCount,
              mediaCount: (user as Partial<AdminUserDetail>).mediaCount,
            })),
          ),
          "roamlog-admin-users-preview.csv",
        );
      }
      setStatusMessage(
        isApi
          ? "用户 CSV 已按当前筛选导出。"
          : "预览用户 CSV 已导出（fixture 数据，不代表生产）。",
      );
    } catch (error) {
      setStatusMessage(
        mutationFailureMessage(error, "导出失败，请检查 Admin API 与会话后重试。"),
      );
    } finally {
      setIsExporting(false);
    }
  }

  const copy = pendingAction ? userActionCopy[pendingAction.kind] : null;
  const userContext = !isApi && detailUser ? getUserContext(detailUser.id) : null;

  const memberships: ReadonlyArray<{
    workspaceId: string;
    workspaceName: string;
    role: WorkspaceRole;
    status?: "active" | "suspended";
    joinedAt: string;
  }> | undefined = isApi
    ? detail.data?.workspaces === undefined
      ? undefined
      : detail.data.workspaces.map((membership) => ({
          workspaceId: membership.workspaceId,
          workspaceName: membership.workspaceName,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt,
        }))
    : (userContext?.memberships ?? []);

  const sessions: ReadonlyArray<{
    id: string;
    device: string;
    ip: string;
    lastSeenAt: string;
    current?: boolean;
  }> | undefined = isApi
    ? detail.data?.sessions === undefined
      ? undefined
      : detail.data.sessions.map((session) => ({
          id: session.id,
          device: session.userAgent ?? "未记录客户端",
          ip: session.ipAddress ?? "未记录 IP",
          lastSeenAt: session.createdAt,
        }))
    : (userContext?.sessions ?? []);

  const detailLoading = isApi && detail.isLoading && !detail.data;
  const countValue = (value: number | undefined): string | number =>
    value === undefined ? "未接入" : value;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="TRUST & SAFETY / USERS"
        title="用户"
        description="按服务端搜索、状态与平台角色筛选账户，查看真实体量并执行带审计的受控操作。"
        readOnly={readOnly}
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={isExporting || (isApi && !canExport)}
            title={
              isExporting
                ? "正在生成 CSV"
                : isApi && !canExport
                  ? "仅 admin 及以上可导出用户 CSV（后端动作 admin:users:delete）"
                  : isApi
                    ? "按当前搜索与筛选导出全部匹配用户（服务端 CSV）"
                    : "导出当前 fixture 预览数据"
            }
            onClick={() => void handleExport()}
          >
            <Download aria-hidden="true" />
            {isExporting ? "导出中…" : "导出 CSV"}
          </Button>
        }
      />

      <AdminFilterBar>
        <label className="min-w-0 flex-1">
          <span className="type-eyebrow">搜索用户</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            placeholder="姓名、邮箱或 Workspace"
            value={query}
            onChange={(event) => changeQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">账户状态</span>
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
        <label className="w-full md:w-44">
          <span className="type-eyebrow">平台角色</span>
          <Select
            className="mt-1.5 h-9"
            value={roleFilter}
            onChange={(event) => changeRole(event.currentTarget.value as "all" | PlatformRole)}
          >
            <option value="all">全部角色</option>
            <option value="user">User</option>
            <option value="support">Support</option>
            <option value="analyst">Analyst</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super admin</option>
          </Select>
        </label>
        <label className="w-full md:w-44">
          <span className="type-eyebrow">排序</span>
          <Select
            className="mt-1.5 h-9"
            value={sortFilter}
            onChange={(event) => changeSort(event.currentTarget.value)}
          >
            {USER_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex h-9 items-center border-l border-hairline pl-3 font-mono text-[10px] text-muted max-md:hidden">
          {isApi
            ? `${visibleUsers.length} 条 / 第 ${pageIndex + 1} 页`
            : `${filteredUsers.length} / ${records.length}`}
        </div>
      </AdminFilterBar>

      {readOnly ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          Analyst 可查看全部用户数据，但所有破坏性操作保持可见且禁用。
        </div>
      ) : null}

      <BulkSelectionBar
        count={selectedIds.size}
        noun="位用户"
        onClear={() => setSelectedIds(new Set())}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canRestore || !bulkUsers.some((user) => user.status === "suspended")}
              title={canRestore ? "批量恢复所选账户" : "当前平台角色不可恢复账户"}
              onClick={() => openAction({ kind: "bulk-restore", users: bulkUsers })}
            >
              批量恢复
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canSuspend || !bulkUsers.every((user) => user.status === "active")}
              title={canSuspend ? "批量暂停所选账户" : "当前平台角色不可暂停账户"}
              onClick={() => openAction({ kind: "bulk-suspend", users: bulkUsers })}
            >
              批量暂停
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!canDelete}
              title={canDelete ? "批量软删除所选账户" : "当前平台角色不可删除账户"}
              onClick={() => openAction({ kind: "bulk-delete", users: bulkUsers })}
            >
              批量删除
            </Button>
          </>
        }
      />

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">平台账户</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              users / {isApi ? `server page ${pageIndex + 1}` : "fixture page 1"}
            </p>
          </div>
          <Badge tone={isApi ? "green" : "neutral"}>{mode}</Badge>
        </div>

        {isApi && api.error ? (
          <div role="alert" className="m-4 rounded-control border border-accent-red/25 p-4">
            <p className="type-eyebrow text-accent-red">ADMIN API ERROR</p>
            <p className="mt-1 text-[12px] text-body">{api.error.detail}</p>
            <div className="mt-2 flex items-center gap-2 font-mono text-[9px] text-muted">
              <Badge tone="red">{api.error.code}</Badge>
              <span>HTTP {api.error.status || "network"}</span>
            </div>
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => api.refetch()}>
              重试
            </Button>
          </div>
        ) : isApi && api.isLoading && !api.data ? (
          <p role="status" className="m-4 text-[12px] text-muted">
            正在读取用户列表…
          </p>
        ) : visibleUsers.length === 0 ? (
          <EmptyState
            title="没有匹配用户"
            description="调整搜索关键词或筛选条件后再试。"
            className="m-4"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-left text-[12px]">
              <caption className="sr-only">平台用户列表</caption>
              <thead>
                <tr className="border-b border-hairline text-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <Checkbox
                      aria-label="全选当前用户"
                      checked={allVisibleSelected}
                      onCheckedChange={(checked) => {
                        if (checked === true) {
                          setSelectedIds(new Set(visibleUsers.map((user) => user.id)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    用户
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    平台角色
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    状态
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    邮箱验证
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    活跃会话
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    最近活跃
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-normal">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {visibleUsers.map((user) => (
                  <tr
                    key={user.id}
                    aria-label={`用户 ${user.name}`}
                    className={cn(
                      "h-12 transition-colors hover:bg-surface-2/60",
                      selectedIds.has(user.id) && "bg-accent-blue/[0.035]",
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <Checkbox
                        aria-label={`选择 ${user.name}`}
                        checked={selectedIds.has(user.id)}
                        onCheckedChange={(checked) => setSelected(user.id, checked === true)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setDetailUser(user)}
                        className="group flex max-w-[260px] items-center gap-2.5 rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 font-mono text-[9px] text-muted">
                          {user.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium text-ink group-hover:underline group-hover:underline-offset-4">
                            {user.name}
                          </span>
                          <span className="block truncate font-mono text-[9px] text-muted">
                            {user.email}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <PlatformRoleBadge role={user.platformRole} />
                    </td>
                    <td className="px-3 py-1.5">
                      <AccountStatusBadge status={user.status} />
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">
                      {user.emailVerified ? "VERIFIED" : "PENDING"}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">
                      {typeof user.activeSessionCount === "number" ? (
                        user.activeSessionCount
                      ) : (
                        <span title="列表响应未提供活跃会话计数，请打开详情读取 GET /v1/admin/users/:id">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">
                      {formatDateTime(user.lastActiveAt)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="详情"
                          title="查看用户详情"
                          onClick={() => setDetailUser(user)}
                        >
                          <ChevronRight aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="修改平台角色"
                          disabled={!canChangeRole || user.status === "deleted"}
                          title={canChangeRole ? "修改平台角色" : "仅 super_admin 可修改平台角色"}
                          onClick={() => openAction({ kind: "change-role", user })}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                        <Button
                          variant={user.status === "active" ? "ghost" : "outline"}
                          size="sm"
                          aria-label={user.status === "active" ? "暂停账户" : "恢复账户"}
                          title={
                            user.status === "active"
                              ? canSuspend
                                ? "暂停账户"
                                : "当前平台角色不可暂停账户"
                              : canRestore
                                ? "恢复账户"
                                : "当前平台角色不可恢复账户"
                          }
                          disabled={
                            user.status === "active"
                              ? !canSuspend
                              : user.status === "suspended"
                                ? !canRestore
                                : !canRestore
                          }
                          onClick={() =>
                            openAction({
                              kind: user.status === "active" ? "suspend" : "restore",
                              user,
                            })
                          }
                        >
                          {user.status === "active" ? "暂停" : "恢复"}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label="删除用户"
                          title={
                            canDelete
                              ? user.status === "deleted"
                                ? "用户已删除"
                                : "软删除用户"
                              : "当前平台角色不可删除用户"
                          }
                          disabled={!canDelete || user.status === "deleted"}
                          onClick={() => openAction({ kind: "delete", user })}
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

        {isApi ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              第 {pageIndex + 1} 页 · 本页 {visibleUsers.length} 条
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
        ) : null}
      </section>

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>

      <Sheet open={detailUser !== null} onOpenChange={(open) => !open && setDetailUser(null)}>
        <SheetContent>
          {detailUser ? (
            <>
              <SheetHeader>
                <p className="type-eyebrow">USER DETAIL / {mode.toUpperCase()}</p>
                <SheetTitle>{detailUser.name}</SheetTitle>
                <SheetDescription>{detailUser.email}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-wrap gap-2">
                <PlatformRoleBadge role={detailUser.platformRole} />
                <AccountStatusBadge status={detailUser.status} />
                <Badge tone={detailUser.emailVerified ? "green" : "yellow"}>
                  {detailUser.emailVerified ? "Email verified" : "Email pending"}
                </Badge>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline">
                {[
                  ["注册时间", formatDateTime(detailData?.createdAt ?? detailUser.createdAt)],
                  ["最近活跃", formatDateTime(detailData?.lastActiveAt ?? detailUser.lastActiveAt)],
                  [
                    "邮箱验证",
                    (detailData?.emailVerified ?? detailUser.emailVerified) ? "VERIFIED" : "PENDING",
                  ],
                  [
                    "2FA",
                    detailLoading ? (
                      "…"
                    ) : detailData?.twoFactorEnabled === undefined ? (
                      <span
                        key="2fa-unavailable"
                        title="需要 GET /v1/admin/users/:id 返回 twoFactorEnabled；当前详情响应未提供该字段"
                      >
                        未接入
                      </span>
                    ) : detailData.twoFactorEnabled ? (
                      "已启用"
                    ) : (
                      "未启用"
                    ),
                  ],
                ].map(([label, value]) => (
                  <div key={String(label)} className="bg-surface-1 p-3">
                    <dt className="type-eyebrow">{label}</dt>
                    <dd className="mt-1.5 font-mono text-[11px] text-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              {isApi && detail.error ? (
                <div role="alert" className="mt-4 rounded-control border border-accent-red/25 p-3">
                  <p className="type-eyebrow text-accent-red">DETAIL ERROR</p>
                  <p className="mt-1 text-[11px] leading-5 text-body">{detail.error.detail}</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => detail.refetch()}>
                    重试详情
                  </Button>
                </div>
              ) : null}

              <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline">
                {[
                  ["Workspace", detailData?.workspaceCount],
                  ["旅行", detailData?.tripCount],
                  ["日志", detailData?.entryCount],
                  ["活跃会话", detailData?.activeSessionCount],
                  ["评论", detailData?.commentCount],
                  ["媒体", detailData?.mediaCount],
                ].map(([label, value]) => (
                  <div key={String(label)} className="bg-surface-1 p-3">
                    <dt className="type-eyebrow">{label}</dt>
                    <dd
                      className="mt-1.5 font-serif text-2xl text-ink"
                      title={
                        value === undefined
                          ? "需要 GET /v1/admin/users/:id 返回该计数；当前详情响应未提供"
                          : undefined
                      }
                    >
                      {detailLoading ? "…" : countValue(value as number | undefined)}
                    </dd>
                  </div>
                ))}
              </dl>

              {!isApi ? (
                <p className="mt-2 text-[10px] leading-5 text-muted">
                  fixture 预览不提供评论 / 媒体 / 2FA 计数；API 模式由详情接口返回。
                </p>
              ) : null}

              <div className="mt-6 space-y-5">
                <section aria-labelledby="user-sessions-heading">
                  <div className="flex items-center justify-between gap-3">
                    <h3 id="user-sessions-heading" className="type-eyebrow">
                      活跃会话
                    </h3>
                    <span className="font-mono text-[9px] text-muted">
                      {sessions === undefined
                        ? detailLoading
                          ? "读取中"
                          : "未接入"
                        : `${sessions.length} records`}
                    </span>
                  </div>
                  {sessions === undefined ? (
                    <p className="mt-2 text-[11px] leading-5 text-muted">
                      {detailLoading
                        ? "正在读取会话明细…"
                        : "未接入：需要 GET /v1/admin/users/:id 返回 sessions[]（id、ipAddress、userAgent、createdAt、expiresAt）。"}
                    </p>
                  ) : sessions.length > 0 ? (
                    <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
                      {sessions.map((item) => (
                        <li key={item.id} className="py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-[11px] text-body">{item.device}</span>
                            {!isApi && item.current ? <Badge tone="green">Current</Badge> : null}
                          </div>
                          <p className="mt-1 font-mono text-[9px] text-muted">
                            {item.ip} · {formatDateTime(item.lastSeenAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted">没有活跃会话。</p>
                  )}
                </section>

                <section aria-labelledby="user-memberships-heading">
                  <div className="flex items-center justify-between gap-3">
                    <h3 id="user-memberships-heading" className="type-eyebrow">
                      Workspace 成员关系
                    </h3>
                    <span className="font-mono text-[9px] text-muted">
                      {memberships === undefined
                        ? detailLoading
                          ? "读取中"
                          : "未接入"
                        : `${memberships.length} records`}
                    </span>
                  </div>
                  {memberships === undefined ? (
                    <p className="mt-2 text-[11px] leading-5 text-muted">
                      {detailLoading
                        ? "正在读取 Workspace 成员关系…"
                        : "未接入：需要 GET /v1/admin/users/:id 返回 workspaces[]（workspaceId、workspaceName、role、status、joinedAt）。"}
                    </p>
                  ) : memberships.length > 0 ? (
                    <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
                      {memberships.map((membership) => (
                        <li
                          key={membership.workspaceId}
                          className="flex items-center justify-between gap-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[11px] text-body">
                              {membership.workspaceName}
                            </p>
                            <p className="mt-0.5 font-mono text-[9px] text-muted">
                              加入 {formatDateTime(membership.joinedAt)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Badge tone="slate">{membership.role}</Badge>
                            {membership.status === "suspended" ? (
                              <Badge tone="yellow">Suspended</Badge>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted">没有 Workspace 成员关系。</p>
                  )}
                </section>
              </div>

              <div className="mt-6 space-y-3">
                <h3 className="type-eyebrow">安全操作</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    disabled={!canForceLogout}
                    title={canForceLogout ? "撤销全部会话" : "当前角色不可执行"}
                    onClick={() => {
                      openAction({ kind: "force-logout", user: detailUser });
                    }}
                  >
                    强制登出
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!canResetTwoFactor}
                    title={canResetTwoFactor ? "重置双因素认证" : "仅 admin 及以上可重置 2FA"}
                    onClick={() => {
                      openAction({ kind: "reset-2fa", user: detailUser });
                    }}
                  >
                    重置 2FA
                  </Button>
                </div>
                <p className="text-xs leading-5 text-muted">
                  {isApi
                    ? "API 模式下操作会发送真实 Admin mutation，并由后端权限与审计规则约束；成功后列表与详情会自动刷新。"
                    : "Sheet 与确认对话框均只操作本地 fixture；不会发送真实暂停、删除或认证请求。"}
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
        targetName={pendingAction ? actionTargetName(pendingAction) : ""}
        confirmationLabel={
          pendingAction && isBulkUserAction(pendingAction) ? "输入选中数量确认" : "输入用户姓名确认"
        }
        confirmActionLabel={copy?.confirmLabel ?? "确认"}
        onConfirm={confirmAction}
        roleOptions={
          pendingAction?.kind === "change-role"
            ? ADMIN_CONSOLE_ROLES.map((item) => ({
                value: item,
                label: ADMIN_ROLE_LABELS[item],
              }))
            : undefined
        }
        roleValue={nextRole}
        onRoleValueChange={
          pendingAction?.kind === "change-role"
            ? (value) => {
                if (
                  value === "support" ||
                  value === "analyst" ||
                  value === "admin" ||
                  value === "super_admin"
                ) {
                  setNextRole(value);
                }
              }
            : undefined
        }
      />
    </div>
  );
}