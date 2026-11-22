"use client";

import {
  APPEARANCE_MODES,
  FONT_PAIRING_CATALOG,
  SKIN_CATALOG,
  type AdminSettingItem,
  type AdminSettingsResponse,
  type AppearanceMode,
  type FontPairingId,
  type SettingValue,
  type SkinId,
} from "@roamlog/contracts";
import { Check, Monitor, Moon, Palette, RotateCcw, Save, Sun, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppearancePreview, Button, Skeleton, Switch } from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/admin-types";
import { AdminSettingsError, type AdminSettingsApi } from "../../lib/admin-settings-api";
import { groupItems } from "../../lib/admin-settings";
import { loadFontPairing } from "../../lib/font-pairing-loader";
import { cn } from "../admin-shell/cn";
import { AdminPageHeader } from "../admin-ui/admin-page-header";

const DEFAULT_MODE: AppearanceMode = "system";
const DEFAULT_SKIN: SkinId = "editorial-noir";
const DEFAULT_FONT: FontPairingId = "editorial-classic";

interface AppearanceDraft {
  mode: AppearanceMode;
  skin: SkinId;
  fontPairing: FontPairingId;
  allowUserOverride: boolean;
}

interface AppearanceDefaultsProps {
  role: AdminConsoleRole;
  api: AdminSettingsApi;
  onDirtyChange?: (dirty: boolean) => void;
}

function itemFor(items: readonly AdminSettingItem[], key: string): AdminSettingItem | undefined {
  return items.find((item) => item.key === key);
}

function valueOf(items: readonly AdminSettingItem[], key: string): SettingValue | undefined {
  const item = itemFor(items, key);
  return item?.value !== undefined ? item.value : item?.default;
}

function asMode(value: SettingValue | undefined, fallback: AppearanceMode): AppearanceMode {
  return typeof value === "string" && (APPEARANCE_MODES as readonly string[]).includes(value)
    ? (value as AppearanceMode)
    : fallback;
}

function asSkin(value: SettingValue | undefined, fallback: SkinId): SkinId {
  return typeof value === "string" && SKIN_CATALOG.some((entry) => entry.id === value)
    ? (value as SkinId)
    : fallback;
}

function asFont(value: SettingValue | undefined, fallback: FontPairingId): FontPairingId {
  return typeof value === "string" && FONT_PAIRING_CATALOG.some((entry) => entry.id === value)
    ? (value as FontPairingId)
    : fallback;
}

