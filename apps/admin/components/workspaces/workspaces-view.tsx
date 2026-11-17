"use client";

import { useMemo, useState } from "react";
import { Building2, ChevronRight, ShieldAlert } from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type { AccountStatus, AdminWorkspaceDetail, WorkspacePlan } from "@roamlog/contracts";
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
import type { AdminConsoleRole } from "../../lib/fixtures";
import { formatDateTime } from "../../lib/format";
import { recordMockAuditEvent } from "../../lib/mock-audit";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { BulkSelectionBar } from "../admin-ui/bulk-selection-bar";
import { DestructiveActionDialog } from "../admin-ui/destructive-action-dialog";
import { AccountStatusBadge, PlanBadge } from "../admin-ui/status-badge";

type WorkspaceAction =
  | { kind: "suspend"; workspace: AdminWorkspaceDetail }
  | { kind: "restore"; workspace: AdminWorkspaceDetail }
  | { kind: "delete"; workspace: AdminWorkspaceDetail }
  | { kind: "bulk-suspend"; workspaces: AdminWorkspaceDetail[] };

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
    description: "Workspace 将重新对成员开放。当前演示只更新本地 fixture。",
    confirmLabel: "确认恢复",
    action: "admin.workspace.restore",
  },
  delete: {
    title: "删除工作区",
    description: "Workspace 进入软删除状态，管理员可在后续运营页恢复。",
    confirmLabel: "确认删除",
    action: "admin.workspace.delete",
  },
  "bulk-suspend": {
    title: "批量暂停工作区",
    description: "所选 Workspace 会暂停访问。当前演示不会调用真实 API。",
    confirmLabel: "确认批量暂停",
    action: "admin.workspace.bulk-suspend",
  },
};

interface WorkspacesViewProps {
  role: AdminConsoleRole;
  workspaces?: readonly AdminWorkspaceDetail[];
}

