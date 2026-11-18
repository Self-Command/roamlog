"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Save, ShieldAlert, ToggleLeft, Trash2 } from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type { AdminWorkspaceDetail } from "@roamlog/contracts";
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
  FormField,
  Input,
  Switch,
  Textarea,
} from "@roamlog/ui";

import { MOCK_ADMIN_WORKSPACES, type AdminConsoleRole } from "../../lib/fixtures";
import type { AdminDataMode } from "../../lib/admin-data-mode";
import { AdminMutationError } from "../../lib/admin-api-error";
import type { AdminMutationPort } from "../../lib/admin-data-source";
import { formatDateTime } from "../../lib/format";
import { recordMockAuditEvent } from "../../lib/mock-audit";
import { MOCK_ADMIN_FLAGS, type AdminFlagRecord } from "../../lib/ops-fixtures";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { DestructiveActionDialog } from "../admin-ui/destructive-action-dialog";
import { cn } from "../admin-shell/cn";

interface FlagsViewProps {
  role: AdminConsoleRole;
  flags?: readonly AdminFlagRecord[];
  workspaces?: readonly AdminWorkspaceDetail[];
  mode?: AdminDataMode;
  mutations?: AdminMutationPort;
}

interface FlagDraft {
  enabled: boolean;
  rolloutPercentage: number;
  workspaceAllowlist: string[];
}

/** Mirrors `FeatureFlagKeySchema` on the API: lowercase segments, 2-80 chars. */
const FLAG_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

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

interface CreateFlagDraft {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  workspaceAllowlist: string[];
}

const EMPTY_CREATE_DRAFT: CreateFlagDraft = {
  key: "",
  description: "",
  enabled: false,
  rolloutPercentage: 0,
  workspaceAllowlist: [],
};

function validateCreateDraft(draft: CreateFlagDraft, existing: readonly AdminFlagRecord[]): string {
  const key = draft.key.trim();
  if (key.length < 2 || key.length > 80) {
    return "key 长度必须为 2-80 个字符。";
  }
  if (!FLAG_KEY_PATTERN.test(key)) {
    return "key 只能使用小写字母、数字，以及 . _ - 分隔（且必须以字母开头）。";
  }
  if (existing.some((flag) => flag.key === key)) {
    return "该 key 已存在，功能开关 key 必须唯一。";
  }
  if (!draft.description.trim()) {
    return "描述不能为空。";
  }
  if (draft.description.trim().length > 500) {
    return "描述不能超过 500 个字符。";
  }
  if (
    !Number.isInteger(draft.rolloutPercentage) ||
    draft.rolloutPercentage < 0 ||
    draft.rolloutPercentage > 100
  ) {
    return "灰度比例必须是 0-100 的整数。";
  }
  return "";
}