function asBoolean(value: SettingValue | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function draftFromItems(items: readonly AdminSettingItem[]): AppearanceDraft {
  return {
    mode: asMode(valueOf(items, "theme.defaultMode"), DEFAULT_MODE),
    skin: asSkin(valueOf(items, "theme.defaultSkin"), DEFAULT_SKIN),
    fontPairing: asFont(valueOf(items, "theme.defaultFont"), DEFAULT_FONT),
    allowUserOverride: asBoolean(valueOf(items, "theme.allowUserOverride"), true),
  };
}

function changedUpdates(
  items: readonly AdminSettingItem[],
  draft: AppearanceDraft,
): { key: string; value: SettingValue }[] {
  const entries = [
    ["theme.defaultMode", draft.mode],
    ["theme.defaultSkin", draft.skin],
    ["theme.defaultFont", draft.fontPairing],
    ["theme.allowUserOverride", draft.allowUserOverride],
  ] as const;
  return entries.flatMap(([key, value]) => {
    const item = itemFor(items, key);
    if (!item || item.envLocked) {
      return [];
    }
    return valueOf(items, key) !== value ? [{ key, value }] : [];
  });
}

function failureMessage(error: unknown): string {
  if (error instanceof AdminSettingsError) {
    const code = error.failure.code;
    if (code === "ADMIN_2FA_REQUIRED") {
      return "需要完成 TOTP 2FA 验证后才能保存外观默认值。";
    }
    if (code === "SETTINGS_ENCRYPTION_UNAVAILABLE" || code === "PROVIDER_SECRETS_UNAVAILABLE") {
      return "密钥存储未就绪，外观默认值尚未写入。请先修复服务端密钥配置。";
    }
    if (error.failure.status === 403) {
      return "需要超级管理员权限才能保存外观默认值。";
    }
    return error.failure.detail?.trim() || error.failure.title || "保存失败，请稍后重试。";
  }
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

function ModeIcon({ mode }: { mode: AppearanceMode }) {
  if (mode === "light") return <Sun aria-hidden="true" className="size-4" />;
  if (mode === "dark") return <Moon aria-hidden="true" className="size-4" />;
  return <Monitor aria-hidden="true" className="size-4" />;
}

function modeLabel(mode: AppearanceMode): string {
  if (mode === "light") return "浅色";
  if (mode === "dark") return "深色";
  return "跟随系统";
}

export function AppearanceDefaults({ role, api, onDirtyChange }: AppearanceDefaultsProps) {
  const canWrite = role === "super_admin";
  const [response, setResponse] = useState<AdminSettingsResponse | null>(null);
  const [draft, setDraft] = useState<AppearanceDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.list();
      setResponse(data);
      const next = draftFromItems(groupItems(data, "theme"));
      setDraft(next);
      setFieldErrors({});
      setSaveError(null);
      void loadFontPairing(next.fontPairing);
    } catch (error) {
      setLoadError(failureMessage(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => (response ? groupItems(response, "theme") : []), [response]);
  const updates = useMemo(() => (draft ? changedUpdates(items, draft) : []), [draft, items]);
  const dirty = updates.length > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  function change(next: Partial<AppearanceDraft>): void {
    if (!canWrite) return;
    setDraft((current) => {
      if (!current) return current;
      const value = { ...current, ...next };
      if (next.fontPairing) void loadFontPairing(next.fontPairing);
      return value;
    });
    setSaveError(null);
    setNotice(null);
    if (next.mode) setFieldErrors((current) => ({ ...current, "theme.defaultMode": "" }));
    if (next.skin) setFieldErrors((current) => ({ ...current, "theme.defaultSkin": "" }));
    if (next.fontPairing) setFieldErrors((current) => ({ ...current, "theme.defaultFont": "" }));
    if (next.allowUserOverride !== undefined) {
      setFieldErrors((current) => ({ ...current, "theme.allowUserOverride": "" }));
    }
  }

  async function save(): Promise<void> {
    if (!canWrite || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      await api.update(updates);
      const fresh = await api.list();
      setResponse(fresh);
      const next = draftFromItems(groupItems(fresh, "theme"));
      setDraft(next);
      setFieldErrors({});
      setNotice("外观默认值已保存；新用户和未设置覆盖的用户会使用最新默认值。");
    } catch (error) {
      if (error instanceof AdminSettingsError) {
        setFieldErrors(error.errorsByField);
      }
      setSaveError(failureMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function discard(): void {
    if (!draft) return;
    const next = draftFromItems(items);
    setDraft(next);
    setFieldErrors({});
    setSaveError(null);
    setNotice("已放弃未保存的外观修改。");
    void loadFontPairing(next.fontPairing);
  }

  if (loading && !draft) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-72 w-full rounded-card" />
      </div>
    );
  }

  if (loadError || !draft) {
    return (
      <div className="space-y-3">
        <AdminPageHeader
          eyebrow="平台 / 系统设置 / 外观"
          title="外观与字体"
          description="平台默认外观、皮肤和本地字体。"
          readOnly={!canWrite}
        />
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red"
        >
          {loadError ?? "外观设置没有载入。"}
        </p>
        <Button type="button" variant="outline" onClick={() => void load()}>
          重新加载
        </Button>
      </div>
    );
  }

  const resolvedPreviewMode: "light" | "dark" = draft.mode === "dark" ? "dark" : "light";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="平台 / 系统设置 / 外观"
        title="外观与字体"
        description="设置 Web、公开分享页和日志编辑器的默认外观；Admin 控制台始终保持固定深色。"
        readOnly={!canWrite}
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!dirty || saving}
                onClick={discard}
              >
                <RotateCcw aria-hidden="true" />
                放弃
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                <Save aria-hidden="true" />
                {saving ? "保存中…" : "保存外观"}
              </Button>
            </div>
          ) : undefined
        }
      />

      {!canWrite ? (
        <p
          role="note"
          className="rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-xs text-accent-slate"
        >
          只有超级管理员可以修改平台默认外观；当前角色只能查看。
        </p>
      ) : null}

      {saveError ? (
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red"
        >
          {saveError}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-control border border-accent-green/25 bg-accent-green/5 px-3 py-2 text-xs text-accent-green"
        >
          {notice}
        </p>
      ) : null}

      <fieldset disabled={!canWrite || saving} className="space-y-6 min-w-0">
        <section className="rounded-card border border-hairline-strong bg-surface-1 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Monitor aria-hidden="true" className="size-4 text-accent-blue" />
            <h2 className="text-[13px] font-medium text-ink">默认外观</h2>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            跟随系统是交付默认值；显式浅色或深色会忽略操作系统偏好。
          </p>
          <div role="radiogroup" aria-label="默认外观" className="mt-4 grid gap-2 sm:grid-cols-3">
            {APPEARANCE_MODES.map((mode) => {
              const selected = draft.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!canWrite || saving}
                  onClick={() => change({ mode })}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-control border px-3 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                    selected
                      ? "border-ink bg-surface-2 text-ink"
                      : "border-hairline text-body hover:border-hairline-strong",
                  )}
                >
                  <ModeIcon mode={mode} />
                  <span className="text-[12px]">{modeLabel(mode)}</span>
                  {selected ? (
                    <Check aria-hidden="true" className="ml-auto size-4 text-accent-green" />
                  ) : null}
                </button>
              );
            })}
          </div>
          {fieldErrors["theme.defaultMode"] ? (
            <p className="mt-2 text-[11px] text-accent-red">{fieldErrors["theme.defaultMode"]}</p>
          ) : null}
        </section>

        <section className="rounded-card border border-hairline-strong bg-surface-1 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Palette aria-hidden="true" className="size-4 text-accent-orange" />
            <h2 className="text-[13px] font-medium text-ink">默认皮肤</h2>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            六套皮肤都包含完整浅色和深色语义 token；这里只设默认值，用户可在前台覆盖。
          </p>
          <div
            role="radiogroup"
            aria-label="默认皮肤"
            className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
          >
            {SKIN_CATALOG.map((skin) => {
              const selected = draft.skin === skin.id;
              return (
                <button
                  key={skin.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!canWrite || saving}
                  onClick={() => change({ skin: skin.id })}
                  className={cn(
                    "min-w-0 rounded-control border p-3 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                    selected
                      ? "border-ink bg-surface-2"
                      : "border-hairline hover:border-hairline-strong",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-ink">{skin.label}</span>
                    {selected ? (
                      <Check aria-hidden="true" className="size-3.5 text-accent-green" />
                    ) : null}
                  </span>
                  <span className="mt-2 flex h-8 overflow-hidden rounded-control border border-black/10">
                    <span
                      className="flex-1"
                      style={{ backgroundColor: skin.lightPreview.canvas }}
                    />
                    <span
                      className="flex-1"
                      style={{ backgroundColor: skin.lightPreview.accent }}
                    />
                    <span className="flex-1" style={{ backgroundColor: skin.darkPreview.canvas }} />
                    <span className="flex-1" style={{ backgroundColor: skin.darkPreview.accent }} />
                  </span>
                  <span className="mt-2 block text-[10px] leading-4 text-muted">
                    {skin.description}
                  </span>
                </button>
              );
            })}
          </div>
          {fieldErrors["theme.defaultSkin"] ? (
            <p className="mt-2 text-[11px] text-accent-red">{fieldErrors["theme.defaultSkin"]}</p>
          ) : null}
        </section>

        <section className="rounded-card border border-hairline-strong bg-surface-1 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Type aria-hidden="true" className="size-4 text-accent-yellow" />
            <h2 className="text-[13px] font-medium text-ink">默认字体</h2>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            六套配对全部从本地 Fontsource 资源加载，不请求外部字体服务。
          </p>
          <div
            role="radiogroup"
            aria-label="默认字体"
            className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
          >
            {FONT_PAIRING_CATALOG.map((font) => {
              const selected = draft.fontPairing === font.id;
              return (
                <button
                  key={font.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!canWrite || saving}
                  onClick={() => change({ fontPairing: font.id })}
                  className={cn(
                    "min-w-0 rounded-control border p-3 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                    selected
                      ? "border-ink bg-surface-2"
                      : "border-hairline hover:border-hairline-strong",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-ink">{font.label}</span>
                    {selected ? (
                      <Check aria-hidden="true" className="size-3.5 text-accent-green" />
                    ) : null}
                  </span>
                  <span
                    className="mt-2 block truncate text-[20px] leading-7 text-ink"
                    style={{ fontFamily: font.displayStack }}
                  >
                    Aa 京都 · Journey
                  </span>
                  <span
                    className="mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted"
                    style={{ fontFamily: font.monoStack }}
                  >
                    12 photos / 4 stops
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-muted">
                    {font.description}
                  </span>
                </button>
              );
            })}
          </div>
          {fieldErrors["theme.defaultFont"] ? (
            <p className="mt-2 text-[11px] text-accent-red">{fieldErrors["theme.defaultFont"]}</p>
          ) : null}
        </section>

        <section className="rounded-card border border-hairline-strong bg-surface-1 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[13px] font-medium text-ink">允许用户覆盖</h2>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                关闭后，已登录用户只能使用平台默认皮肤、模式和字体；已有的个人选择会保留但暂不生效。
              </p>
            </div>
            <Switch
              aria-label="允许用户覆盖外观"
              checked={draft.allowUserOverride}
              disabled={!canWrite || saving}
              onCheckedChange={(checked) => change({ allowUserOverride: checked })}
            />
          </div>
          {fieldErrors["theme.allowUserOverride"] ? (
            <p className="mt-2 text-[11px] text-accent-red">
              {fieldErrors["theme.allowUserOverride"]}
            </p>
          ) : null}
        </section>

        <section className="rounded-card border border-hairline-strong bg-surface-1 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Palette aria-hidden="true" className="size-4 text-accent-blue" />
            <h2 className="text-[13px] font-medium text-ink">实时预览</h2>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            预览使用 Web 端的共享组件，不改变 Admin 控制台自身的固定深色外观。
          </p>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <AppearancePreview
              mode={draft.mode}
              skin={draft.skin}
              fontPairing={draft.fontPairing}
              surface="web"
            />
            <div className="space-y-3">
              <AppearancePreview
                mode={draft.mode === "system" ? "light" : draft.mode}
                skin={draft.skin}
                fontPairing={draft.fontPairing}
                surface="journal"
              />
              <AppearancePreview
                mode={draft.mode === "system" ? "dark" : draft.mode}
                skin={draft.skin}
                fontPairing={draft.fontPairing}
                surface="share"
              />
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <AppearancePreview
              mode={resolvedPreviewMode}
              skin={draft.skin}
              fontPairing={draft.fontPairing}
              surface="error"
            />
            <AppearancePreview
              mode={resolvedPreviewMode}
              skin={draft.skin}
              fontPairing={draft.fontPairing}
              surface="empty"
            />
          </div>
        </section>
      </fieldset>

      {dirty ? (
        <p role="status" className="text-[11px] text-accent-yellow">
          外观默认值有未保存修改；切换页面会先确认。
        </p>
      ) : null}
    </div>
  );
}
