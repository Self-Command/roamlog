"use client";

import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Save,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SETTINGS_GROUP_LABELS,
  type AdminSettingItem,
  type AdminSettingsGroup,
  type AdminSettingsResponse,
  type SystemSettingGroup,
} from "@roamlog/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
} from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/admin-types";
import { AdminMutationError, type AdminApiFailure } from "../../lib/admin-api-error";
import { AdminSettingsError, type AdminSettingsApi } from "../../lib/admin-settings-api";
import {
  SETTINGS_CONSUMPTION,
  SETTINGS_GROUP_SUMMARIES,
  SETTINGS_REVEAL_DURATION_MS,
  collectGroupUpdates,
  draftFromItem,
  draftFromItems,
  dirtySettingKeys,
  groupItems,
  groupLabel,
  latestUpdatedAt,
  localSettingError,
  normalizeSettingsGroup,
  settingsGroupHref,
  type SettingDraftValue,
} from "../../lib/admin-settings";
import { formatDateTime } from "../../lib/format";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { cn } from "../admin-shell/cn";
import { SettingField } from "./setting-field";

interface SettingsConsoleProps {
  role: AdminConsoleRole;
  initialGroup: SystemSettingGroup;
  api: AdminSettingsApi;
}

interface ConsoleBanner {
  tone: "error" | "warning";
  title: string;
  detail?: string;
  action?: "save" | "reload";
}

interface RevealedSecret {
  key: string;
  value: string;
  expiresAt: number;
}

function failureOf(error: unknown): AdminApiFailure {
  if (error instanceof AdminMutationError) {
    return error.failure;
  }
  return {
    code: "ADMIN_API_NETWORK",
    status: 0,
    title: "Admin API unavailable",
    detail: error instanceof Error ? error.message : "The Admin API request could not be completed.",
    degraded: [],
  };
}

function permissionText(failure: AdminApiFailure): string | null {
  if (failure.code === "ADMIN_2FA_REQUIRED") {
    return "需要完成 TOTP 2FA 验证后才能访问系统设置。";
  }
  if (failure.status === 403 || failure.code === "ADMIN_ACCESS_DENIED") {
    return "需要超级管理员权限。";
  }
  if (failure.status === 401 || failure.code === "UNAUTHENTICATED") {
    return "会话已过期，请重新登录。";
  }
  return null;
}

function revealErrorText(failure: AdminApiFailure): string {
  if (failure.code === "ADMIN_2FA_REQUIRED") {
    return "需要完成 TOTP 2FA 验证后才能显示敏感值。";
  }
  if (failure.status === 403 || failure.code === "ADMIN_ACCESS_DENIED") {
    return "需要超级管理员权限，无法显示敏感值。";
  }
  if (failure.status === 401 || failure.code === "UNAUTHENTICATED") {
    return "会话已过期，请重新登录。";
  }
  if (failure.status === 422) {
    return "确认参数无效，请重新打开确认框后重试。";
  }
  return `显示失败（${failure.code}），请稍后重试。`;
}

function replaceGroup(
  response: AdminSettingsResponse,
  fresh: AdminSettingsResponse,
  group: SystemSettingGroup,
): AdminSettingsResponse {
  const nextGroup = fresh.groups.find((entry) => entry.group === group);
  if (!nextGroup) {
    return fresh;
  }
  return {
    ...response,
    groups: response.groups.map((entry) => (entry.group === group ? nextGroup : entry)),
    generatedAt: fresh.generatedAt,
  };
}

function groupOf(response: AdminSettingsResponse, group: SystemSettingGroup): AdminSettingsGroup | null {
  return response.groups.find((entry) => entry.group === group) ?? null;
}

