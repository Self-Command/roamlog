"use client";

import { useMemo, useState } from "react";
import { Save, ShieldAlert, ToggleLeft } from "lucide-react";

import type { AdminWorkspaceDetail } from "@roamlog/contracts";
import { Badge, Button, Checkbox, Switch } from "@roamlog/ui";

import { MOCK_ADMIN_WORKSPACES, type AdminConsoleRole } from "../../lib/fixtures";
import { formatDateTime } from "../../lib/format";
import { recordMockAuditEvent } from "../../lib/mock-audit";
import { MOCK_ADMIN_FLAGS, type AdminFlagRecord } from "../../lib/ops-fixtures";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { cn } from "../admin-shell/cn";

interface FlagsViewProps {
  role: AdminConsoleRole;
  flags?: readonly AdminFlagRecord[];
  workspaces?: readonly AdminWorkspaceDetail[];
}

interface FlagDraft {
  enabled: boolean;
  rolloutPercentage: number;
  workspaceAllowlist: string[];
}

function toDraft(flag: AdminFlagRecord): FlagDraft {
  return {
    enabled: flag.enabled,
    rolloutPercentage: flag.rolloutPercentage,
    workspaceAllowlist: [...flag.workspaceAllowlist],
  };
}

function draftMatches(flag: AdminFlagRecord, draft: FlagDraft): boolean {
  return (
    flag.enabled === draft.enabled &&
    flag.rolloutPercentage === draft.rolloutPercentage &&
    flag.workspaceAllowlist.length === draft.workspaceAllowlist.length &&
    flag.workspaceAllowlist.every((id) => draft.workspaceAllowlist.includes(id))
  );
}

