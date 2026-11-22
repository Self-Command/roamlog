"use client";

import { useRef, type KeyboardEvent } from "react";

import type { SystemSettingGroup } from "@roamlog/contracts";

import { cn } from "../admin-shell/cn";

export type SettingsTabGroup = Extract<SystemSettingGroup, "general" | "seo" | "theme" | "limits">;

export interface SettingsTab {
  group: SettingsTabGroup;
  label: string;
}

interface SettingsTabsProps {
  tabs: readonly SettingsTab[];
  activeGroup: SettingsTabGroup;
  dirtyGroups: Readonly<Partial<Record<SettingsTabGroup, boolean>>>;
  onChange: (group: SettingsTabGroup) => void;
}

export function settingsTabId(group: SystemSettingGroup): string {
  return `settings-tab-${group}`;
}

export function settingsPanelId(group: SystemSettingGroup): string {
  return `settings-panel-${group}`;
}

export function SettingsTabs({ tabs, activeGroup, dirtyGroups, onChange }: SettingsTabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(next: number): void {
    const tab = tabs[next];
    if (!tab) {
      return;
    }
    onChange(tab.group);
    refs.current[next]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus((index + 1) % tabs.length);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus((index - 1 + tabs.length) % tabs.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      moveFocus(tabs.length - 1);
    }
  }

  return (
    <div
      role="tablist"
      aria-label="系统设置分组"
      className="flex gap-1 overflow-x-auto border-b border-hairline pb-px"
    >
      {tabs.map((tab, index) => {
        const active = tab.group === activeGroup;
        const dirty = dirtyGroups[tab.group] === true;
        const dirtyDescriptionId = `${settingsTabId(tab.group)}-dirty`;
        return (
          <button
            key={tab.group}
            ref={(element) => {
              refs.current[index] = element;
            }}
            id={settingsTabId(tab.group)}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={settingsPanelId(tab.group)}
            aria-describedby={dirty ? dirtyDescriptionId : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.group)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "relative flex min-h-10 shrink-0 items-center gap-2 rounded-t-control px-3 text-[12px] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring",
              active
                ? "border-b-2 border-ink text-ink"
                : "border-b-2 border-transparent text-muted hover:text-body",
            )}
          >
            {tab.label}
            {dirty ? (
              <>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-orange" />
                <span id={dirtyDescriptionId} className="sr-only">
                  有未保存修改
                </span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
