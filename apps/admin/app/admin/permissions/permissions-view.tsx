"use client";

import { useMemo, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";

import { canPlatform, type AdminPermissionChange, type PlatformRole } from "@roamlog/contracts";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
} from "@roamlog/ui";

import type { AdminConsoleRole } from "../../../lib/admin-types";
import {
  describeAdminPermissionsError,
  useAdminPermissionsMatrix,
  useAdminPermissionsUpdate,
} from "../../../lib/admin-users-permissions";
import { AdminPageHeader } from "../../../components/admin-ui/admin-page-header";
import { PLATFORM_ROLE_LABELS } from "../../../lib/labels";

const LOCKED_TOOLTIP = "安全敏感，界面不可授予";

const ACTION_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  "admin:users:delete": "将用户移入已删除（可恢复）",
  "admin:users:force-logout": "强制退出用户的所有登录",
  "admin:users:reset-2fa": "重置用户两步验证",
  "admin:workspaces:delete": "将工作区移入已删除（可恢复）",
  "admin:media:read": "读取媒体文件",
  "admin:media:delete": "删除媒体文件",
};

function actionDescription(action: string, fallback: string): string {
  return ACTION_DESCRIPTION_OVERRIDES[action] ?? fallback;
}

function cellKey(role: PlatformRole, action: string): string {
  return `${role}:${action}`;
}

interface PermissionsViewProps {
  role: AdminConsoleRole;
}

