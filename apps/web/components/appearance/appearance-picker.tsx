"use client";

import {
  APPEARANCE_MODES,
  FONT_PAIRING_CATALOG,
  SKIN_CATALOG,
  type AppearanceMode,
  type ResolvedAppearance,
} from "@roamlog/contracts";
import { Badge, Button, PageHeader, Skeleton } from "@roamlog/ui";
import { Check, Monitor, Moon, Palette, RotateCcw, Save, Sun } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";

import { isApiError } from "@/lib/api";
import {
  applyAppearanceToDocument,
  appearanceModeLabel,
  clearAppearanceCookie,
  writeAppearancePreviewCookie,
  type AppearanceDraft,
} from "@/lib/api/appearance";
import { loadFontPairing } from "@/lib/font-pairing-loader";
import {
  useAppearanceQuery,
  useResetAppearanceMutation,
  useUpdateAppearanceMutation,
} from "@/lib/query";

import { AppearancePreview } from "./appearance-preview";

export interface AppearancePickerFormProps {
  data: ResolvedAppearance;
  value: AppearanceDraft;
  dirty: boolean;
  busy?: boolean;
  notice?: string | null;
  error?: string | null;
  onChange: (next: AppearanceDraft) => void;
  onDiscard: () => void;
  onSave: () => void;
  onReset: () => void;
}

const MODE_ICONS = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;

function handleRadioKeyDown<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void,
): void {
  const key = event.key;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) {
    return;
  }
  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(current));
  const nextIndex =
    key === "Home"
      ? 0
      : key === "End"
        ? values.length - 1
        : key === "ArrowLeft" || key === "ArrowUp"
          ? (currentIndex - 1 + values.length) % values.length
          : (currentIndex + 1) % values.length;
  const next = values[nextIndex];
  if (!next) return;
  select(next);
  const buttons = Array.from(
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
  );
  buttons[nextIndex]?.focus();
}

function fieldsetClass(disabled: boolean): string {
  return disabled ? "opacity-60" : "";
}

