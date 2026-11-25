"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ProviderCatalog, ProviderGroupResponse } from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { ProviderGroupKey, ProviderSettingsApi } from "../../lib/provider-settings-api";

export interface ProviderSettingsState {
  catalog: ProviderCatalog | null;
  group: ProviderGroupResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

function errorLabel(error: unknown): string {
  if (error instanceof AdminMutationError) {
    return "无法加载服务商配置，请稍后重试；如果持续失败，请联系平台管理员。";
  }
  return "无法加载服务商配置，请稍后重试。";
}

export function useProviderSettings(
  api: ProviderSettingsApi,
  group: ProviderGroupKey,
): ProviderSettingsState {
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [groupData, setGroupData] = useState<ProviderGroupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [nextCatalog, nextGroup] = await Promise.all([api.catalog(), api.group(group)]);
      if (current !== requestId.current) {
        return;
      }
      setCatalog(nextCatalog);
      setGroupData(nextGroup);
    } catch (cause) {
      if (current !== requestId.current) {
        return;
      }
      setError(errorLabel(cause));
    } finally {
      if (current === requestId.current) {
        setLoading(false);
      }
    }
  }, [api, group]);

  useEffect(() => {
    void reload();
    return () => {
      requestId.current += 1;
    };
  }, [reload]);

  return { catalog, group: groupData, loading, error, reload };
}
