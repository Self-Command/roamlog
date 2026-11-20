"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  MoreHorizontal,
  PencilLine,
  ShieldAlert,
} from "lucide-react";

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
  FormField,
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
  downloadAdminCsv,
  useAdminUserDetail,
  useAdminUsersPage,
  type AdminMutationPort,
  type AdminUserListParams,
} from "../../lib/admin-data-source";
import { AdminMutationError } from "../../lib/admin-api-error";
import {
  describeAdminUserEditError,
  describeEmailDelivery,
  validateAdminUserProfileForm,
  type AdminUserProfileForm,
  type AdminUserProfileInput,
  type AdminUserProfilePort,
} from "../../lib/admin-users";
import { ADMIN_ROLE_LABELS, ADMIN_CONSOLE_ROLES, type AdminConsoleRole } from "../../lib/admin-types";
import { formatDateTime } from "../../lib/format";
import {
  ACCOUNT_STATUS_LABELS,
  EMAIL_VERIFICATION_STATUS_LABELS,
  PLATFORM_ROLE_LABELS,
  WORKSPACE_ROLE_LABELS,
} from "../../lib/labels";

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
  mutations?: AdminMutationPort;
  exportCsv?: (params: AdminUserListParams) => Promise<void>;
  profiles?: AdminUserProfilePort;
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
function isBulkUserAction(action: UserAction): action is BulkUserAction {
  return (
    action.kind === "bulk-suspend" ||
    action.kind === "bulk-restore" ||
    action.kind === "bulk-delete"
  );
}

