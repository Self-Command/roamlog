"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, Save, ShieldAlert, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
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
  type SettingDraftValue,
} from "../../lib/admin-settings";
import { settingsGroupConsumption } from "./settings-consumption";
import { formatDateTime } from "../../lib/format";
import { cn } from "../admin-shell/cn";
import { ProbeErrorBlock } from "./probe-error-block";
import {
  isSettingsProbeFailure,
  probeCopyFor,
  probeFallbackCopy,
  settingsProbeFromError,
  type ProbeCopy,
  type SettingsProbe,
} from "./probe-error-copy";
import { SettingField } from "./setting-field";

export interface SettingsGroupFormProps {
  /** The one group this form owns. Never changes for the lifetime of a page. */
  group: SystemSettingGroup;
  role: AdminConsoleRole;
  api: AdminSettingsApi;
  /** System settings shows one permission note for the whole page instead. */
  showReadOnlyNote?: boolean;
  /** Lets the parent shell guard navigation while this panel has pending edits. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface ConsoleBanner {
  tone: "error" | "warning";
  title: string;
  detail?: string;
  action?: "save" | "reload";
  /** Set when a save was blocked by the live storage/mail probe. */
  probe?: { probe: SettingsProbe; copy: ProbeCopy };
}

/** Current text draft for a key, falling back to the last server value. */
function settingText(
  response: AdminSettingsResponse | null,
  values: Record<string, SettingDraftValue>,
  key: string,
): string | null {
  const draft = values[key];
  if (typeof draft === "string" && draft.trim().length > 0) {
    return draft.trim();
  }
  if (!response) {
    return null;
  }
  for (const group of response.groups) {
    for (const item of group.items) {
      if (item.key !== key) {
        continue;
      }
      const value = item.value;
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    }
  }
  return null;
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
    title: "后台服务暂时不可用",
    detail: error instanceof Error ? error.message : "后台接口请求未能完成。",
    degraded: [],
  };
}

