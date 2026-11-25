"use client";

import { Badge, Button, Checkbox, Input } from "@roamlog/ui";
import { Lock, Search, X } from "lucide-react";
import * as React from "react";

import { isApiError } from "@/lib/api/errors";
import { useAccessGrantContext, useTripAccessGrantsQuery } from "@/lib/api/access-grants";

export interface AccessGrantSelection {
  workspaces: string[];
  users: string[];
}

export interface AccessGrantOption {
  id: string;
  label: string;
  sublabel: string | null;
}

export interface ResolvedGrantLabel {
  targetId: string;
  label: string;
  sublabel: string | null;
}

export type TripAccessGrantEditorStatus = "idle" | "loading" | "error" | "ready";

export interface TripAccessGrantEditor {
  status: TripAccessGrantEditorStatus;
  canManage: boolean;
  selection: AccessGrantSelection;
  setSelection: React.Dispatch<React.SetStateAction<AccessGrantSelection>>;
  workspaceOptions: AccessGrantOption[];
  memberOptions: AccessGrantOption[];
  savedWorkspaces: ResolvedGrantLabel[];
  savedUsers: ResolvedGrantLabel[];
  errorMessage: string | null;
  retry: () => void;
  dirty: boolean;
}

const EMPTY_SELECTION: AccessGrantSelection = { workspaces: [], users: [] };
const MAX_GRANTS_PER_KIND = 50;
const WORKSPACE_ROLE_LABELS: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  viewer: "只读成员",
};

function roleLabel(role: string): string {
  return WORKSPACE_ROLE_LABELS[role] ?? "未知角色";
}

function readableError(error: unknown): string {
  if (!isApiError(error)) return "网络异常，无法读取可见范围。请检查网络后重试。";
  if (error.status === 401) return "登录状态已失效，请重新登录后再试。";
  if (error.status === 403) return "你没有读取可见范围的权限。请联系工作区所有者或管理员。";
  if (error.status === 404) return "找不到这趟旅行，或你没有访问权限。";
  if (error.code === "INVALID_RESPONSE") {
    return "可见范围暂时无法加载，请刷新页面后重试。";
  }
  return "可见范围暂时无法加载，请稍后重试。";
}

function sameIds(left: AccessGrantSelection, right: AccessGrantSelection): boolean {
  if (left.workspaces.length !== right.workspaces.length) return false;
  if (left.users.length !== right.users.length) return false;
  const leftWorkspaces = new Set(left.workspaces);
  const rightWorkspaces = new Set(right.workspaces);
  if (leftWorkspaces.size !== rightWorkspaces.size) return false;
  for (const id of leftWorkspaces) if (!rightWorkspaces.has(id)) return false;
  const leftUsers = new Set(left.users);
  const rightUsers = new Set(right.users);
  if (leftUsers.size !== rightUsers.size) return false;
  for (const id of leftUsers) if (!rightUsers.has(id)) return false;
  return true;
}

/**
 * Owns the asynchronous audience data for a `custom` trip. The form keeps the
 * selected ids so saving stays a pure "read current state" step; the picker
 * below only renders controls when the server role allows a write.
 */