function readStoredFilters(): StoredUserFilters {
  if (typeof window === "undefined") {
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
    description: "平台角色与工作区角色完全独立，变更将影响整个后台能力范围。",
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

export function UsersView({ role, mutations, exportCsv, profiles }: UsersViewProps) {
  const [storedFilters] = useState<StoredUserFilters>(() => readStoredFilters());
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
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState<AdminUserProfileForm | null>(null);
  const [profileErrors, setProfileErrors] = useState<
    Partial<Record<keyof AdminUserProfileForm, string>>
  >({});
  const [profileError, setProfileError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");

  const readOnly = role === "analyst";
  const canEditProfile = canPlatform(role, "admin:users:update");
  const canSuspend = canPlatform(role, "admin:users:suspend");
  const canRestore = canPlatform(role, "admin:users:restore");
  const canDelete = canPlatform(role, "admin:users:delete");
  const canChangeRole = canPlatform(role, "admin:users:change-role");
  const canForceLogout = canPlatform(role, "admin:users:force-logout");
  const canResetTwoFactor = canPlatform(role, "admin:users:reset-2fa");
  const canExport = canPlatform(role, "admin:users:delete");
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
  const api = useAdminUsersPage(apiParams);
  const detail = useAdminUserDetail(detailUser?.id ?? null, detailUser !== null);

  useEffect(() => {
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
  }, [query, roleFilter, sortFilter, statusFilter]);

  const visibleUsers: readonly AdminUserListItem[] = api.data?.items ?? [];
  const allVisibleSelected =
    visibleUsers.length > 0 && visibleUsers.every((user) => selectedIds.has(user.id));
  const bulkUsers = visibleUsers.filter((user) => selectedIds.has(user.id));
  const detailData: AdminUserDetail | null = detail.data ?? null;

  useEffect(() => {
    setIsEditingProfile(false);
    setProfileDraft(null);
    setProfileErrors({});
    setProfileError("");
    setProfileMessage("");
  }, [detailUser?.id]);

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

    if (mutations) {
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

    setStatusMessage("未连接后台 API，操作未提交。");
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
          adminUsersExportUrl(apiParams),
          "roamlog-admin-users.csv",
        );
      }
      setStatusMessage("用户 CSV 已按当前筛选导出。");
    } catch (error) {
      setStatusMessage(
        mutationFailureMessage(error, "导出失败，请检查后台 API 与会话后重试。"),
      );
    } finally {
      setIsExporting(false);
    }
  }

  function startEditingProfile() {
    if (!detailUser || !canEditProfile) {
      return;
    }
    const source = detailData ?? detailUser;
    setProfileDraft({
      name: source.name,
      email: source.email,
      locale: source.locale,
      timezone: source.timezone,
      platformRole: source.platformRole,
    });
    setProfileErrors({});
    setProfileError("");
    setProfileMessage("");
    setIsEditingProfile(true);
  }

  function cancelEditingProfile() {
    setIsEditingProfile(false);
    setProfileDraft(null);
    setProfileErrors({});
    setProfileError("");
  }

  function changeProfileField<K extends keyof AdminUserProfileForm>(
    field: K,
    value: AdminUserProfileForm[K],
  ) {
    setProfileDraft((current) => (current ? { ...current, [field]: value } : current));
    setProfileErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function saveProfile() {
    if (!detailUser || !profileDraft) {
      return;
    }
    const errors = validateAdminUserProfileForm(profileDraft);
    setProfileErrors(errors);
    if (Object.keys(errors).length > 0) {
      setProfileError("");
      setProfileMessage("");
      return;
    }

    const source = detailData ?? detailUser;
    const patch: AdminUserProfileInput = {};
    const name = profileDraft.name.trim();
    const email = profileDraft.email.trim();
    const locale = profileDraft.locale.trim();
    const timezone = profileDraft.timezone.trim();
    if (name !== source.name) {
      patch.name = name;
    }
    if (email.toLowerCase() !== source.email.toLowerCase()) {
      patch.email = email;
    }
    if (locale !== source.locale) {
      patch.locale = locale;
    }
    if (timezone !== source.timezone) {
      patch.timezone = timezone;
    }
    if (profileDraft.platformRole !== source.platformRole) {
      patch.platformRole = profileDraft.platformRole;
    }

    if (Object.keys(patch).length === 0) {
      setProfileMessage("没有检测到需要保存的修改。");
      setIsEditingProfile(false);
      return;
    }
    if (!profiles) {
      setProfileError("未连接后台 API，资料未提交。");
      return;
    }

    setIsSavingProfile(true);
    setProfileError("");
    setProfileMessage("");
    try {
      const saved = await profiles.updateProfile(detailUser.id, patch);
      // Re-read both queries: the drawer shows the persisted record, and the
      // server-paginated list must not keep a stale name/email.
      await detail.refetch();
      await api.refetch();
      setProfileDraft({
        name: saved.name,
        email: saved.email,
        locale: saved.locale,
        timezone: saved.timezone,
        platformRole: saved.platformRole,
      });
      setIsEditingProfile(false);
      setProfileMessage(describeEmailDelivery(patch.email ? saved.delivery : undefined));
    } catch (error) {
      setProfileError(describeAdminUserEditError(error));
    } finally {
      setIsSavingProfile(false);
    }
  }

  const copy = pendingAction ? userActionCopy[pendingAction.kind] : null;

  const memberships: ReadonlyArray<{
    workspaceId: string;
    workspaceName: string;
    role: WorkspaceRole;
    status?: "active" | "suspended";
    joinedAt: string;
  }> | undefined =
    detail.data?.workspaces === undefined
      ? undefined
      : detail.data.workspaces.map((membership) => ({
          workspaceId: membership.workspaceId,
          workspaceName: membership.workspaceName,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt,
        }));

  const sessions: ReadonlyArray<{
    id: string;
    device: string;
    ip: string;
    lastSeenAt: string;
    current?: boolean;
  }> | undefined =
    detail.data?.sessions === undefined
      ? undefined
      : detail.data.sessions.map((session) => ({
          id: session.id,
          device: session.userAgent ?? "未记录客户端",
          ip: session.ipAddress ?? "未记录 IP",
          lastSeenAt: session.createdAt,
        }));

  const detailLoading = detail.isLoading && !detail.data;
  const countValue = (value: number | undefined): string | number =>
    value === undefined ? "未接入" : value;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="信任与安全 / 用户"
        title="用户"
        description="按状态与平台角色筛选账户，并执行带审计的受控操作。"
        readOnly={readOnly}
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={isExporting || !canExport}
            title={
              isExporting
                ? "正在生成 CSV"
                : !canExport
                  ? "仅管理员及以上可导出用户 CSV（后端动作 admin:users:delete）"
                  : "按当前搜索与筛选导出全部匹配用户（服务端 CSV）"
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
            placeholder="姓名、邮箱或工作区"
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
            <option value="active">{ACCOUNT_STATUS_LABELS.active}</option>
            <option value="suspended">{ACCOUNT_STATUS_LABELS.suspended}</option>
            <option value="deleted">{ACCOUNT_STATUS_LABELS.deleted}</option>
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
            <option value="user">{PLATFORM_ROLE_LABELS.user}</option>
            <option value="support">{PLATFORM_ROLE_LABELS.support}</option>
            <option value="analyst">{PLATFORM_ROLE_LABELS.analyst}</option>
            <option value="admin">{PLATFORM_ROLE_LABELS.admin}</option>
            <option value="super_admin">{PLATFORM_ROLE_LABELS.super_admin}</option>
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
          {`${visibleUsers.length} 条 / 第 ${pageIndex + 1} 页`}
        </div>
      </AdminFilterBar>

      {readOnly ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          分析员可查看全部用户数据，但所有破坏性操作保持可见且禁用。
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
              用户 / 服务端分页 第 {pageIndex + 1} 页
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
                      {user.emailVerified
                        ? EMAIL_VERIFICATION_STATUS_LABELS.verified
                        : EMAIL_VERIFICATION_STATUS_LABELS.pending}
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
                          title={canChangeRole ? "修改平台角色" : "仅超级管理员可修改平台角色"}
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
      </section>

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>

      <Sheet open={detailUser !== null} onOpenChange={(open) => !open && setDetailUser(null)}>
        <SheetContent>
          {detailUser ? (
            <>
              <SheetHeader>
                <p className="type-eyebrow">用户详情</p>
                <SheetTitle>{detailUser.name}</SheetTitle>
                <SheetDescription>{detailUser.email}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-wrap gap-2">
                <PlatformRoleBadge role={detailUser.platformRole} />
                <AccountStatusBadge status={detailUser.status} />
                <Badge tone={detailUser.emailVerified ? "green" : "yellow"}>
                  {detailUser.emailVerified
                    ? `邮箱${EMAIL_VERIFICATION_STATUS_LABELS.verified}`
                    : `邮箱${EMAIL_VERIFICATION_STATUS_LABELS.pending}`}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canEditProfile || detailLoading || isEditingProfile}
                  title={
                    canEditProfile
                      ? "编辑姓名、邮箱、语言、时区与平台角色"
                      : "仅超级管理员可编辑用户资料"
                  }
                  onClick={startEditingProfile}
                >
                  <PencilLine aria-hidden="true" />
                  编辑资料
                </Button>
                {!canEditProfile ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                    只读 · 仅超级管理员可编辑
                  </span>
                ) : null}
              </div>

              {isEditingProfile && profileDraft ? (
                <section
                  aria-labelledby="user-edit-heading"
                  className="mt-4 space-y-3 rounded-card border border-hairline-strong bg-surface-1 p-4"
                >
                  <h3 id="user-edit-heading" className="type-eyebrow">
                    编辑用户资料
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField id="user-edit-name" label="姓名" required error={profileErrors.name}>
                      <Input
                        autoComplete="off"
                        value={profileDraft.name}
                        onChange={(event) =>
                          changeProfileField("name", event.currentTarget.value)
                        }
                      />
                    </FormField>
                    <FormField id="user-edit-email" label="邮箱" required error={profileErrors.email}>
                      <Input
                        type="email"
                        autoComplete="off"
                        value={profileDraft.email}
                        onChange={(event) =>
                          changeProfileField("email", event.currentTarget.value)
                        }
                      />
                    </FormField>
                    <FormField
                      id="user-edit-locale"
                      label="语言"
                      hint="BCP 47，例如 zh-CN"
                      error={profileErrors.locale}
                    >
                      <Input
                        autoComplete="off"
                        value={profileDraft.locale}
                        onChange={(event) =>
                          changeProfileField("locale", event.currentTarget.value)
                        }
                      />
                    </FormField>
                    <FormField
                      id="user-edit-timezone"
                      label="时区"
                      hint="IANA，例如 Asia/Shanghai"
                      error={profileErrors.timezone}
                    >
                      <Input
                        autoComplete="off"
                        value={profileDraft.timezone}
                        onChange={(event) =>
                          changeProfileField("timezone", event.currentTarget.value)
                        }
                      />
                    </FormField>
                    <FormField id="user-edit-role" label="平台角色">
                      <Select
                        value={profileDraft.platformRole}
                        onChange={(event) =>
                          changeProfileField(
                            "platformRole",
                            event.currentTarget.value as PlatformRole,
                          )
                        }
                      >
                        <option value="user">{PLATFORM_ROLE_LABELS.user}</option>
                        <option value="support">{PLATFORM_ROLE_LABELS.support}</option>
                        <option value="analyst">{PLATFORM_ROLE_LABELS.analyst}</option>
                        <option value="admin">{PLATFORM_ROLE_LABELS.admin}</option>
                        <option value="super_admin">{PLATFORM_ROLE_LABELS.super_admin}</option>
                      </Select>
                    </FormField>
                  </div>
                  <p className="text-[11px] leading-5 text-muted">
                    修改邮箱会把验证状态重置为待验证，并触发一次验证邮件；邮件失败不会回滚资料修改。
                  </p>
                  {profileError ? (
                    <p role="alert" className="text-[11px] leading-5 text-accent-red">
                      {profileError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={isSavingProfile}
                      onClick={() => void saveProfile()}
                    >
                      {isSavingProfile ? "保存中…" : "保存资料"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isSavingProfile}
                      onClick={cancelEditingProfile}
                    >
                      取消
                    </Button>
                  </div>
                </section>
              ) : null}

              {profileMessage ? (
                <p
                  role="status"
                  className="mt-3 rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-[11px] leading-5 text-ink"
                >
                  {profileMessage}
                </p>
              ) : null}

              {profileError && !isEditingProfile ? (
                <p role="alert" className="mt-3 text-[11px] leading-5 text-accent-red">
                  {profileError}
                </p>
              ) : null}

              <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline">
                {[
                  ["注册时间", formatDateTime(detailData?.createdAt ?? detailUser.createdAt)],
                  ["最近活跃", formatDateTime(detailData?.lastActiveAt ?? detailUser.lastActiveAt)],
                  [
                    "邮箱验证",
                    (detailData?.emailVerified ?? detailUser.emailVerified)
                      ? EMAIL_VERIFICATION_STATUS_LABELS.verified
                      : EMAIL_VERIFICATION_STATUS_LABELS.pending,
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

              {detail.error ? (
                <div role="alert" className="mt-4 rounded-control border border-accent-red/25 p-3">
                  <p className="type-eyebrow text-accent-red">详情加载失败</p>
                  <p className="mt-1 text-[11px] leading-5 text-body">{detail.error.detail}</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => detail.refetch()}>
                    重试详情
                  </Button>
                </div>
              ) : null}

              <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline">
                {[
                  ["工作区", detailData?.workspaceCount],
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
                        : `${sessions.length} 条记录`}
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
                      工作区成员关系
                    </h3>
                    <span className="font-mono text-[9px] text-muted">
                      {memberships === undefined
                        ? detailLoading
                          ? "读取中"
                          : "未接入"
                        : `${memberships.length} 条记录`}
                    </span>
                  </div>
                  {memberships === undefined ? (
                    <p className="mt-2 text-[11px] leading-5 text-muted">
                      {detailLoading
                        ? "正在读取工作区成员关系…"
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
                            <Badge tone="slate">{WORKSPACE_ROLE_LABELS[membership.role]}</Badge>
                            {membership.status === "suspended" ? (
                              <Badge tone="yellow">{ACCOUNT_STATUS_LABELS.suspended}</Badge>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted">没有工作区成员关系。</p>
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
                    title={canResetTwoFactor ? "重置双因素认证" : "仅管理员及以上可重置 2FA"}
                    onClick={() => {
                      openAction({ kind: "reset-2fa", user: detailUser });
                    }}
                  >
                    重置 2FA
                  </Button>
                </div>
                <p className="text-xs leading-5 text-muted">
                  操作会提交到后台并写入审计；成功后列表与详情会自动刷新。
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