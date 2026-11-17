"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Download, MoreHorizontal, ShieldAlert } from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type { AccountStatus, AdminUserDetail, PlatformRole } from "@roamlog/contracts";
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

import { getAdminDataSource } from "../../lib/admin-data-source";
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
  | { kind: "suspend"; user: AdminUserDetail }
  | { kind: "restore"; user: AdminUserDetail }
  | { kind: "delete"; user: AdminUserDetail }
  | { kind: "change-role"; user: AdminUserDetail }
  | { kind: "force-logout"; user: AdminUserDetail }
  | { kind: "reset-2fa"; user: AdminUserDetail }
  | { kind: "bulk-suspend"; users: AdminUserDetail[] }
  | { kind: "bulk-restore"; users: AdminUserDetail[] }
  | { kind: "bulk-delete"; users: AdminUserDetail[] };

type BulkUserAction = Extract<
  UserAction,
  { kind: "bulk-suspend" | "bulk-restore" | "bulk-delete" }
>;

function isBulkUserAction(action: UserAction): action is BulkUserAction {
  return (
    action.kind === "bulk-suspend" ||
    action.kind === "bulk-restore" ||
    action.kind === "bulk-delete"
  );
}

interface UsersViewProps {
  role: AdminConsoleRole;
  users?: readonly AdminUserDetail[];
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
    description: "用户进入软删除状态，后续需由管理员恢复。此骨架不会调用真实 API。",
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
    description: "撤销该用户的全部活跃会话。当前演示只记录 mock 事件。",
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
    description: "所选账户会进入暂停状态。当前演示只更新本地 fixture 并记录 mock 审计事件。",
    confirmLabel: "确认批量暂停",
    action: "admin.user.bulk-suspend",
  },
  "bulk-restore": {
    title: "批量恢复账户",
    description: "所选已暂停账户会恢复访问。当前演示只更新本地 fixture 并记录 mock 审计事件。",
    confirmLabel: "确认批量恢复",
    action: "admin.user.bulk-restore",
  },
  "bulk-delete": {
    title: "批量删除账户",
    description: "所选账户进入软删除状态，需由管理员恢复。当前演示只更新本地 fixture。",
    confirmLabel: "确认批量删除",
    action: "admin.user.bulk-delete",
  },
};