export function useTripAccessGrantEditor(args: {
  mode: "create" | "edit";
  tripId?: string;
  workspaceId: string;
  createdById?: string;
  enabled: boolean;
}): TripAccessGrantEditor {
  const { mode, tripId, workspaceId, createdById, enabled } = args;
  const includeMe = mode === "edit";

  const context = useAccessGrantContext(workspaceId, enabled, includeMe);
  const grants = useTripAccessGrantsQuery(tripId, enabled && mode === "edit");

  const [selection, setSelection] = React.useState<AccessGrantSelection>(EMPTY_SELECTION);
  const [initialSelection, setInitialSelection] = React.useState<AccessGrantSelection | null>(
    null,
  );

  React.useEffect(() => {
    if (!enabled) return;
    if (mode === "create") {
      if (initialSelection === null) setInitialSelection(EMPTY_SELECTION);
      return;
    }
    if (!grants.data || initialSelection !== null) return;
    const next: AccessGrantSelection = {
      workspaces: grants.data.resolved.workspaces.map((target) => target.targetId),
      users: grants.data.resolved.users.map((target) => target.targetId),
    };
    setSelection(next);
    setInitialSelection(next);
  }, [enabled, grants.data, initialSelection, mode]);

  const workspaceRole = context.data?.workspaces.find((item) => item.id === workspaceId)?.role;
  const canManage =
    mode === "create"
      ? true
      : Boolean(
          context.data &&
            workspaceRole &&
            workspaceRole !== "viewer" &&
            (workspaceRole === "owner" ||
              workspaceRole === "admin" ||
              context.data.me?.id === createdById),
        );

  const queryError = context.error ?? (mode === "edit" ? grants.error : null);
  const isLoading =
    enabled &&
    (context.isPending ||
      (mode === "edit" && grants.isPending) ||
      initialSelection === null);
  const status: TripAccessGrantEditorStatus = !enabled
    ? "idle"
    : queryError
      ? "error"
      : isLoading
        ? "loading"
        : "ready";

  const workspaceOptions = (context.data?.workspaces ?? []).map((workspace) => ({
    id: workspace.id,
    label: workspace.name,
    sublabel: `我的角色：${roleLabel(workspace.role)}`,
  }));
  const memberOptions = (context.data?.members ?? []).map((member) => ({
    id: member.userId,
    label: member.user.name || member.user.email,
    sublabel: `${member.user.email} · ${roleLabel(member.role)}`,
  }));
  const savedWorkspaces = (grants.data?.resolved.workspaces ?? []).map((target) => ({
    targetId: target.targetId,
    label: target.label,
    sublabel: target.sublabel,
  }));
  const savedUsers = (grants.data?.resolved.users ?? []).map((target) => ({
    targetId: target.targetId,
    label: target.label,
    sublabel: target.sublabel,
  }));

  return {
    status,
    canManage,
    selection,
    setSelection,
    workspaceOptions,
    memberOptions,
    savedWorkspaces,
    savedUsers,
    errorMessage: queryError ? readableError(queryError) : null,
    retry: () => {
      context.retry();
      if (mode === "edit") void grants.refetch();
    },
    dirty: initialSelection !== null && !sameIds(selection, initialSelection),
  };
}

function labelFor(
  id: string,
  options: readonly AccessGrantOption[],
  saved: readonly ResolvedGrantLabel[],
): AccessGrantOption {
  const option = options.find((item) => item.id === id);
  if (option) return option;
  const resolved = saved.find((item) => item.targetId === id);
  if (resolved) {
    return { id: resolved.targetId, label: resolved.label, sublabel: resolved.sublabel };
  }
  return { id, label: `已选对象 ${id.slice(0, 8)}`, sublabel: null };
}