export function SettingsConsole({ role, initialGroup, api }: SettingsConsoleProps) {
  const [group, setGroup] = useState<SystemSettingGroup>(normalizeSettingsGroup(initialGroup));
  const [response, setResponse] = useState<AdminSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<AdminApiFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [values, setValues] = useState<Record<string, SettingDraftValue>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<ConsoleBanner | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [revealSeconds, setRevealSeconds] = useState<number | null>(null);
  const [revealTarget, setRevealTarget] = useState<AdminSettingItem | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealErrors, setRevealErrors] = useState<Record<string, string>>({});

  const canWrite = role === "super_admin";

  const applyDrafts = useCallback((items: readonly AdminSettingItem[], resetSecrets: boolean) => {
    setValues((current) => ({ ...current, ...draftFromItems(items) }));
    if (resetSecrets) {
      setSecretDrafts((current) => {
        const next = { ...current };
        for (const item of items) {
          if (item.type === "secret") {
            next[item.key] = "";
          }
        }
        return next;
      });
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.list();
      setResponse(data);
      setValues(
        Object.fromEntries(
          data.groups.flatMap((entry) =>
            entry.items.map((item) => [item.key, draftFromItem(item)] as const),
          ),
        ),
      );
      setSecretDrafts({});
      setServerErrors({});
      setBanner(null);
    } catch (error) {
      setLoadError(failureOf(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 5_000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!revealed) {
      setRevealSeconds(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((revealed.expiresAt - Date.now()) / 1_000));
      if (left <= 0) {
        setRevealed(null);
        setRevealSeconds(null);
        return;
      }
      setRevealSeconds(left);
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [revealed]);

  const items = useMemo(
    () => (response ? groupItems(response, group) : []),
    [response, group],
  );

  const dirtyKeys = useMemo(
    () => dirtySettingKeys(items, values, secretDrafts),
    [items, values, secretDrafts],
  );

  const localErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const item of items) {
      if (item.type === "secret") {
        continue;
      }
      const error = localSettingError(item, values[item.key] ?? draftFromItem(item));
      if (error) {
        errors[item.key] = error;
      }
    }
    return errors;
  }, [items, values]);

  const errors = useMemo(
    () => ({ ...localErrors, ...serverErrors }),
    [localErrors, serverErrors],
  );

  const canSave =
    canWrite && dirtyKeys.length > 0 && Object.keys(localErrors).length === 0 && !saving;

  const activeGroup = response ? groupOf(response, group) : null;
  const latest = latestUpdatedAt(items);

  function changeValue(key: string, value: SettingDraftValue) {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function changeSecret(key: string, value: string) {
    setSecretDrafts((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function discardDrafts() {
    applyDrafts(items, true);
    setServerErrors({});
    setBanner(null);
    setRevealed(null);
    setToast("已放弃当前分组的未保存修改。");
  }

  function selectGroup(next: SystemSettingGroup) {
    if (next === group) {
      return;
    }
    if (
      dirtyKeys.length > 0 &&
      !window.confirm("当前分组有未保存的修改；切换分组会保留草稿但不会提交。继续？")
    ) {
      return;
    }
    setGroup(next);
    setServerErrors({});
    setBanner(null);
    setRevealErrors({});
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", settingsGroupHref(next));
    }
  }

  async function save(): Promise<void> {
    if (!canSave) {
      return;
    }
    const collected = collectGroupUpdates(items, values, secretDrafts);
    if (Object.keys(collected.errors).length > 0) {
      setServerErrors((current) => ({ ...current, ...collected.errors }));
      return;
    }
    if (collected.updates.length === 0) {
      return;
    }

    setSaving(true);
    setBanner(null);
    setServerErrors({});

    let updatedCount: number;
    try {
      const result = await api.update(collected.updates);
      updatedCount = result.updated.length;
    } catch (error) {
      const failure = failureOf(error);
      if (error instanceof AdminSettingsError && error.status === 422) {
        setServerErrors(error.errorsByField);
        setBanner({
          tone: "error",
          title: "有字段未通过服务端校验",
          detail: "已保留你填写的内容；修正标记的字段后再次保存。",
          action: "save",
        });
      } else {
        const permission = permissionText(failure);
        setBanner({
          tone: "error",
          title: permission ?? "保存失败，可重试",
          detail: permission
            ? `${failure.code} · ${failure.detail}`
            : `未写入任何设置，输入已保留。${failure.code} · ${failure.detail}`,
          ...(permission ? {} : { action: "save" as const }),
        });
      }
      setSaving(false);
      return;
    }

    // Re-read from the server so a toast can never claim a value that did not
    // reach the database (wrong column, cache bug, or a silently rejected key).
    let fresh: AdminSettingsResponse;
    try {
      fresh = await api.list();
    } catch (error) {
      const failure = failureOf(error);
      setToast(`已提交 ${updatedCount} 项设置，但重新读取失败。`);
      setBanner({
        tone: "warning",
        title: "保存已提交，但重新读取失败",
        detail: `服务器可能已经写入；请重新读取确认。${failure.code} · ${failure.detail}`,
        action: "reload",
      });
      setSaving(false);
      return;
    }

    setResponse((current) => (current ? replaceGroup(current, fresh, group) : fresh));
    applyDrafts(groupItems(fresh, group), true);
    setRevealed(null);
    setBanner(null);
    setServerErrors({});
    setToast(`已保存并重新读取 ${updatedCount} 项设置。`);
    setSaving(false);
  }

  async function refresh(): Promise<void> {
    if (
      dirtyKeys.length > 0 &&
      !window.confirm("当前分组有未保存的修改，重新读取会丢弃它们。继续？")
    ) {
      return;
    }
    setRefreshing(true);
    setBanner(null);
    try {
      const data = await api.list();
      setResponse(data);
      setValues(
        Object.fromEntries(
          data.groups.flatMap((entry) =>
            entry.items.map((item) => [item.key, draftFromItem(item)] as const),
          ),
        ),
      );
      setSecretDrafts({});
      setServerErrors({});
      setRevealErrors({});
      setRevealed(null);
      setToast("已从服务器重新读取设置。");
    } catch (error) {
      const failure = failureOf(error);
      setBanner({
        tone: "error",
        title: permissionText(failure) ?? "重新读取失败",
        detail: `${failure.code} · ${failure.detail}`,
        action: "reload",
      });
    } finally {
      setRefreshing(false);
    }
  }

  function requestReveal(item: AdminSettingItem) {
    setRevealErrors((current) => {
      if (!current[item.key]) {
        return current;
      }
      const next = { ...current };
      delete next[item.key];
      return next;
    });
    setRevealTarget(item);
  }

  async function confirmReveal(): Promise<void> {
    if (!revealTarget) {
      return;
    }
    const target = revealTarget;
    setRevealing(true);
    try {
      const result = await api.reveal(target.key);
      setRevealed({
        key: result.key,
        value: result.value,
        expiresAt: Date.now() + SETTINGS_REVEAL_DURATION_MS,
      });
      setRevealTarget(null);
      setToast(`已显示 ${target.label}；本次操作已写入审计。`);
    } catch (error) {
      const failure = failureOf(error);
      setRevealErrors((current) => ({
        ...current,
        [target.key]: revealErrorText(failure),
      }));
      setRevealTarget(null);
    } finally {
      setRevealing(false);
    }
  }

  function runBannerAction(action: "save" | "reload") {
    if (action === "save") {
      void save();
    } else {
      void refresh();
    }
  }

  if (loading && !response) {
    return (
      <div role="status" aria-live="polite" className="space-y-4">
        <div className="rounded-card border border-hairline-strong bg-surface-1 px-4 py-3">
          <p className="type-eyebrow">SETTINGS / LOADING</p>
          <p className="mt-1 text-[12px] text-muted">正在从 Admin API 读取平台设置。</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="h-64 animate-pulse rounded-card border border-hairline bg-surface-1" />
          <div className="h-64 animate-pulse rounded-card border border-hairline bg-surface-1" />
        </div>
      </div>
    );
  }

  if (loadError) {
    const permission = permissionText(loadError);
    return (
      <section
        role="alert"
        className="mx-auto max-w-2xl rounded-card border border-accent-red/25 bg-surface-1 p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-pill border border-accent-red/25 bg-accent-red/10 text-accent-red">
            <ShieldAlert aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="type-eyebrow text-accent-red">
              {permission ? "SETTINGS / ACCESS DENIED" : "SETTINGS / LOAD FAILED"}
            </p>
            <h1 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">
              {permission ?? "设置加载失败"}
            </h1>
            <p className="mt-2 text-[12px] leading-6 text-muted">
              {permission
                ? "系统设置只对超级管理员开放；如果已具备角色，请确认 TOTP 2FA 已完成。"
                : "无法从 Admin API 读取设置。请检查 API 状态后重试；不会显示任何本地默认值冒充真实配置。"}
            </p>
            <details className="mt-3 font-mono text-[9px] text-stone">
              <summary className="cursor-pointer select-none">错误详情</summary>
              <p className="mt-1 break-all">
                {loadError.code} · HTTP {loadError.status || "network"} · {loadError.detail}
              </p>
            </details>
            <Button variant="outline" className="mt-5" onClick={() => void load()}>
              <RefreshCw aria-hidden="true" />
              重试
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (!response || !activeGroup) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="没有可显示的分组"
        description="Admin API 没有返回该设置分组，请重新读取或检查后端契约。"
        action={
          <Button variant="outline" onClick={() => void refresh()}>
            重新读取
          </Button>
        }
        className="rounded-card border border-hairline-strong bg-surface-1"
      />
    );
  }

  const groupDirtyCount = dirtyKeys.length;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="PLATFORM / SETTINGS"
        title="系统设置"
        description="按分组编辑运行期配置。保存会调用 PATCH /v1/admin/settings，并由服务端逐键校验、写入与审计；保存成功后重新读取确认。"
        readOnly={!canWrite}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="重新读取设置"
              disabled={saving || refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />
              重新读取
            </Button>
            {groupDirtyCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={discardDrafts} disabled={saving}>
                <Undo2 aria-hidden="true" />
                放弃更改
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              aria-label="保存更改"
              disabled={!canSave}
              onClick={() => void save()}
            >
              <Save aria-hidden="true" />
              {saving ? "保存中…" : "保存更改"}
            </Button>
          </div>
        }
      />

      {!canWrite ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          系统设置需要超级管理员权限；当前角色只能查看，保存按钮保持禁用。
        </div>
      ) : null}

      {banner ? (
        <div
          role="alert"
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-control border px-3 py-2.5 text-[11px]",
            banner.tone === "warning"
              ? "border-accent-yellow/30 bg-accent-yellow/5 text-accent-yellow"
              : "border-accent-red/30 bg-accent-red/5 text-accent-red",
          )}
        >
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{banner.title}</p>
            {banner.detail ? <p className="mt-0.5 leading-5 opacity-90">{banner.detail}</p> : null}
          </div>
          {banner.action ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => runBannerAction(banner.action as "save" | "reload")}
            >
              {banner.action === "save" ? "重试保存" : "重新读取"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="设置分组" className="h-fit rounded-card border border-hairline-strong bg-surface-1 p-2">
          <p className="type-eyebrow px-2 pb-2 pt-1">SETTINGS GROUPS</p>
          <div className="space-y-0.5">
            {response.groups.map((entry) => {
              const active = entry.group === group;
              const dirty = dirtySettingKeys(entry.items, values, secretDrafts).length;
              return (
                <a
                  key={entry.group}
                  href={settingsGroupHref(entry.group)}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    selectGroup(entry.group);
                  }}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-control px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1",
                    active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {dirty > 0 ? (
                    <span
                      aria-label={`${entry.label} 有 ${dirty} 项未保存`}
                      className="size-1.5 rounded-pill bg-accent-orange"
                    />
                  ) : null}
                  <span className="font-mono text-[9px] text-stone">{entry.items.length}</span>
                </a>
              );
            })}
          </div>
        </nav>

        <section aria-label={`${groupLabel(group)} 设置`} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-3">
            <div>
              <p className="type-eyebrow">GROUP / {group.toUpperCase()}</p>
              <h2 className="mt-1 font-serif text-xl tracking-[-0.02em] text-ink">
                {SETTINGS_GROUP_LABELS[group]}
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                {SETTINGS_GROUP_SUMMARIES[group]}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{items.length} fields</Badge>
              {groupDirtyCount > 0 ? (
                <Badge tone="orange">{groupDirtyCount} 未保存</Badge>
              ) : (
                <Badge tone="green">已同步</Badge>
              )}
            </div>
          </div>

          {items.map((item) => (
            <SettingField
              key={item.key}
              item={item}
              draft={values[item.key] ?? draftFromItem(item)}
              secretDraft={secretDrafts[item.key] ?? ""}
              revealedValue={revealed?.key === item.key ? revealed.value : null}
              revealSecondsLeft={revealed?.key === item.key ? revealSeconds : null}
              revealError={revealErrors[item.key] ?? null}
              error={errors[item.key] ?? null}
              onChange={(value) => changeValue(item.key, value)}
              onSecretChange={(value) => changeSecret(item.key, value)}
              onRequestReveal={() => requestReveal(item)}
            />
          ))}

          <footer
            aria-label="分组消费状态"
            className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-deep px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="type-eyebrow">FRONTEND CONSUMPTION</p>
              <p
                aria-label="前端消费状态"
                className={cn(
                  "mt-1 text-[11px] leading-5",
                  SETTINGS_CONSUMPTION[group].status === "frontend"
                    ? "text-accent-green"
                    : "text-accent-yellow",
                )}
              >
                {SETTINGS_CONSUMPTION[group].label}
              </p>
            </div>
            <p className="font-mono text-[9px] text-stone">
              最近写入：{formatDateTime(latest)} · 读取于 {formatDateTime(response.generatedAt)}
            </p>
          </footer>
        </section>
      </div>

      <Dialog
        open={revealTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevealTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>显示敏感值</DialogTitle>
            <DialogDescription>
              {revealTarget
                ? `即将显示 ${revealTarget.label}（${revealTarget.key}）的明文。`
                : "即将显示敏感值的明文。"}
              这是一次带审计的操作，服务端会记录本次 reveal；明文默认 10 秒后自动隐藏。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevealTarget(null)} disabled={revealing}>
              取消
            </Button>
            <Button variant="outline" onClick={() => void confirmReveal()} disabled={revealing}>
              <CheckCircle2 aria-hidden="true" />
              {revealing ? "正在显示…" : "确认显示（记入审计）"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-control border border-accent-green/30 bg-surface-1 px-4 py-3 text-[11px] text-ink shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}