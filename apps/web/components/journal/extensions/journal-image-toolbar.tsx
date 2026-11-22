"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@roamlog/ui";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Eye,
  Minus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import type { JournalImageAttributes } from "./journal-image";
import { JournalImageSettings, type JournalImageSettingsValues } from "./journal-image-settings";

type ImageAlignment = "left" | "center" | "right" | null;

interface JournalImageToolbarProps {
  alignment: ImageAlignment;
  attributes: JournalImageAttributes;
  onAlign: (alignment: ImageAlignment) => void;
  onApplySettings: (values: JournalImageSettingsValues) => void;
  onPreview: (trigger: HTMLButtonElement) => void;
  onRestoreSelection: () => void;
  replacing: boolean;
  onReplace: () => void;
  onDelete: () => void;
}

interface ToolbarButtonProps {
  label: string;
  onPress: (trigger: HTMLButtonElement) => void;
  pressed?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}

const TOOLBAR_BUTTON_CLASS =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-[5px] border border-hairline-strong bg-surface-1 text-muted transition-colors outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

function ToolbarButton({
  label,
  onPress,
  pressed,
  disabled = false,
  destructive = false,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      title={label}
      onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
      }}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onPress(event.currentTarget);
      }}
      className={`${TOOLBAR_BUTTON_CLASS} ${
        pressed ? "bg-surface-2 text-ink" : ""
      } ${destructive ? "hover:border-accent-red/50 hover:text-accent-red" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * Ported from emdash-cms/emdash@732867e9836efbd9fa9cf01f4fd086949b1bb392
 * (MIT): ImageNode.tsx:180-195 and ImageDetailPanel.tsx:274-284, 723-740,
 * 815-824 for the alignment and delete interactions; ImageDetailPanel.tsx:
 * 95-315 for the image-settings form.
 *
 * Adaptation layer: Roamlog's `null` alignment is the default, non-floating
 * layout; the center action writes the independent `"center"` value. Labels
 * and design tokens are localized for Roamlog, and the toolbar is inline in
 * the NodeView.
 */
export function JournalImageToolbar({
  alignment,
  attributes,
  onAlign,
  onApplySettings,
  onPreview,
  onRestoreSelection,
  replacing,
  onReplace,
  onDelete,
}: JournalImageToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsWasOpenRef = useRef(false);

  /**
   * Radix closes the portal first; the Tiptap NodeView can remount the toolbar
   * on the next frame. Resolve the live trigger from the document after both
   * frames instead of focusing a ref that may already be detached.
   *
   * This mirrors the Gallery NodeView's delayed focus restoration
   * (`journal-gallery-node-view.tsx`) and intentionally does not cancel the
   * frame on unmount: the trigger we need may belong to the replacement mount.
   */
  function restoreSettingsFocus(): void {
    onRestoreSelection();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const liveTrigger =
          settingsTriggerRef.current?.isConnected === true
            ? settingsTriggerRef.current
            : document.querySelector<HTMLButtonElement>(
                'button[data-journal-image-settings-trigger="true"]',
              );
        liveTrigger?.focus();
      });
    });
  }

  useEffect(() => {
    const wasOpen = settingsWasOpenRef.current;
    settingsWasOpenRef.current = settingsOpen;
    if (!wasOpen || settingsOpen) return;

    restoreSettingsFocus();
  }, [settingsOpen]);

  function handleSettingsOpenChange(open: boolean): void {
    setSettingsOpen(open);
  }

  return (
    <div
      role="toolbar"
      aria-label="图片工具"
      className="absolute right-2 top-2 z-10 flex max-w-[calc(100%_-_1rem)] flex-wrap items-center justify-end gap-1 rounded-control border border-hairline-strong bg-surface-1/95 p-1 shadow-lg backdrop-blur"
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
      }}
    >
      <ToolbarButton label="左浮动" pressed={alignment === "left"} onPress={() => onAlign("left")}>
        <AlignLeft aria-hidden="true" className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="居中"
        pressed={alignment === "center"}
        onPress={() => onAlign("center")}
      >
        <AlignCenter aria-hidden="true" className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        label="右浮动"
        pressed={alignment === "right"}
        onPress={() => onAlign("right")}
      >
        <AlignRight aria-hidden="true" className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton label="默认对齐" pressed={alignment === null} onPress={() => onAlign(null)}>
        <Minus aria-hidden="true" className="size-3.5" />
      </ToolbarButton>
      <Popover open={settingsOpen} onOpenChange={handleSettingsOpenChange}>
        <PopoverTrigger asChild>
          <button
            ref={settingsTriggerRef}
            type="button"
            aria-label="图片设置"
            title="图片设置"
            data-journal-image-settings-trigger="true"
            className={TOOLBAR_BUTTON_CLASS}
            onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
            }}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
            }}
          >
            <SlidersHorizontal aria-hidden="true" className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          aria-label="图片设置"
          className="max-h-[calc(100dvh_-_32px)] w-[22rem] max-w-[calc(100vw_-_24px)] overflow-y-auto p-3"
          onEscapeKeyDown={(event) => {
            event.stopPropagation();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreSettingsFocus();
          }}
        >
          <JournalImageSettings
            attributes={attributes}
            onApply={onApplySettings}
            onClose={() => setSettingsOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <ToolbarButton
        label={replacing ? "正在替换图片" : "替换图片"}
        disabled={replacing}
        onPress={onReplace}
      >
        <RefreshCw aria-hidden="true" className={`size-3.5 ${replacing ? "animate-spin" : ""}`} />
      </ToolbarButton>
      <ToolbarButton label="预览图片" onPress={onPreview}>
        <Eye aria-hidden="true" className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton label="删除图片" destructive onPress={onDelete}>
        <Trash2 aria-hidden="true" className="size-3.5" />
      </ToolbarButton>
    </div>
  );
}