function SelectedChips({
  selection,
  options,
  saved,
  canManage,
  disabled,
  onRemove,
}: {
  selection: string[];
  options: readonly AccessGrantOption[];
  saved: readonly ResolvedGrantLabel[];
  canManage: boolean;
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  if (selection.length === 0) {
    return <p className="text-xs leading-5 text-stone">还没有指定任何人。</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="已选可见对象">
      {selection.map((id) => {
        const option = labelFor(id, options, saved);
        return (
          <li
            key={id}
            className="inline-flex max-w-full items-center gap-1 rounded-pill border border-hairline-strong bg-surface-2 py-1 pl-2.5 pr-1 text-xs text-body"
          >
            <span className="max-w-[16rem] truncate" title={option.sublabel ?? undefined}>
              {option.label}
            </span>
            {canManage ? (
              <button
                type="button"
                aria-label={`移除${option.label}`}
                disabled={disabled}
                onClick={() => onRemove(id)}
                className="flex size-5 shrink-0 items-center justify-center rounded-pill text-stone transition-colors hover:bg-surface-1 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-40"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function GrantOptionGroup({
  title,
  hint,
  searchLabel,
  emptyLabel,
  noMatchLabel,
  options,
  selected,
  disabled,
  onToggle,
}: {
  title: string;
  hint: string;
  searchLabel: string;
  emptyLabel: string;
  noMatchLabel: string;
  options: readonly AccessGrantOption[];
  selected: readonly string[];
  disabled: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const [query, setQuery] = React.useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? options.filter((option) =>
        `${option.label} ${option.sublabel ?? ""}`.toLowerCase().includes(normalizedQuery),
      )
    : options;
  const selectedSet = new Set(selected);
  const atLimit = selected.length >= MAX_GRANTS_PER_KIND;

  return (
    <div className="min-w-0 rounded-control border border-hairline bg-surface-1/50 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="type-eyebrow">{title}</h4>
        <span className="type-meta tabular-nums">
          {selected.length}/{MAX_GRANTS_PER_KIND}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-stone">{hint}</p>

      <div className="relative mt-2">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="h-9 pl-8 text-xs"
          disabled={disabled}
        />
      </div>

      <div
        role="group"
        aria-label={title}
        className="mt-2 max-h-56 overflow-y-auto overscroll-contain rounded-control border border-hairline-strong bg-canvas/40"
      >
        {options.length === 0 ? (
          <p className="px-3 py-4 text-xs leading-5 text-muted">{emptyLabel}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-4 text-xs leading-5 text-muted">{noMatchLabel}</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {filtered.map((option) => {
              const checked = selectedSet.has(option.id);
              return (
                <li key={option.id}>
                  <label
                    className={
                      disabled || (atLimit && !checked)
                        ? "flex cursor-not-allowed items-start gap-2.5 px-3 py-2.5 opacity-60"
                        : "flex cursor-pointer items-start gap-2.5 px-3 py-2.5 hover:bg-surface-1"
                    }
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled || (atLimit && !checked)}
                      onCheckedChange={(next) => onToggle(option.id, next === true)}
                      aria-label={`选择${title} ${option.label}`}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] leading-5 text-ink">
                        {option.label}
                      </span>
                      {option.sublabel ? (
                        <span className="block truncate text-[11px] leading-4 text-muted">
                          {option.sublabel}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {atLimit ? (
        <p className="mt-1.5 text-[11px] leading-4 text-stone">
          每类最多选择 {MAX_GRANTS_PER_KIND} 个对象。
        </p>
      ) : null}
    </div>
  );
}

export function AccessGrantsField({
  editor,
  disabled,
  error,
}: {
  editor: TripAccessGrantEditor;
  disabled: boolean;
  error?: string;
}) {
  if (editor.status === "idle") return null;

  const workspaceSet = new Set(editor.selection.workspaces);
  const userSet = new Set(editor.selection.users);

  function toggleWorkspace(id: string, checked: boolean) {
    editor.setSelection((current) => {
      if (checked) {
        if (current.workspaces.includes(id) || current.workspaces.length >= MAX_GRANTS_PER_KIND) {
          return current;
        }
        return { ...current, workspaces: [...current.workspaces, id] };
      }
      return { ...current, workspaces: current.workspaces.filter((item) => item !== id) };
    });
  }

  function toggleUser(id: string, checked: boolean) {
    editor.setSelection((current) => {
      if (checked) {
        if (current.users.includes(id) || current.users.length >= MAX_GRANTS_PER_KIND) {
          return current;
        }
        return { ...current, users: [...current.users, id] };
      }
      return { ...current, users: current.users.filter((item) => item !== id) };
    });
  }

  function removeWorkspace(id: string) {
    editor.setSelection((current) => ({
      ...current,
      workspaces: current.workspaces.filter((item) => item !== id),
    }));
  }

  function removeUser(id: string) {
    editor.setSelection((current) => ({
      ...current,
      users: current.users.filter((item) => item !== id),
    }));
  }

  return (
    <section
      id="trip-access-grants"
      tabIndex={-1}
      aria-labelledby="trip-access-grants-title"
      aria-describedby={error ? "trip-access-grants-error" : undefined}
      className="rounded-card border border-hairline bg-surface-1/40 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="trip-access-grants-title" className="text-sm font-medium text-ink">
            可见范围
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            指定可见只影响谁能进入这趟旅行；分享链接与参与者名单相互独立。
          </p>
        </div>
        <Badge tone="blue">自定义受众</Badge>
      </div>

      {error ? (
        <p id="trip-access-grants-error" role="alert" className="mt-3 text-xs leading-5 text-accent-red">
          {error}
        </p>
      ) : null}

      {editor.status === "loading" ? (
        <p role="status" aria-live="polite" className="mt-3 text-xs leading-5 text-muted">
          正在读取可见范围…
        </p>
      ) : null}

      {editor.status === "error" ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-xs leading-5 text-accent-red">
          <span>{editor.errorMessage ?? "可见范围加载失败。"}</span>
          <Button type="button" variant="outline" size="sm" onClick={editor.retry}>
            重新加载
          </Button>
        </div>
      ) : null}

      {editor.status === "ready" && editor.canManage ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="type-eyebrow">已选范围</p>
            <div className="mt-2">
              <SelectedChips
                selection={[...editor.selection.workspaces, ...editor.selection.users]}
                options={[...editor.workspaceOptions, ...editor.memberOptions]}
                saved={[...editor.savedWorkspaces, ...editor.savedUsers]}
                canManage={editor.canManage}
                disabled={disabled}
                onRemove={(id) => {
                  if (workspaceSet.has(id)) removeWorkspace(id);
                  if (userSet.has(id)) removeUser(id);
                }}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <GrantOptionGroup
              title="可见工作区"
              hint="授权后，该工作区的成员都可以阅读这趟旅行。"
              searchLabel="搜索可见工作区"
              emptyLabel="没有可选的工作区。"
              noMatchLabel="没有匹配的工作区。"
              options={editor.workspaceOptions}
              selected={editor.selection.workspaces}
              disabled={disabled}
              onToggle={toggleWorkspace}
            />
            <GrantOptionGroup
              title="可见成员"
              hint="按具体成员授权，不受对方是否参与行程影响。"
              searchLabel="搜索可见成员"
              emptyLabel="没有可选的工作区成员。"
              noMatchLabel="没有匹配的成员。"
              options={editor.memberOptions}
              selected={editor.selection.users}
              disabled={disabled}
              onToggle={toggleUser}
            />
          </div>

          <p className="text-[11px] leading-5 text-stone" role="status">
            {editor.selection.workspaces.length === 0 && editor.selection.users.length === 0
              ? "尚未选择任何对象；请至少选择一个工作区或一位成员后再保存。"
              : `这趟旅行将对 ${editor.selection.workspaces.length} 个工作区、${editor.selection.users.length} 位成员可见。`}
          </p>
        </div>
      ) : null}

      {editor.status === "ready" && !editor.canManage ? (
        <div className="mt-4 space-y-3">
          <div>
            <p className="type-eyebrow">
              当前可见范围
            </p>
            <div className="mt-2">
              <SelectedChips
                selection={[
                  ...editor.savedWorkspaces.map((target) => target.targetId),
                  ...editor.savedUsers.map((target) => target.targetId),
                ]}
                options={[...editor.workspaceOptions, ...editor.memberOptions]}
                saved={[...editor.savedWorkspaces, ...editor.savedUsers]}
                canManage={false}
                disabled
                onRemove={() => undefined}
              />
            </div>
          </div>
          <p
            role="note"
            className="flex items-start gap-2 rounded-control border border-hairline bg-surface-1 px-3 py-2 text-[11px] leading-5 text-muted"
          >
            <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            只有行程创建者或工作区所有者、管理员可以调整可见范围；你仍可以查看当前设置。
          </p>
        </div>
      ) : null}
    </section>
  );
}