export function FlagsView({
  role,
  flags = MOCK_ADMIN_FLAGS,
  workspaces = MOCK_ADMIN_WORKSPACES,
  mode = "fixture",
  mutations,
}: FlagsViewProps) {
  const [records, setRecords] = useState<readonly AdminFlagRecord[]>(flags);
  const [drafts, setDrafts] = useState<Record<string, FlagDraft>>(() =>
    Object.fromEntries(flags.map((flag) => [flag.key, toDraft(flag)])),
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateFlagDraft>(EMPTY_CREATE_DRAFT);
  const [createError, setCreateError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminFlagRecord | null>(null);

  const canUpdate = canPlatform(role, "admin:flags:update");
  const readOnly = role === "analyst";
  const enabledCount = records.filter((flag) => flag.enabled).length;
  const fullRolloutCount = records.filter((flag) => flag.rolloutPercentage === 100).length;

  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  const unsavedKeys = useMemo(
    () =>
      records
        .filter((flag) => {
          const draft = drafts[flag.key];
          return draft ? !draftMatches(flag, draft) : false;
        })
        .map((flag) => flag.key),
    [drafts, records],
  );

  // Unsaved edits must not disappear silently: block browser unload …
  useEffect(() => {
    if (unsavedKeys.length === 0) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsavedKeys.length]);

  // … and in-app navigations through any anchor in the admin shell.
  useEffect(() => {
    if (unsavedKeys.length === 0) {
      return;
    }
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") {
        return;
      }
      const leave = window.confirm("存在未保存的功能开关修改，离开将丢失更改。确定离开？");
      if (!leave) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [unsavedKeys.length]);

  function updateDraft(key: string, patch: Partial<FlagDraft>) {
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { enabled: false, rolloutPercentage: 0, workspaceAllowlist: [] }),
        ...patch,
      },
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

  function discardDrafts() {
    setDrafts(Object.fromEntries(records.map((flag) => [flag.key, toDraft(flag)])));
    setStatusMessage("已放弃未保存的修改。");
  }

  async function saveFlag(flag: AdminFlagRecord) {
    const draft = drafts[flag.key];
    if (!canUpdate || !draft) {
      return;
    }
    if (mode === "api" && mutations) {
      try {
        await mutations.updateFlag(flag.key, {
          description: flag.description,
          enabled: draft.enabled,
          rolloutPercentage: draft.rolloutPercentage,
          workspaceAllowlist: draft.workspaceAllowlist,
        });
      } catch (error) {
        setStatusMessage(
          error instanceof AdminMutationError
            ? `保存失败：${error.failure.code} · ${error.failure.detail}`
            : "保存失败，请检查 API 与权限后重试。",
        );
        return;
      }
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
              updatedByName: mode === "api" ? "当前管理员" : "当前模拟管理员",
              updatedAt: now,
            }
          : item,
      ),
    );
    if (mode === "fixture") {
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
    }
    setStatusMessage(
      `已保存 ${flag.key}：${draft.enabled ? "开启" : "关闭"} / ${draft.rolloutPercentage}%`,
    );
  }

  function openCreate() {
    setCreateDraft(EMPTY_CREATE_DRAFT);
    setCreateError("");
    setCreateOpen(true);
  }

  async function createFlag() {
    if (!canUpdate) {
      return;
    }
    const key = createDraft.key.trim();
    const error = validateCreateDraft({ ...createDraft, key }, records);
    if (error) {
      setCreateError(error);
      return;
    }

    if (mode === "api" && mutations) {
      try {
        await mutations.createFlag({
          key,
          description: createDraft.description.trim(),
          enabled: createDraft.enabled,
          rolloutPercentage: createDraft.rolloutPercentage,
          workspaceAllowlist: createDraft.workspaceAllowlist,
        });
      } catch (failure) {
        setCreateError(
          failure instanceof AdminMutationError
            ? `创建失败：${failure.failure.code} · ${failure.failure.detail}`
            : "创建失败，请检查 API 与权限后重试。",
        );
        return;
      }
    }

    const now = new Date().toISOString();
    const record: AdminFlagRecord = {
      key,
      label: key,
      description: createDraft.description.trim(),
      enabled: createDraft.enabled,
      rolloutPercentage: createDraft.rolloutPercentage,
      workspaceAllowlist: [...createDraft.workspaceAllowlist],
      updatedByName: mode === "api" ? "当前管理员" : "当前模拟管理员",
      updatedAt: now,
    };
    setRecords((current) => [...current, record].sort((left, right) => left.key.localeCompare(right.key)));
    setDrafts((current) => ({ ...current, [key]: toDraft(record) }));
    if (mode === "fixture") {
      recordMockAuditEvent({
        action: "admin.flags.create",
        targetType: "feature_flag",
        targetId: key,
        targetName: key,
        metadata: {
          mock: true,
          key,
          enabled: record.enabled,
          rolloutPercentage: record.rolloutPercentage,
        },
      });
    }
    setCreateOpen(false);
    setCreateDraft(EMPTY_CREATE_DRAFT);
    setStatusMessage(`已创建 ${key}${mode === "api" ? "（后端已写入并审计）" : ""}`);
  }

  async function deleteFlag() {
    if (!deleteTarget || !canUpdate) {
      return;
    }
    const target = deleteTarget;
    if (mode === "api" && mutations) {
      try {
        await mutations.deleteFlag(target.key);
      } catch (error) {
        setStatusMessage(
          error instanceof AdminMutationError
            ? `删除失败：${error.failure.code} · ${error.failure.detail}`
            : "删除失败，请检查 API 与权限后重试。",
        );
        setDeleteTarget(null);
        return;
      }
    }
    setRecords((current) => current.filter((flag) => flag.key !== target.key));
    setDrafts((current) => {
      const next = { ...current };
      delete next[target.key];
      return next;
    });
    if (mode === "fixture") {
      recordMockAuditEvent({
        action: "admin.flags.delete",
        targetType: "feature_flag",
        targetId: target.key,
        targetName: target.label,
        metadata: { mock: true, key: target.key },
      });
    }
    setDeleteTarget(null);
    setStatusMessage(`已删除 ${target.key}`);
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="PLATFORM / FEATURE FLAGS"
        title="功能开关"
        description="管理全局开关、灰度比例和 Workspace 白名单。仅 super_admin 可创建、修改或删除，写入由后端审计。"
        readOnly={readOnly}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">{enabledCount} enabled</Badge>
            <Badge tone="neutral">{fullRolloutCount} full rollout</Badge>
            <Button
              variant="outline"
              size="sm"
              aria-label="新建功能开关"
              disabled={!canUpdate}
              title={canUpdate ? "新建功能开关" : "仅 super_admin 可创建功能开关"}
              onClick={openCreate}
            >
              <Plus aria-hidden="true" />
              新建开关
            </Button>
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

      {unsavedKeys.length > 0 ? (
        <div
          role="note"
          className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-accent-orange/35 bg-accent-orange/5 px-3 py-2 text-[11px] text-accent-orange"
        >
          <span>
            有 {unsavedKeys.length} 个开关存在未保存的修改：{unsavedKeys.join("、")}
          </span>
          <Button variant="ghost" size="sm" onClick={discardDrafts}>
            放弃更改
          </Button>
        </div>
      ) : null}

      <section aria-label="功能开关列表" className="space-y-3">
        {records.length === 0 ? (
          <EmptyState
            icon={ToggleLeft}
            title="还没有功能开关"
            description={
              canUpdate
                ? "创建第一个开关：key 全局唯一，灰度比例 0-100，可叠加 Workspace 白名单。"
                : "当前没有功能开关。创建需要 super_admin 角色。"
            }
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={!canUpdate}
                title={canUpdate ? "新建第一个功能开关" : "仅 super_admin 可创建功能开关"}
                onClick={openCreate}
              >
                <Plus aria-hidden="true" />
                新建开关
              </Button>
            }
          />
        ) : null}
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
                      updateDraft(flag.key, {
                        rolloutPercentage: Number(event.currentTarget.value),
                      })
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label={`删除开关 ${flag.key}`}
                    disabled={!canUpdate}
                    title={canUpdate ? "删除该功能开关" : "仅 super_admin 可删除功能开关"}
                    onClick={() => setDeleteTarget(flag)}
                  >
                    <Trash2 aria-hidden="true" />
                    删除
                  </Button>
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
            按百分比参与灰度。
            {mode === "api"
              ? "本页的创建、保存与删除都会调用真实 Admin flag mutation，并在后端写入审计。"
              : "当前 fixture 页面只演示交互。"}
          </p>
        </div>
      </section>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="type-eyebrow">FEATURE FLAG / CREATE</p>
            <DialogTitle>新建功能开关</DialogTitle>
            <DialogDescription>
              key 创建后不可修改；灰度百分比必须在 0-100 之间，key 必须全局唯一。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField id="flag-key" label="开关 key" required error={createError || undefined}>
              <Input
                autoComplete="off"
                placeholder="share-password-v2"
                value={createDraft.key}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setCreateDraft((current) => ({ ...current, key: value }));
                  setCreateError("");
                }}
              />
            </FormField>
            <FormField id="flag-description" label="描述" required>
              <Textarea
                value={createDraft.description}
                placeholder="说明该开关控制的用户可见行为。"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setCreateDraft((current) => ({
                    ...current,
                    description: value,
                  }));
                  setCreateError("");
                }}
              />
            </FormField>
            <div className="flex items-center justify-between gap-3 rounded-control border border-hairline bg-surface-deep px-3 py-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                创建时启用
              </span>
              <div className="flex items-center gap-2">
                <Switch
                  aria-label="创建时启用开关"
                  checked={createDraft.enabled}
                  onCheckedChange={(checked) =>
                    setCreateDraft((current) => ({ ...current, enabled: checked }))
                  }
                />
                <Badge tone={createDraft.enabled ? "green" : "neutral"}>
                  {createDraft.enabled ? "Enabled" : "Off"}
                </Badge>
              </div>
            </div>
            <FormField id="flag-rollout" label="灰度比例（0-100）">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={String(createDraft.rolloutPercentage)}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  setCreateDraft((current) => ({
                    ...current,
                    rolloutPercentage: value,
                  }));
                  setCreateError("");
                }}
              />
            </FormField>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                Workspace 白名单（可选）
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {workspaces.map((workspace) => {
                  const checked = createDraft.workspaceAllowlist.includes(workspace.id);
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
                        aria-label={`创建时允许 ${workspace.name}`}
                        checked={checked}
                        onCheckedChange={(value) =>
                          setCreateDraft((current) => ({
                            ...current,
                            workspaceAllowlist:
                              value === true
                                ? [...current.workspaceAllowlist, workspace.id]
                                : current.workspaceAllowlist.filter((id) => id !== workspace.id),
                          }))
                        }
                        className="size-4 md:size-4"
                      />
                      <span className="max-w-[150px] truncate">{workspace.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={createFlag} disabled={!canUpdate}>
              创建开关
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DestructiveActionDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除功能开关"
        description="删除后开关将立即对所有 Workspace 失效，且无法恢复；操作会写入后端审计。"
        targetName={deleteTarget?.key ?? ""}
        confirmationLabel="输入开关 key 确认"
        confirmActionLabel="确认删除"
        onConfirm={deleteFlag}
      />
    </div>
  );
}