export function PermissionsView({ role }: PermissionsViewProps) {
  const resource = useAdminPermissionsMatrix();
  const permissionsUpdate = useAdminPermissionsUpdate();
  const canWrite = canPlatform(role, "admin:permissions:write");

  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const data = resource.data;
  const roles = data?.roles ?? [];
  const actions = data?.actions ?? [];

  const changes = useMemo<AdminPermissionChange[]>(() => {
    if (!data) {
      return [];
    }
    const result: AdminPermissionChange[] = [];
    for (const roleEntry of data.roles) {
      for (const actionEntry of data.actions) {
        if (!actionEntry.grantable) {
          continue;
        }
        const key = cellKey(roleEntry.role, actionEntry.action);
        if (!(key in draft)) {
          continue;
        }
        const granted = draft[key] ?? false;
        const base = roleEntry.actions.includes(actionEntry.action);
        if (granted !== base) {
          result.push({
            role: roleEntry.role,
            action: actionEntry.action,
            granted,
          });
        }
      }
    }
    return result;
  }, [data, draft]);

  function toggle(roleName: PlatformRole, action: string, granted: boolean) {
    setDraft((current) => ({ ...current, [cellKey(roleName, action)]: granted }));
    setStatus("");
    setError("");
  }

  async function confirmSave() {
    if (changes.length === 0) {
      setConfirmOpen(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await permissionsUpdate.save(changes);
      // Re-read after saving: the rendered matrix is the server merge, not the
      // optimistic draft, so an operator sees exactly what was persisted.
      resource.refetch();
      setDraft({});
      setStatus(`已保存 ${changes.length} 项变更，并重新拉取矩阵确认。`);
      setConfirmOpen(false);
    } catch (saveError) {
      setError(describeAdminPermissionsError(saveError));
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="信任与安全 / 权限"
        title="权限矩阵"
        description="按平台角色分配管理动作。锁定项属于安全敏感操作，不能在此修改。"
        readOnly={!canWrite}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline-strong bg-surface-1 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="size-4 text-muted" />
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
            {data
              ? `${roles.length} 个角色 · ${actions.length} 项动作 · 变更会记录到审计日志`
              : "读取平台权限矩阵"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {changes.length > 0 ? (
            <Badge tone="yellow">{`${changes.length} 项待保存`}</Badge>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={changes.length === 0 || saving}
            onClick={() => setDraft({})}
          >
            重置草稿
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || changes.length === 0 || saving}
            title={canWrite ? "保存权限矩阵变更" : "只有超级管理员可以修改权限矩阵。"}
            onClick={() => setConfirmOpen(true)}
          >
            {saving ? "保存中…" : "保存变更"}
          </Button>
        </div>
      </div>

      {!canWrite ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <Lock aria-hidden="true" className="size-4" />
          只有超级管理员可以修改权限矩阵。
        </div>
      ) : null}

      {resource.error ? (
        <div role="alert" className="rounded-control border border-accent-red/25 p-4">
          <p className="type-eyebrow text-accent-red">加载失败</p>
          <p className="mt-1 text-[12px] text-body">
            {resource.error.code === "ADMIN_ACTION_FORBIDDEN"
              ? "仅超级管理员可读取权限矩阵。"
              : "读取权限矩阵失败，请稍后重试。"}
          </p>
          <details className="mt-2 font-mono text-[9px] text-muted">
            <summary className="cursor-pointer select-none">技术详情</summary>
            <p className="mt-1 break-all">
              {resource.error.code} · HTTP {resource.error.status || "网络错误"} ·{" "}
              {resource.error.detail}
            </p>
          </details>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => resource.refetch()}>
            重试
          </Button>
        </div>
      ) : resource.isLoading && !data ? (
        <p role="status" className="text-[12px] text-muted">
          正在读取权限矩阵…
        </p>
      ) : !data ? (
        <EmptyState title="没有权限矩阵数据" description="稍后重试；若持续没有数据，请联系平台管理员检查后台状态。" />
      ) : (
        <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <div>
              <h2 className="text-[13px] font-medium text-ink">角色 × 动作</h2>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                锁定项不能在此修改
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left text-[12px]">
              <caption className="sr-only">平台角色与管理员动作权限矩阵</caption>
              <thead>
                <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="min-w-[320px] px-4 py-2.5 font-normal">
                    动作
                  </th>
                  {roles.map((roleEntry) => (
                    <th
                      key={roleEntry.role}
                      scope="col"
                      className="w-32 px-3 py-2.5 text-center font-normal"
                    >
                      {PLATFORM_ROLE_LABELS[roleEntry.role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {actions.map((actionEntry) => {
                  const baseRoles = new Map(
                    roles.map((roleEntry) => [
                      roleEntry.role,
                      roleEntry.actions.includes(actionEntry.action),
                    ]),
                  );
                  return (
                    <tr key={actionEntry.action} className="align-top">
                      <th scope="row" className="px-4 py-3 text-left font-normal">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12px] font-medium text-ink">
                            {actionDescription(actionEntry.action, actionEntry.description)}
                          </span>
                          {!actionEntry.grantable ? (
                            <Badge tone="yellow">锁定</Badge>
                          ) : null}
                        </div>
                        <code className="mt-1 block font-mono text-[9px] text-muted">
                          {actionEntry.action}
                        </code>
                      </th>
                      {roles.map((roleEntry) => {
                        const key = cellKey(roleEntry.role, actionEntry.action);
                        const base = baseRoles.get(roleEntry.role) ?? false;
                        const granted = key in draft ? (draft[key] ?? false) : base;
                        const dirty = granted !== base;
                        if (!actionEntry.grantable) {
                          return (
                            <td
                              key={roleEntry.role}
                              className="px-3 py-3 text-center"
                              title={LOCKED_TOOLTIP}
                            >
                              <span
                                aria-label={`${PLATFORM_ROLE_LABELS[roleEntry.role]} · ${actionEntry.action} · ${LOCKED_TOOLTIP}`}
                                className="inline-flex items-center gap-1 font-mono text-[10px] text-muted"
                              >
                                <Lock aria-hidden="true" className="size-3.5" />
                                {granted ? "是" : "否"}
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td
                            key={roleEntry.role}
                            className={
                              dirty
                                ? "bg-accent-yellow/[0.06] px-3 py-3 text-center"
                                : "px-3 py-3 text-center"
                            }
                          >
                            <Checkbox
                              aria-label={`${PLATFORM_ROLE_LABELS[roleEntry.role]} · ${actionEntry.action}`}
                              checked={granted}
                              disabled={!canWrite}
                              title={
                                canWrite
                                  ? "切换后需二次确认并保存"
                                  : "只有超级管理员可以修改权限矩阵。"
                              }
                              onCheckedChange={(checked) =>
                                toggle(roleEntry.role, actionEntry.action, checked === true)
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-hairline px-4 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              保存后立即生效，并记录本次操作。
            </p>
          </div>
        </section>
      )}

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {error ? <span className="text-accent-red">{error}</span> : status}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="type-eyebrow text-accent-red">二次确认 / 权限写入</p>
            <DialogTitle>保存权限矩阵变更</DialogTitle>
            <DialogDescription>
              将保存 {changes.length} 项变更，并记录到审计日志。锁定项不会改变。
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto font-mono text-[10px] text-body">
            {changes.map((change) => (
              <li key={`${change.role}:${change.action}`}>
                {change.granted ? "授予" : "撤销"} · {PLATFORM_ROLE_LABELS[change.role]} ·{" "}
                {change.action}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="danger" disabled={saving} onClick={() => void confirmSave()}>
              {saving ? "保存中…" : "确认保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
