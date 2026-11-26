"use client";

import {
  ACTIVE_SKIN_CATALOG,
  APPEARANCE_MODES,
  type AppearanceMode,
  type SkinId,
} from "@roamlog/contracts";
import { ArrowUpRight, Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "../lib/cn";
import { IconButton } from "../primitives/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "../primitives/popover";
import type { ShellLinkComponent } from "./sidebar";

const MODE_ICONS: Record<AppearanceMode, ReactNode> = {
  system: <Monitor aria-hidden="true" className="size-3.5" />,
  light: <Sun aria-hidden="true" className="size-3.5" />,
  dark: <Moon aria-hidden="true" className="size-3.5" />,
};

const MODE_LABELS: Record<AppearanceMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

export interface QuickAppearanceMenuProps {
  mode: AppearanceMode;
  skin: SkinId;
  onModeChange: (mode: AppearanceMode) => void;
  onSkinChange: (skin: SkinId) => void;
  moreHref: string;
  linkComponent?: ShellLinkComponent;
  disabled?: boolean;
  saving?: boolean;
  error?: string | null;
  triggerLabel?: string;
  onOpenChange?: (open: boolean) => void;
}

function handleRadioKeyDown<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void,
): void {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(current));
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? values.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
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

/**
 * Compact appearance switcher for authenticated shells.
 *
 * This component owns presentation only. Web and Admin each provide their own
 * persistence adapter so the control can never create a second appearance
 * state machine; the catalog comes from contracts and grows with new skins.
 */
export function QuickAppearanceMenu({
  mode,
  skin,
  onModeChange,
  onSkinChange,
  moreHref,
  linkComponent: Link = "a" as ShellLinkComponent,
  disabled = false,
  saving = false,
  error,
  triggerLabel = "主题与深浅色",
  onOpenChange,
}: QuickAppearanceMenuProps) {
  const currentSkin = ACTIVE_SKIN_CATALOG.find((entry) => entry.id === skin);

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={triggerLabel}
          title={triggerLabel}
          disabled={disabled}
          data-testid="quick-appearance-trigger"
        >
          <Palette aria-hidden="true" className="size-4" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(23rem,calc(100vw-1rem))] overflow-hidden rounded-card p-0"
        data-testid="quick-appearance-menu"
      >
        <div className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink">外观</p>
              <p className="mt-0.5 text-[11px] text-muted">
                {MODE_LABELS[mode]} · {currentSkin?.label ?? skin}
              </p>
            </div>
            <span className="min-h-4 text-[10px] text-muted" aria-live="polite">
              {saving ? "保存中…" : ""}
            </span>
          </div>

          <div
            role="radiogroup"
            aria-label="显示模式"
            className="mt-3 grid grid-cols-3 gap-1 rounded-control border border-hairline bg-surface-1/70 p-1"
          >
            {APPEARANCE_MODES.map((option) => {
              const selected = mode === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  className={cn(
                    "flex min-h-8 items-center justify-center gap-1 rounded-[6px] px-1.5 text-[10px] transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-focus-ring",
                    selected
                      ? "bg-surface-overlay text-ink shadow-sm"
                      : "text-muted hover:text-body",
                  )}
                  onClick={() => onModeChange(option)}
                  onKeyDown={(event) =>
                    handleRadioKeyDown(event, APPEARANCE_MODES, mode, onModeChange)
                  }
                >
                  {MODE_ICONS[option]}
                  <span>{MODE_LABELS[option]}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-end justify-between gap-2">
            <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              主题
            </p>
            <span className="text-[10px] text-stone">{ACTIVE_SKIN_CATALOG.length} 套</span>
          </div>

          <div
            role="radiogroup"
            aria-label="主题"
            className="mt-2 grid max-h-64 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-2"
          >
            {ACTIVE_SKIN_CATALOG.map((entry) => {
              const selected = entry.id === skin;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${entry.label}：${entry.description}`}
                  disabled={disabled}
                  className={cn(
                    "min-w-0 rounded-control border p-2 text-left transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-focus-ring",
                    selected
                      ? "border-accent-solid bg-surface-2"
                      : "border-hairline hover:border-hairline-strong hover:bg-surface-1",
                  )}
                  onClick={() => onSkinChange(entry.id)}
                  onKeyDown={(event) =>
                    handleRadioKeyDown(
                      event,
                      ACTIVE_SKIN_CATALOG.map((candidate) => candidate.id),
                      skin,
                      onSkinChange,
                    )
                  }
                >
                  <div className="flex h-8 gap-1">
                    <span
                      className="relative flex-1 overflow-hidden rounded-[4px] border border-black/10"
                      style={{ backgroundColor: entry.lightPreview.canvas }}
                    >
                      <span
                        className="absolute left-1.5 top-1.5 size-1.5 rounded-full"
                        style={{ backgroundColor: entry.lightPreview.accent }}
                      />
                    </span>
                    <span
                      className="relative flex-1 overflow-hidden rounded-[4px] border border-white/10"
                      style={{ backgroundColor: entry.darkPreview.canvas }}
                    >
                      <span
                        className="absolute left-1.5 top-1.5 size-1.5 rounded-full"
                        style={{ backgroundColor: entry.darkPreview.accent }}
                      />
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-medium text-ink">{entry.label}</span>
                    {selected ? (
                      <Check aria-hidden="true" className="size-3.5 shrink-0 text-accent-green" />
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[9px] leading-3.5 text-muted">
                    {entry.description}
                  </p>
                </button>
              );
            })}
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-control border border-accent-red/25 bg-accent-red/5 px-2 py-1.5 text-[10px] leading-4 text-accent-red"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-3 border-t border-hairline pt-2">
            <Link
              href={moreHref}
              className="flex items-center justify-between gap-2 rounded-[6px] px-1 py-1 text-[10px] text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              更多外观设置
              <ArrowUpRight aria-hidden="true" className="size-3" />
            </Link>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
