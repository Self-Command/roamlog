"use client";

import { useCallback } from "react";

import type { AdminConsoleRole } from "../../lib/admin-types";
import type { AdminSettingsApi } from "../../lib/admin-settings-api";
import { AppearanceDefaults } from "./appearance-defaults";
import { SettingsGroupForm } from "./settings-group-form";
import { settingsPanelId, settingsTabId, type SettingsTabGroup } from "./settings-tabs";

interface SettingsGroupPanelProps {
  group: SettingsTabGroup;
  role: AdminConsoleRole;
  api: AdminSettingsApi;
  active: boolean;
  onDirtyChange: (group: SettingsTabGroup, dirty: boolean) => void;
}

export function SettingsGroupPanel({
  group,
  role,
  api,
  active,
  onDirtyChange,
}: SettingsGroupPanelProps) {
  const handleDirtyChange = useCallback(
    (dirty: boolean) => onDirtyChange(group, dirty),
    [group, onDirtyChange],
  );

  return (
    <div
      id={settingsPanelId(group)}
      role="tabpanel"
      aria-labelledby={settingsTabId(group)}
      hidden={!active}
      tabIndex={0}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
    >
      {group === "theme" ? (
        <AppearanceDefaults role={role} api={api} onDirtyChange={handleDirtyChange} />
      ) : (
        <SettingsGroupForm
          group={group}
          role={role}
          api={api}
          showReadOnlyNote={false}
          onDirtyChange={handleDirtyChange}
        />
      )}
    </div>
  );
}