export function FlagsView({
  role,
  flags = MOCK_ADMIN_FLAGS,
  workspaces = MOCK_ADMIN_WORKSPACES,
}: FlagsViewProps) {
  const [records, setRecords] = useState<readonly AdminFlagRecord[]>(flags);
  const [drafts, setDrafts] = useState<Record<string, FlagDraft>>(() =>
    Object.fromEntries(flags.map((flag) => [flag.key, toDraft(flag)])),
  );
  const [statusMessage, setStatusMessage] = useState("");

  const canUpdate = role === "super_admin";
  const readOnly = role === "analyst";
  const enabledCount = records.filter((flag) => flag.enabled).length;
  const fullRolloutCount = records.filter((flag) => flag.rolloutPercentage === 100).length;

  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  function updateDraft(key: string, patch: Partial<FlagDraft>) {
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { enabled: false, rolloutPercentage: 0, workspaceAllowlist: [] }), ...patch },
    }));
  }

  function toggleAllowlist(key: string, workspaceId: string, checked: boolean) {
    const current = drafts[key];
    if (!current) {
      return;
    }
    updateDraft(key, {
      workspaceAllowlist: checked
        ? [...current.workspaceAllowlist, workspaceId]
        : current.workspaceAllowlist.filter((id) => id !== workspaceId),
    });
  }

  function saveFlag(flag: AdminFlagRecord) {
    const draft = drafts[flag.key];
    if (!canUpdate || !draft) {
      return;
    }
    const now = new Date().toISOString();
    setRecords((current) =>
      current.map((item) =>
        item.key === flag.key
          ? {
              ...item,
              enabled: draft.enabled,
              rolloutPercentage: draft.rolloutPercentage,
              workspaceAllowlist: [...draft.workspaceAllowlist],
              updatedByName: "当前模拟管理员",
              updatedAt: now,
            }
          : item,
      ),
    );
    recordMockAuditEvent({
      action: "admin.flags.update",
      targetType: "feature_flag",
      targetId: flag.key,
      targetName: flag.label,
      metadata: {
        mock: true,
        key: flag.key,
        enabled: draft.enabled,
        rolloutPercentage: draft.rolloutPercentage,
        allowlistCount: draft.workspaceAllowlist.length,
      },
    });
    setStatusMessage(
      `已保存 ${flag.key}：${draft.enabled ? "开启" : "关闭"} / ${draft.rolloutPercentage}%`,
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="PLATFORM / FEATURE FLAGS"
        title="功能开关"
        description="管理全局开关、灰度比例和 Workspace 白名单。保存会写入本地 fixture 并生成模拟审计；仅 super_admin 可修改。"
        readOnly={readOnly}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">{enabledCount} enabled</Badge>
            <Badge tone="neutral">{fullRolloutCount} full rollout</Badge>
          </div>
        }
      />

      {!canUpdate ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          {readOnly
            ? "Analyst 可查看开关与灰度状态；所有修改控件保持可见但禁用。"
            : "功能开关、平台角色和队列操作均为 super_admin 专属能力。"}
        </div>
      ) : null}

      <section aria-label="功能开关列表" className="space-y-3">
        {records.map((flag) => {
          const draft = drafts[flag.key] ?? toDraft(flag);
          const dirty = !draftMatches(flag, draft);

          return (
            <article
              key={flag.key}
              aria-label={`功能开关 ${flag.key}`}
              className={cn(
                "rounded-card border bg-surface-1 p-4 sm:p-5",
                dirty ? "border-accent-orange/35" : "border-hairline-strong",
              )}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[13px] font-medium text-ink">{flag.label}</h2>
                    <code className="rounded-[3px] border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-muted">
                      {flag.key}
                    </code>
                    {dirty ? <Badge tone="orange">未保存</Badge> : null}
                  </div>
                  <p className="mt-1.5 max-w-2xl text-[11px] leading-5 text-muted">
                    {flag.description}
                  </p>
                  <p className="mt-2 font-mono text-[8px] text-stone">
                    updated by {flag.updatedByName} · {formatDateTime(flag.updatedAt)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3 rounded-control border border-hairline bg-surface-deep px-3 py-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                    Global
                  </span>
                  <Switch
                    aria-label={`${flag.key} 启用`}
                    checked={draft.enabled}
                    disabled={!canUpdate}
                    onCheckedChange={(checked) => updateDraft(flag.key, { enabled: checked })}
                  />
                  <Badge tone={draft.enabled ? "green" : "neutral"}>
                    {draft.enabled ? "Enabled" : "Off"}
                  </Badge>
                </div>
              </div>

              <div className="mt-5 grid gap-4 border-t border-hairline pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
                <div>
                  <div className="flex items-end justify-between gap-3">
                    <label
                      htmlFor={`rollout-${flag.key}`}
                      className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted"
                    >
                      Rollout percentage
                    </label>
                    <span className="font-serif text-2xl leading-none text-ink">
                      {draft.rolloutPercentage}%
                    </span>
                  </div>
                  <input
                    id={`rollout-${flag.key}`}
                    aria-label={`${flag.key} 灰度比例`}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={draft.rolloutPercentage}
                    disabled={!canUpdate}
                    onChange={(event) =>
                      updateDraft(flag.key, { rolloutPercentage: Number(event.currentTarget.value) })
                    }
                    className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-pill border border-hairline-strong bg-surface-2 accent-ink disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <div className="mt-2 flex justify-between font-mono text-[8px] text-stone">
                    <span>0%</span>
                    <span>25%</span>
                    <span>50%</span>
                    <span>75%</span>
                    <span>100%</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                      Workspace allowlist
                    </p>
                    <span className="font-mono text-[9px] text-body">
                      {draft.workspaceAllowlist.length} selected
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {workspaces.map((workspace) => {
                      const checked = draft.workspaceAllowlist.includes(workspace.id);
                      return (
                        <label
                          key={workspace.id}
                          className={cn(
                            "flex min-h-8 items-center gap-2 rounded-control border px-2.5 py-1.5 text-[10px]",
                            checked
                              ? "border-accent-blue/35 bg-accent-blue/[0.06] text-body"
                              : "border-hairline bg-surface-deep text-muted",
                          )}
                        >
                          <Checkbox
                            aria-label={`允许 ${workspace.name}`}
                            checked={checked}
                            disabled={!canUpdate}
                            onCheckedChange={(value) =>
                              toggleAllowlist(flag.key, workspace.id, value === true)
                            }
                            className="size-4 md:size-4"
                          />
                          <span className="max-w-[150px] truncate">{workspace.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  {draft.workspaceAllowlist.length > 0 ? (
                    <p className="mt-2 line-clamp-2 text-[9px] leading-4 text-muted">
                      白名单：
                      {draft.workspaceAllowlist
                        .map((id) => workspaceNameById.get(id) ?? id.slice(-8))
                        .join("、")}
                    </p>
                  ) : (
                    <p className="mt-2 text-[9px] leading-4 text-muted">
                      未配置白名单时，灰度按全局百分比随机命中。
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
                <span className="font-mono text-[8px] text-stone">
                  rules / {draft.enabled ? "active" : "inactive"} / allowlist{" "}
                  {draft.workspaceAllowlist.length}
                </span>
                <Button
                  variant={dirty ? "outline" : "ghost"}
                  size="sm"
                  aria-label="保存配置"
                  disabled={!canUpdate || !dirty}
                  title={canUpdate ? "保存开关配置" : "仅 super_admin 可修改功能开关"}
                  onClick={() => saveFlag(flag)}
                >
                  <Save aria-hidden="true" />
                  保存配置
                </Button>
              </div>
            </article>
          );
        })}
      </section>

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>

      <section className="flex items-start gap-3 rounded-card border border-hairline bg-surface-1 p-4">
        <ToggleLeft aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-orange" />
        <div>
          <h2 className="text-[12px] font-medium text-ink">灰度与白名单同时生效</h2>
          <p className="mt-1 max-w-3xl text-[10px] leading-5 text-muted">
            全局关闭时任何白名单都不生效；开启后，白名单 Workspace 始终命中，其余 Workspace
            按百分比参与灰度。真实实现需由后端 feature-flag 服务提供同样语义，当前页面只演示交互。
          </p>
        </div>
      </section>
    </div>
  );
}