function permissionText(failure: AdminApiFailure): string | null {
  if (failure.code === "ADMIN_2FA_REQUIRED") {
    return "请先完成两步验证，再访问后台设置。";
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
    return "请先完成两步验证，再显示密钥。";
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
  return "显示失败，请稍后重试；如果持续失败，请联系平台管理员。";
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

function groupOf(
  response: AdminSettingsResponse,
  group: SystemSettingGroup,
): AdminSettingsGroup | null {
  return response.groups.find((entry) => entry.group === group) ?? null;
}

/**
 * The single-group settings form.
 *
 * Both the system settings page (four stacked instances) and every service
 * page (one instance) mount this component, so loading, draft tracking, save
 * probes, error banners, secret masking and reveal all live in exactly one
 * place. There is deliberately no group picker inside: navigation lives in the
 * admin sidebar.
 */
export function SettingsGroupForm({
  group,
  role,
  api,
  showReadOnlyNote = true,
  onDirtyChange,
}: SettingsGroupFormProps) {
  const [response, setResponse] = useState<AdminSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<AdminApiFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [values, setValues] = useState<Record<string, SettingDraftValue>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<ConsoleBanner | null>(null);
  const [probeNotes, setProbeNotes] = useState<Record<string, string>>({});
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
      setProbeNotes({});
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

  const items = useMemo(() => (response ? groupItems(response, group) : []), [response, group]);

  const dirtyKeys = useMemo(
    () => dirtySettingKeys(items, values, secretDrafts),
    [items, values, secretDrafts],
  );

  useEffect(() => {
    onDirtyChange?.(dirtyKeys.length > 0);
  }, [dirtyKeys.length, onDirtyChange]);

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

  const errors = useMemo(() => ({ ...localErrors, ...serverErrors }), [localErrors, serverErrors]);

  const canSave =
    canWrite && dirtyKeys.length > 0 && Object.keys(localErrors).length === 0 && !saving;

  const activeGroup = response ? groupOf(response, group) : null;
  const latest = latestUpdatedAt(items);

  function changeValue(key: string, value: SettingDraftValue) {
    setValues((current) => ({ ...current, [key]: value }));
    clearProbeNote(key);
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
    clearProbeNote(key);
    setServerErrors((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  /** A credential note disappears once the operator starts filling that field. */
  function clearProbeNote(key: string) {
    setProbeNotes((current) => {
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
    setProbeNotes({});
    setRevealed(null);
    setToast("已放弃当前分组的未保存修改。");
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
    setProbeNotes({});
    setServerErrors({});

    let updatedCount: number;
    try {
      const result = await api.update(collected.updates);
      updatedCount = result.updated.length;
    } catch (error) {
      const failure = failureOf(error);
      const probe = settingsProbeFromError(error);
      if (probe) {
        // The save was blocked by a live probe: explain the exact step instead
        // of "configuration rejected". Nothing was written and the drafts stay.
        const copy = probeCopyFor(probe, {
          endpoint: settingText(response, values, "storage.endpoint"),
          provider: settingText(response, values, "mail.provider"),
          detail: failure.detail,
        });
        setServerErrors({});
        setProbeNotes({ ...copy.credentialNotes });
        setBanner({
          tone: "error",
          title: copy.headline,
          detail: failure.detail,
          probe: { probe, copy },
        });
      } else if (isSettingsProbeFailure(failure)) {
        const copy = probeFallbackCopy(failure.detail);
        setProbeNotes({});
        setBanner({ tone: "error", title: copy.headline, detail: copy.body });
      } else if (error instanceof AdminSettingsError && error.status === 422) {
        setServerErrors(error.errorsByField);
        setProbeNotes({});
        setBanner({
          tone: "error",
          title: "有字段没有通过校验",
          detail: "已保留你填写的内容；修正标记的字段后再次保存。",
          action: "save",
        });
      } else {
        const permission = permissionText(failure);
        setProbeNotes({});
        setBanner({
          tone: "error",
          title: permission ?? "保存失败，可重试",
          detail: permission
            ? "请确认账号权限或完成两步验证后重试。"
            : "未写入任何设置，输入已保留，请稍后重试。",
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
    } catch {
      setToast(`已提交 ${updatedCount} 项设置，但重新读取失败。`);
      setBanner({
        tone: "warning",
        title: "保存已提交，但重新读取失败",
        detail: "服务可能已经写入；请重新读取确认。",
        action: "reload",
      });
      setSaving(false);
      return;
    }

    setResponse((current) => (current ? replaceGroup(current, fresh, group) : fresh));
    applyDrafts(groupItems(fresh, group), true);
    setRevealed(null);
    setBanner(null);
    setProbeNotes({});
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
    setProbeNotes({});
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
        detail: "没有读取到最新设置，请稍后重试。",
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
      <section
        aria-label={`${groupLabel(group)} 设置`}
        aria-busy="true"
        className="rounded-card border border-hairline-strong bg-surface-1 px-4 py-3"
      >
        <p className="type-eyebrow">设置 / 加载中</p>
        <p className="mt-1 text-[12px] text-muted">正在从后台接口读取设置。</p>
        <div className="mt-3 h-24 animate-pulse rounded-control border border-hairline bg-surface-deep/60" />
      </section>
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
              {permission ? "设置 / 无权访问" : "设置 / 加载失败"}
            </p>
            <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">
              {permission ?? "设置加载失败"}
            </h2>
            <p className="mt-2 text-[12px] leading-6 text-muted">
              {permission
                ? "后台设置只对超级管理员开放；如果已具备权限，请确认两步验证已完成。"
                : "无法读取设置。请稍后重试。"}
            </p>
            <details className="mt-3 font-mono text-[9px] text-stone">
              <summary className="cursor-pointer select-none">技术详情</summary>
              <p className="mt-1 break-all">
                {loadError.code} · HTTP {loadError.status || "网络"} · {loadError.detail}
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
        title="没有可显示的设置"
        description="暂时没有读取到这一组设置。请重试；如果一直为空，请联系平台管理员。"
        action={
          <Button variant="outline" onClick={() => void refresh()}>
            重新读取
          </Button>
        }
      />
    );
  }

  const groupDirtyCount = dirtyKeys.length;
  const consumption = settingsGroupConsumption(group);
  const consumptionTone =
    consumption.status === "frontend"
      ? "green"
      : consumption.status === "backend"
        ? "blue"
        : "yellow";
  const consumptionStatusLabel =
    consumption.status === "frontend"
      ? "已由用户端使用"
      : consumption.status === "backend"
        ? "已由服务使用"
        : "未接入";

  return (
    <section
      aria-label={`${groupLabel(group)} 设置`}
      data-settings-group={group}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-3">
        <div className="min-w-0">
          <p className="type-eyebrow">设置分组 / {groupLabel(group)}</p>
          <h2 className="mt-1 font-serif text-xl tracking-[-0.02em] text-ink">
            {groupLabel(group)}
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-muted">{SETTINGS_GROUP_SUMMARIES[group]}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone="neutral">{items.length} 项</Badge>
          {groupDirtyCount > 0 ? (
            <Badge tone="orange">{groupDirtyCount} 项未保存</Badge>
          ) : (
            <Badge tone="green">已同步</Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={`重新读取（${groupLabel(group)}）`}
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
            aria-label={`保存更改（${groupLabel(group)}）`}
            disabled={!canSave}
            onClick={() => void save()}
          >
            <Save aria-hidden="true" />
            {saving ? "保存中…" : "保存更改"}
          </Button>
        </div>
      </div>

      {!canWrite && showReadOnlyNote ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          只有超级管理员可以修改后台设置；当前账号只能查看。
        </div>
      ) : null}

      {banner?.probe ? (
        <ProbeErrorBlock
          probe={banner.probe.probe}
          copy={banner.probe.copy}
          serverDetail={banner.detail}
          retrying={saving}
          onRetry={() => void save()}
        />
      ) : banner ? (
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
          note={probeNotes[item.key] ?? null}
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
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-eyebrow">生效范围</p>
            <Badge tone={consumptionTone}>{consumptionStatusLabel}</Badge>
          </div>
          <p
            data-consumption-status={consumption.status}
            className={cn(
              "mt-1 text-[11px] leading-5",
              consumption.status === "frontend"
                ? "text-accent-green"
                : consumption.status === "backend"
                  ? "text-accent-blue"
                  : "text-accent-yellow",
            )}
          >
            {consumption.label}
          </p>
        </div>
        <p className="font-mono text-[9px] text-stone">
          最近写入：{formatDateTime(latest)} · 读取于 {formatDateTime(response.generatedAt)}
        </p>
      </footer>

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
              本次查看会记录到审计日志；密钥默认 10 秒后自动隐藏。
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
    </section>
  );
}