export function WorkspacesView({ role, workspaces }: WorkspacesViewProps) {
  const sourceWorkspaces = workspaces ?? getAdminDataSource().listWorkspaces();
  const [records, setRecords] = useState<readonly AdminWorkspaceDetail[]>(sourceWorkspaces);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [planFilter, setPlanFilter] = useState<"all" | WorkspacePlan>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailWorkspace, setDetailWorkspace] = useState<AdminWorkspaceDetail | null>(null);
  const [pendingAction, setPendingAction] = useState<WorkspaceAction | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const readOnly = role === "analyst";
  const canSuspend = canPlatform(role, "admin:workspaces:suspend");
  const canRestore = canPlatform(role, "admin:workspaces:restore");
  const canDelete = canPlatform(role, "admin:workspaces:delete");

  const filteredWorkspaces = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return records.filter((workspace) => {
      const matchesQuery =
        !normalizedQuery ||
        `${workspace.name} ${workspace.slug}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || workspace.status === statusFilter;
      const matchesPlan = planFilter === "all" || workspace.plan === planFilter;
      return matchesQuery && matchesStatus && matchesPlan;
    });
  }, [planFilter, query, records, statusFilter]);

  const allVisibleSelected =
    filteredWorkspaces.length > 0 &&
    filteredWorkspaces.every((workspace) => selectedIds.has(workspace.id));
  const bulkWorkspaces = records.filter((workspace) => selectedIds.has(workspace.id));

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

  function actionTarget(action: WorkspaceAction): string {
    return action.kind === "bulk-suspend"
      ? `${action.workspaces.length} 个工作区`
      : action.workspace.name;
  }

  function confirmAction() {
    if (!pendingAction) {
      return;
    }

    const copy = actionCopy[pendingAction.kind];

    if (pendingAction.kind === "bulk-suspend") {
      const ids = new Set(pendingAction.workspaces.map((workspace) => workspace.id));
      setRecords((current) =>
        current.map((workspace) =>
          ids.has(workspace.id) ? { ...workspace, status: "suspended" } : workspace,
        ),
      );
      setSelectedIds(new Set());
    } else if (pendingAction.kind === "suspend" || pendingAction.kind === "restore") {
      const nextStatus: AccountStatus = pendingAction.kind === "suspend" ? "suspended" : "active";
      setRecords((current) =>
        current.map((workspace) =>
          workspace.id === pendingAction.workspace.id
            ? { ...workspace, status: nextStatus }
            : workspace,
        ),
      );
    } else {
      setRecords((current) =>
        current.map((workspace) =>
          workspace.id === pendingAction.workspace.id
            ? { ...workspace, status: "deleted" }
            : workspace,
        ),
      );
    }

    recordMockAuditEvent({
      action: copy.action,
      targetType: "workspace",
      targetId:
        pendingAction.kind === "bulk-suspend"
          ? `batch-${pendingAction.workspaces.length}`
          : pendingAction.workspace.id,
      targetName: actionTarget(pendingAction),
      metadata: { previousRole: role, mock: true },
    });
    setStatusMessage(`模拟审计事件已记录：${copy.action}`);
    setPendingAction(null);
  }

  const copy = pendingAction ? actionCopy[pendingAction.kind] : null;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="TRUST & SAFETY / WORKSPACES"
        title="工作区"
        description="检查租户状态、所有者、成员规模和内容体量，并执行受平台角色约束的运营操作。"
        readOnly={readOnly}
        actions={
          <div className="rounded-control border border-hairline bg-surface-1 px-3 py-2">
            <p className="type-eyebrow">活跃成员总量</p>
            <p className="mt-1 font-mono text-[11px] text-body">
              {records.reduce((total, workspace) => total + workspace.memberCount, 0)}
            </p>
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
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">状态</span>
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
        <label className="w-full md:w-40">
          <span className="type-eyebrow">套餐</span>
          <Select
            className="mt-1.5 h-9"
            value={planFilter}
            onChange={(event) => setPlanFilter(event.currentTarget.value as "all" | WorkspacePlan)}
          >
            <option value="all">全部套餐</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="team">Team</option>
          </Select>
        </label>
        <span className="flex h-9 items-center border-l border-hairline pl-3 font-mono text-[10px] text-muted max-md:hidden">
          {filteredWorkspaces.length} / {records.length}
        </span>
      </AdminFilterBar>

      {readOnly ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          Analyst 只能查看工作区数据；暂停与删除操作保持可见但不可用。
        </div>
      ) : null}

      <BulkSelectionBar
        count={selectedIds.size}
        noun="个工作区"
        onClear={() => setSelectedIds(new Set())}
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={
              !canSuspend || !bulkWorkspaces.every((workspace) => workspace.status === "active")
            }
            onClick={() => setPendingAction({ kind: "bulk-suspend", workspaces: bulkWorkspaces })}
          >
            批量暂停
          </Button>
        }
      />

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">Workspace 列表</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              tenants / fixture page 1
            </p>
          </div>
          <Badge tone="neutral">fixture</Badge>
        </div>

        {filteredWorkspaces.length === 0 ? (
          <EmptyState
            title="没有匹配工作区"
            description="调整关键词、状态或套餐筛选后再试。"
            className="m-4"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] border-collapse text-left text-[12px]">
              <caption className="sr-only">Workspace 平台列表</caption>
              <thead>
                <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <Checkbox
                      aria-label="全选当前工作区"
                      checked={allVisibleSelected}
                      onCheckedChange={(checked) => {
                        if (checked === true) {
                          setSelectedIds(
                            new Set(filteredWorkspaces.map((workspace) => workspace.id)),
                          );
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
                    更新
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-normal">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filteredWorkspaces.map((workspace) => (
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
                      <span className="block truncate text-[11px] text-body">
                        {workspace.owner.name}
                      </span>
                      <span className="block truncate font-mono text-[9px] text-muted">
                        {workspace.owner.email}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">
                      {workspace.memberCount}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">
                      {workspace.tripCount}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">
                      {workspace.entryCount}
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
                          onClick={() => setDetailWorkspace(workspace)}
                        >
                          <ChevronRight aria-hidden="true" />
                        </Button>
                        <Button
                          variant={workspace.status === "active" ? "ghost" : "outline"}
                          size="sm"
                          aria-label={workspace.status === "active" ? "暂停工作区" : "恢复工作区"}
                          disabled={workspace.status === "active" ? !canSuspend : !canRestore}
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
                <p className="type-eyebrow">WORKSPACE DETAIL / FIXTURE</p>
                <SheetTitle>{detailWorkspace.name}</SheetTitle>
                <SheetDescription>{detailWorkspace.slug}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-wrap gap-2">
                <PlanBadge plan={detailWorkspace.plan} />
                <AccountStatusBadge status={detailWorkspace.status} />
                <Badge tone="neutral">{detailWorkspace.defaultCurrency}</Badge>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline">
                {[
                  ["成员", detailWorkspace.memberCount],
                  ["旅行", detailWorkspace.tripCount],
                  ["日志", detailWorkspace.entryCount],
                  ["周起始日", detailWorkspace.weekStartsOn === 1 ? "周一" : "周日"],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface-1 p-3">
                    <dt className="type-eyebrow">{label}</dt>
                    <dd className="mt-1.5 font-serif text-2xl text-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-6 rounded-control border border-hairline bg-surface-1 p-3">
                <p className="type-eyebrow">Owner</p>
                <p className="mt-2 text-sm text-ink">{detailWorkspace.owner.name}</p>
                <p className="mt-1 font-mono text-[9px] text-muted">
                  {detailWorkspace.owner.email}
                </p>
              </div>

              <div className="mt-6 rounded-control border border-hairline bg-surface-1 p-3">
                <p className="type-eyebrow">Workspace settings</p>
                <div className="mt-2 flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-muted">时区</span>
                  <span className="font-mono text-[10px] text-body">
                    {detailWorkspace.timezone}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-muted">可见性 / 密度</span>
                  <span className="font-mono text-[10px] text-body">
                    {detailWorkspace.settings.defaultVisibility ?? "workspace"} /{" "}
                    {detailWorkspace.settings.density ?? "comfortable"}
                  </span>
                </div>
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
          pendingAction?.kind === "bulk-suspend" ? "输入选中数量确认" : "输入工作区名称确认"
        }
        confirmActionLabel={copy?.confirmLabel ?? "确认"}
        onConfirm={confirmAction}
      />
    </div>
  );
}
