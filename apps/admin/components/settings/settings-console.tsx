"use client";

import { ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminConsoleRole } from "../../lib/admin-types";
import type { AdminSettingsApi } from "../../lib/admin-settings-api";
import { SYSTEM_SETTINGS_GROUPS, settingsTabLabel } from "../../lib/admin-settings";
import { createCachedAdminSettingsApi } from "../../lib/cached-admin-settings-api";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { SettingsGroupPanel } from "./settings-group-panel";
import { SettingsTabs, type SettingsTab, type SettingsTabGroup } from "./settings-tabs";

export interface SettingsConsoleProps {
  role: AdminConsoleRole;
  api: AdminSettingsApi;
}

const SETTINGS_TABS: readonly SettingsTab[] = SYSTEM_SETTINGS_GROUPS.map((group) => ({
  group,
  label: settingsTabLabel(group),
}));

function groupFromLocation(): SettingsTabGroup {
  if (typeof window === "undefined") {
    return "general";
  }
  const candidate = new URLSearchParams(window.location.search).get("tab");
  return SYSTEM_SETTINGS_GROUPS.find((group) => group === candidate) ?? "general";
}

/**
 * `/admin/settings` — only the four system-level groups.
 *
 * Service configuration (AI, storage, places, mail, media) lives at its own
 * sidebar destinations under `/admin/services/*`; it is deliberately not
 * rendered here. The four scalar groups share one settings snapshot and stay
 * mounted behind tabs so switching never discards a local draft.
 */
export function SettingsConsole({ role, api }: SettingsConsoleProps) {
  const canWrite = role === "super_admin";
  const cachedApi = useMemo(() => createCachedAdminSettingsApi(api), [api]);
  const [activeGroup, setActiveGroup] = useState<SettingsTabGroup>("general");
  const [dirtyGroups, setDirtyGroups] = useState<Partial<Record<SettingsTabGroup, boolean>>>({});

  useEffect(() => {
    setActiveGroup(groupFromLocation());
    const onPopState = () => setActiveGroup(groupFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectGroup = useCallback((group: SettingsTabGroup) => {
    setActiveGroup(group);
    const url = new URL(window.location.href);
    if (group === "general") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", group);
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const changeDirty = useCallback((group: SettingsTabGroup, dirty: boolean) => {
    setDirtyGroups((current) =>
      current[group] === dirty ? current : { ...current, [group]: dirty },
    );
  }, []);

  const dirtyCount = Object.values(dirtyGroups).filter(Boolean).length;
  const anyDirty = dirtyCount > 0;

  useEffect(() => {
    if (!anyDirty) {
      return;
    }
    const message = "系统设置还有未保存的修改。离开会丢失这些内容，继续？";
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    const onClickCapture = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.getAttribute("aria-disabled") === "true"
      ) {
        return;
      }
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (
        destination.origin !== current.origin ||
        (destination.pathname === current.pathname &&
          destination.search === current.search &&
          destination.hash === current.hash)
      ) {
        return;
      }
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [anyDirty]);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow="平台 / 系统设置"
        title="系统设置"
        description="通用、SEO、外观与字体、限流四组系统级配置。四组共用一次读取，切换分组不会丢失草稿；每个分区独立保存并重新读取确认。"
        readOnly={!canWrite}
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

      {anyDirty ? (
        <p
          role="status"
          className="rounded-control border border-accent-yellow/25 bg-accent-yellow/5 px-3 py-2 text-[11px] text-accent-yellow"
        >
          {dirtyCount} 个分组有未保存修改。切换分组会保留草稿；离开当前页面时会先确认。
        </p>
      ) : null}

      <div className="space-y-5">
        <SettingsTabs
          tabs={SETTINGS_TABS}
          activeGroup={activeGroup}
          dirtyGroups={dirtyGroups}
          onChange={selectGroup}
        />
        <div className="space-y-8">
          {SETTINGS_TABS.map((tab) => (
            <SettingsGroupPanel
              key={tab.group}
              group={tab.group}
              role={role}
              api={cachedApi}
              active={activeGroup === tab.group}
              onDirtyChange={changeDirty}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