export function AppearancePickerForm({
  data,
  value,
  dirty,
  busy = false,
  notice,
  error,
  onChange,
  onDiscard,
  onSave,
  onReset,
}: AppearancePickerFormProps) {
  const canEdit = data.canOverride && !busy;

  function selectMode(mode: AppearanceMode) {
    if (!canEdit) return;
    onChange({ ...value, mode });
  }

  function selectSkin(skin: AppearanceDraft["skin"]) {
    if (!canEdit) return;
    onChange({ ...value, skin });
  }

  function selectFont(fontPairing: AppearanceDraft["fontPairing"]) {
    if (!canEdit) return;
    void loadFontPairing(fontPairing);
    onChange({ ...value, fontPairing });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ACCOUNT / APPEARANCE"
        title="外观"
        description="选择适合你的阅读节奏。外观偏好会跟随账号同步，也可以在任意设备恢复平台默认。"
        actions={
          <Badge tone={data.canOverride ? "blue" : "neutral"}>
            {data.canOverride ? "可自定义" : "平台已锁定"}
          </Badge>
        }
      />

      {notice ? (
        <p
          role="status"
          className="rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs text-accent-green"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red"
        >
          {error}
        </p>
      ) : null}
      {!data.canOverride ? (
        <p
          role="note"
          className="rounded-control border border-hairline-strong bg-surface-1 px-3 py-2 text-xs text-muted"
        >
          管理员已关闭个人外观覆盖。当前页面展示的是平台默认值。
        </p>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && canEdit) onSave();
          }}
        >
          <fieldset disabled={!canEdit} className={`surface-card p-5 ${fieldsetClass(!canEdit)}`}>
            <legend className="sr-only">显示模式</legend>
            <div className="flex items-center gap-2">
              <Palette aria-hidden="true" className="size-4 text-muted" />
              <p className="type-eyebrow">显示模式</p>
            </div>
            <div role="radiogroup" aria-label="显示模式" className="mt-3 grid grid-cols-3 gap-2">
              {APPEARANCE_MODES.map((mode) => {
                const Icon = MODE_ICONS[mode];
                const selected = value.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-control border px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                      selected
                        ? "border-hairline-strong bg-surface-2 text-ink"
                        : "border-hairline text-muted hover:border-hairline-strong hover:text-body"
                    }`}
                    onClick={() => selectMode(mode)}
                    onKeyDown={(event) =>
                      handleRadioKeyDown(event, APPEARANCE_MODES, value.mode, selectMode)
                    }
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    <span>{appearanceModeLabel(mode)}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset disabled={!canEdit} className={`surface-card p-5 ${fieldsetClass(!canEdit)}`}>
            <legend className="sr-only">皮肤</legend>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="type-eyebrow">皮肤</p>
                <p className="mt-1 text-xs text-muted">颜色、表面与氛围的整体组合。</p>
              </div>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                6 SKINS
              </span>
            </div>
            <div role="radiogroup" aria-label="皮肤" className="mt-4 grid gap-2 sm:grid-cols-2">
              {SKIN_CATALOG.map((skin) => {
                const selected = value.skin === skin.id;
                return (
                  <button
                    key={skin.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${skin.label}：${skin.description}`}
                    className={`relative rounded-control border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                      selected
                        ? "border-hairline-strong bg-surface-2"
                        : "border-hairline hover:border-hairline-strong hover:bg-surface-1"
                    }`}
                    onClick={() => selectSkin(skin.id)}
                    onKeyDown={(event) =>
                      handleRadioKeyDown(
                        event,
                        SKIN_CATALOG.map((entry) => entry.id),
                        value.skin,
                        selectSkin,
                      )
                    }
                  >
                    <div className="flex gap-1.5">
                      <span
                        className="h-8 flex-1 rounded-sm border border-black/15"
                        style={{ backgroundColor: skin.lightPreview.canvas }}
                      >
                        <span
                          className="m-1.5 block size-2 rounded-full"
                          style={{ backgroundColor: skin.lightPreview.accent }}
                        />
                      </span>
                      <span
                        className="h-8 flex-1 rounded-sm border border-white/10"
                        style={{ backgroundColor: skin.darkPreview.canvas }}
                      >
                        <span
                          className="m-1.5 block size-2 rounded-full"
                          style={{ backgroundColor: skin.darkPreview.accent }}
                        />
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink">{skin.label}</span>
                      {selected ? (
                        <Check aria-hidden="true" className="size-3.5 text-accent-green" />
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted">
                      {skin.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset disabled={!canEdit} className={`surface-card p-5 ${fieldsetClass(!canEdit)}`}>
            <legend className="sr-only">字体配对</legend>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="type-eyebrow">字体配对</p>
                <p className="mt-1 text-xs text-muted">标题、正文和元数据的本地字体组合。</p>
              </div>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                6 PAIRINGS
              </span>
            </div>
            <div role="radiogroup" aria-label="字体配对" className="mt-4 grid gap-2 sm:grid-cols-2">
              {FONT_PAIRING_CATALOG.map((font) => {
                const selected = value.fontPairing === font.id;
                return (
                  <button
                    key={font.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${font.label}：${font.description}`}
                    className={`rounded-control border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                      selected
                        ? "border-hairline-strong bg-surface-2"
                        : "border-hairline hover:border-hairline-strong hover:bg-surface-1"
                    }`}
                    onClick={() => selectFont(font.id)}
                    onKeyDown={(event) =>
                      handleRadioKeyDown(
                        event,
                        FONT_PAIRING_CATALOG.map((entry) => entry.id),
                        value.fontPairing,
                        selectFont,
                      )
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink">{font.label}</span>
                      {selected ? (
                        <Check aria-hidden="true" className="size-3.5 text-accent-green" />
                      ) : null}
                    </div>
                    <p
                      className="mt-2 truncate text-lg leading-6 text-ink"
                      style={{ fontFamily: font.displayStack }}
                    >
                      在雨停之前去看海
                    </p>
                    <p
                      className="mt-1 truncate text-[10px] text-muted"
                      style={{ fontFamily: font.bodyStack }}
                    >
                      Travel notes, 2026 · 12 张照片
                    </p>
                    <p
                      className="mt-1 truncate text-[9px] uppercase tracking-[0.08em] text-stone"
                      style={{ fontFamily: font.monoStack }}
                    >
                      LAT 34.42 / LNG 132.45
                    </p>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-card border border-hairline-strong bg-canvas/95 p-3 backdrop-blur">
            <span className="mr-auto text-[11px] text-muted">
              {dirty
                ? "有未保存的外观修改"
                : `当前来源：${data.source === "user" ? "你的选择" : "平台默认"}`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDiscard}
              disabled={!dirty || busy}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReset}
              disabled={!canEdit || data.source !== "user"}
            >
              <RotateCcw aria-hidden="true" />
              恢复平台默认
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!dirty || !canEdit}>
              <Save aria-hidden="true" />
              {busy ? "保存中…" : "保存外观"}
            </Button>
          </div>
        </form>

        <aside className="min-w-0 xl:sticky xl:top-6" aria-label="外观预览">
          <div className="rounded-card border border-hairline-strong bg-surface-1 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="type-eyebrow">实时预览</p>
              <span className="font-mono text-[9px] text-stone">{value.skin}</span>
            </div>
            <AppearancePreview
              mode={value.mode}
              skin={value.skin}
              fontPairing={value.fontPairing}
              surface="journal"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function appearanceErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === "APPEARANCE_OVERRIDE_DISABLED") {
    return "管理员已关闭个人外观覆盖，当前修改不会保存。";
  }
  if (isApiError(error) && error.status === 401) {
    return "登录状态已过期，请重新登录后再保存外观。";
  }
  return error instanceof Error ? error.message : "外观保存失败，请稍后重试。";
}

function draftOf(appearance: ResolvedAppearance): AppearanceDraft {
  return {
    mode: appearance.mode,
    skin: appearance.skin,
    fontPairing: appearance.fontPairing,
  };
}

export function AppearancePicker() {
  const query = useAppearanceQuery();
  const update = useUpdateAppearanceMutation();
  const reset = useResetAppearanceMutation();
  const [draft, setDraft] = useState<AppearanceDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const next = draftOf(query.data);
    setDraft(next);
    applyAppearanceToDocument(next);
    void loadFontPairing(next.fontPairing);
  }, [query.data]);

  if (query.isLoading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-56" />
        <Skeleton className="h-80 rounded-card" />
      </div>
    );
  }

  if (query.error || !query.data || !draft) {
    return (
      <div className="space-y-3">
        <PageHeader eyebrow="ACCOUNT / APPEARANCE" title="外观" />
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red"
        >
          {query.error ? appearanceErrorMessage(query.error) : "外观设置没有载入。"}
        </p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          重新加载
        </Button>
      </div>
    );
  }

  const data = query.data;
  const dirty =
    draft.mode !== data.mode || draft.skin !== data.skin || draft.fontPairing !== data.fontPairing;

  function preview(next: AppearanceDraft) {
    setDraft(next);
    setNotice(null);
    setError(null);
    applyAppearanceToDocument(next);
    writeAppearancePreviewCookie(next);
  }

  async function save() {
    if (!draft || !dirty || !data.canOverride) return;
    setError(null);
    try {
      const saved = await update.mutateAsync(draft);
      const next = draftOf(saved);
      setDraft(next);
      applyAppearanceToDocument(next);
      setNotice("外观设置已保存，并在当前设备生效。");
    } catch (cause) {
      setError(appearanceErrorMessage(cause));
    }
  }

  async function resetAppearance() {
    setError(null);
    try {
      const resetData = await reset.mutateAsync();
      const next = draftOf(resetData);
      setDraft(next);
      applyAppearanceToDocument(next);
      setNotice("已恢复平台默认外观。");
    } catch (cause) {
      setError(appearanceErrorMessage(cause));
    }
  }

  function discard() {
    const next = draftOf(data);
    setDraft(next);
    applyAppearanceToDocument(next);
    if (data.source === "user") {
      writeAppearancePreviewCookie(next);
    } else {
      clearAppearanceCookie();
    }
    setNotice(null);
    setError(null);
  }

  return (
    <AppearancePickerForm
      data={data}
      value={draft}
      dirty={dirty}
      busy={update.isPending || reset.isPending}
      notice={notice}
      error={error}
      onChange={preview}
      onDiscard={discard}
      onSave={() => void save()}
      onReset={() => void resetAppearance()}
    />
  );
}