export function UsersView({ role, users }: UsersViewProps) {
  const sourceUsers = users ?? getAdminDataSource().listUsers();
  const [records, setRecords] = useState<readonly AdminUserDetail[]>(sourceUsers);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | PlatformRole>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailUser, setDetailUser] = useState<AdminUserDetail | null>(null);
  const [pendingAction, setPendingAction] = useState<UserAction | null>(null);
  const [nextRole, setNextRole] = useState<AdminConsoleRole>("support");
  const [statusMessage, setStatusMessage] = useState("");

  const readOnly = role === "analyst";
  const canSuspend = canPlatform(role, "admin:users:suspend");
  const canRestore = canPlatform(role, "admin:users:restore");
  const canDelete = canPlatform(role, "admin:users:delete");
  const canChangeRole = canPlatform(role, "admin:users:change-role");
  const canForceLogout = canPlatform(role, "admin:users:force-logout");
  const canResetTwoFactor = canPlatform(role, "admin:users:reset-2fa");

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

  const allVisibleSelected =
    filteredUsers.length > 0 && filteredUsers.every((user) => selectedIds.has(user.id));

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

  function confirmAction() {
    if (!pendingAction) {
      return;
    }

    const copy = userActionCopy[pendingAction.kind];

    if (isBulkUserAction(pendingAction)) {
      const ids = new Set(pendingAction.users.map((user) => user.id));
      setRecords((current) =>
        current.map((user) =>
          ids.has(user.id)
            ? {
                ...user,
                status:
                  pendingAction.kind === "bulk-restore"
                    ? "active"
                    : pendingAction.kind === "bulk-delete"
                      ? "deleted"
                      : "suspended",
                activeSessionCount:
                  pendingAction.kind === "bulk-restore" ? user.activeSessionCount : 0,
              }
            : user,
        ),
      );
      setSelectedIds(new Set());
    } else if (pendingAction.kind === "suspend" || pendingAction.kind === "restore") {
      const nextStatus: AccountStatus = pendingAction.kind === "suspend" ? "suspended" : "active";
      setRecords((current) =>
        current.map((user) =>
          user.id === pendingAction.user.id
            ? {
                ...user,
                status: nextStatus,
                activeSessionCount: pendingAction.kind === "suspend" ? 0 : user.activeSessionCount,
              }
            : user,
        ),
      );
    } else if (pendingAction.kind === "delete") {
      setRecords((current) =>
        current.map((user) =>
          user.id === pendingAction.user.id
            ? { ...user, status: "deleted", activeSessionCount: 0 }
            : user,
        ),
      );
    } else if (pendingAction.kind === "change-role") {
      setRecords((current) =>
        current.map((user) =>
          user.id === pendingAction.user.id ? { ...user, platformRole: nextRole } : user,
        ),
      );
    }

    recordMockAuditEvent({
      action: copy.action,
      targetType: "user",
      targetId:
        isBulkUserAction(pendingAction)
          ? `batch-${pendingAction.users.length}`
          : pendingAction.user.id,
      targetName: actionTargetName(pendingAction),
      metadata: {
        previousRole: role,
        mock: true,
        ...(pendingAction.kind === "change-role" ? { nextRole } : {}),
      },
    });

    setStatusMessage(`模拟审计事件已记录：${copy.action}`);
    setPendingAction(null);
  }

  const copy = pendingAction ? userActionCopy[pendingAction.kind] : null;
  const bulkUsers = records.filter((user) => selectedIds.has(user.id));
  const userContext = detailUser ? getUserContext(detailUser.id) : null;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="TRUST & SAFETY / USERS"
        title="用户"
        description="搜索平台账户、检查角色与会话状态，并通过带审计的二次确认执行受控操作。"
        readOnly={readOnly}
        actions={
          <Button variant="ghost" size="sm" disabled title="导出接口将在运营 Wave 接入">
            <Download aria-hidden="true" />
            导出 CSV
          </Button>
        }
      />

      <AdminFilterBar>
        <label className="min-w-0 flex-1">
          <span className="type-eyebrow">搜索用户</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            placeholder="姓名或邮箱"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">账户状态</span>
          <Select
            className="mt-1.5 h-9"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.currentTarget.value as "all" | AccountStatus)
            }
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
            onChange={(event) => setRoleFilter(event.currentTarget.value as "all" | PlatformRole)}
          >
            <option value="all">全部角色</option>
            <option value="user">User</option>
            <option value="support">Support</option>
            <option value="analyst">Analyst</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super admin</option>
          </Select>
        </label>
        <div className="flex h-9 items-center border-l border-hairline pl-3 font-mono text-[10px] text-muted max-md:hidden">
          {filteredUsers.length} / {records.length}
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
              disabled={
                !canRestore || !bulkUsers.some((user) => user.status === "suspended")
              }
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
              users / cursor page 1
            </p>
          </div>
          <Badge tone="neutral">fixture</Badge>
        </div>

        {filteredUsers.length === 0 ? (
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
                          setSelectedIds(new Set(filteredUsers.map((user) => user.id)));
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
                {filteredUsers.map((user) => (
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
                      {user.activeSessionCount}
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
      </section>

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>

      <Sheet open={detailUser !== null} onOpenChange={(open) => !open && setDetailUser(null)}>
        <SheetContent>
          {detailUser ? (
            <>
              <SheetHeader>
                <p className="type-eyebrow">USER DETAIL / FIXTURE</p>
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
                  ["Workspace", detailUser.workspaceCount],
                  ["旅行", detailUser.tripCount],
                  ["日志", detailUser.entryCount],
                  ["活跃会话", detailUser.activeSessionCount],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface-1 p-3">
                    <dt className="type-eyebrow">{label}</dt>
                    <dd className="mt-1.5 font-serif text-2xl text-ink">{value}</dd>
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
                      {userContext?.sessions.length ?? 0} records
                    </span>
                  </div>
                  {userContext && userContext.sessions.length > 0 ? (
                    <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
                      {userContext.sessions.map((item) => (
                        <li key={item.id} className="py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-[11px] text-body">{item.device}</span>
                            {item.current ? <Badge tone="green">Current</Badge> : null}
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
                      {userContext?.memberships.length ?? 0} records
                    </span>
                  </div>
                  {userContext && userContext.memberships.length > 0 ? (
                    <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
                      {userContext.memberships.map((membership) => (
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
                          <Badge tone="slate">{membership.role}</Badge>
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
                      setDetailUser(null);
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
                      setDetailUser(null);
                      openAction({ kind: "reset-2fa", user: detailUser });
                    }}
                  >
                    重置 2FA
                  </Button>
                </div>
                <p className="text-xs leading-5 text-muted">
                  Sheet 与确认对话框均只操作本地 fixture；不会发送真实暂停、删除或认证请求。
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
          pendingAction && isBulkUserAction(pendingAction)
            ? "输入选中数量确认"
            : "输入用户姓名确认"
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
