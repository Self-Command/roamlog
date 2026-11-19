"use client";

import { ShieldAlert } from "lucide-react";

import type { AdminConsoleRole } from "../../lib/admin-types";
import type { AdminSettingsApi } from "../../lib/admin-settings-api";
import { SYSTEM_SETTINGS_GROUPS } from "../../lib/admin-settings";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { SettingsGroupForm } from "./settings-group-form";

export interface SettingsConsoleProps {
  role: AdminConsoleRole;
  api: AdminSettingsApi;
}

/**
 * `/admin/settings` — only the four system-level groups.
 *
 * Service configuration (AI, storage, places, mail, media) lives at its own
 * sidebar destinations under `/admin/services/*`; it is deliberately not
 * rendered here and there is no second-level settings navigation on the page.
 */
export function SettingsConsole({ role, api }: SettingsConsoleProps) {
  const canWrite = role === "super_admin";

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow="平台 / 系统设置"
        title="系统设置"
        description="通用、SEO、主题与限流四组系统级配置。每个分区独立保存，服务端逐键校验、写入并审计；保存成功后重新读取确认。"
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

      <div className="space-y-10">
        {SYSTEM_SETTINGS_GROUPS.map((group) => (
          <SettingsGroupForm
            key={group}
            group={group}
            role={role}
            api={api}
            showReadOnlyNote={false}
          />
        ))}
      </div>
    </div>
  );
}
