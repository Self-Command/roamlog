"use client";

import { Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProviderConnection } from "@roamlog/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
} from "@roamlog/ui";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { AdminConsoleRole } from "../../lib/admin-types";
import { SERVICE_SETTINGS_PAGES, type ServicePageKey } from "../../lib/admin-settings";
import { providerMutationErrorMessage } from "../../lib/provider-settings";
import type {
  AdminProviderSummary,
  ProviderGroupKey,
  ProviderSettingsApi,
} from "../../lib/provider-settings-api";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { DestructiveActionDialog } from "../admin-ui/destructive-action-dialog";
import { ProviderEmptyState } from "./provider-empty-state";
import { ProviderEditor } from "./provider-editor";
import { ProviderList } from "./provider-list";
import { ProviderOrderControls } from "./provider-order-controls";
import { ProviderPolicyCard } from "./provider-policy-card";
import { ProviderProbePanel } from "./provider-probe-panel";
import { useProviderSettings } from "./use-provider-settings";

function isProviderActiveConflict(error: unknown): boolean {
  return error instanceof AdminMutationError && error.failure.code === "PROVIDER_ACTIVE_CONFLICT";
}

function pageForGroup(group: ProviderGroupKey) {
  return SERVICE_SETTINGS_PAGES[group as ServicePageKey];
}

interface ProviderGroupPageProps {
  group: ProviderGroupKey;
  role: AdminConsoleRole;
  api: ProviderSettingsApi;
}

export function ProviderGroupPage({ group, role, api }: ProviderGroupPageProps) {
  const page = pageForGroup(group);
  const { catalog, group: data, loading, error, reload } = useProviderSettings(api, group);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminProviderSummary | null>(null);
  const [probeTarget, setProbeTarget] = useState<AdminProviderSummary | null>(null);
  const [activeConflict, setActiveConflict] = useState<{
    attemptedLabel: string;
    activeProvider: AdminProviderSummary | null;
  } | null>(null);
  const [dialog, setDialog] = useState<
    { kind: "add" } | { kind: "edit"; provider: ProviderConnection } | null
  >(null);

  const canWrite = role === "super_admin";
  const singleActiveMode = group === "mail" || group === "storage";
  const catalogGroup = useMemo(
    () => catalog?.groups.find((entry) => entry.group === group) ?? null,
    [catalog, group],
  );
  const enabledCount = data?.providers.filter((provider) => provider.enabled).length ?? 0;
  const healthyCount =
    data?.providers.filter((provider) => provider.enabled && provider.health.status === "healthy")
      .length ?? 0;
  const activeProvider = data?.providers.find((provider) => provider.enabled) ?? null;

  function openAdd() {
    if (!canWrite) {
      return;
    }
    setActionMessage(null);
    setDialog({ kind: "add" });
  }

  async function toggleProvider(provider: AdminProviderSummary, enabled: boolean) {
    if (!canWrite) {
      return;
    }
    setPendingProviderId(provider.id);
    setActionMessage(null);
    try {
      await api.update(provider.id, { enabled, expectedVersion: provider.version });
      await reload();
      setActionMessage(`${provider.label}已${enabled ? "启用" : "停用"}。`);
    } catch (cause) {
      if (isProviderActiveConflict(cause)) {
        setActiveConflict({
          attemptedLabel: provider.label,
          activeProvider:
            data?.providers.find(
              (candidate) => candidate.enabled && candidate.id !== provider.id,
            ) ?? null,
        });
        setActionMessage(null);
      } else {
        setActionMessage(providerMutationErrorMessage(cause));
      }
    } finally {
      setPendingProviderId(null);
    }
  }

  async function deleteProvider(provider: AdminProviderSummary) {
    if (!canWrite) {
      return;
    }
    setPendingProviderId(provider.id);
    try {
      await api.remove(provider.id, provider.version);
      if (probeTarget?.id === provider.id) {
        setProbeTarget(null);
      }
      await reload();
      setActionMessage(`${provider.label}已删除。`);
    } catch (cause) {
      setActionMessage(providerMutationErrorMessage(cause));
    } finally {
      setPendingProviderId(null);
    }
  }

  async function disableActiveProvider() {
    const active = activeConflict?.activeProvider;
    if (!active || !canWrite) {
      return;
    }
    setPendingProviderId(active.id);
    try {
      await api.update(active.id, { enabled: false, expectedVersion: active.version });
      await reload();
      setActionMessage(
        `已停用「${active.label}」。现在可以启用「${activeConflict?.attemptedLabel ?? "目标服务商"}」。`,
      );
      setActiveConflict(null);
    } catch (cause) {
      setActionMessage(providerMutationErrorMessage(cause));
    } finally {
      setPendingProviderId(null);
    }
  }

  const header = (
    <AdminPageHeader
      eyebrow="平台 / 服务配置"
      title={page.title}
      description={page.description}
      readOnly={!canWrite}
      actions={
        <Button variant="primary" size="sm" disabled={!canWrite} onClick={openAdd}>
          <Plus aria-hidden="true" />
          添加服务商
        </Button>
      }
    />
  );

  if (loading && !data) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="正在加载服务商配置">
        {header}
        <div className="space-y-3">
          <div className="h-28 animate-pulse rounded-card border border-hairline bg-surface-1" />
          <div className="h-52 animate-pulse rounded-card border border-hairline bg-surface-1" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-5">
        {header}
        <ErrorState
          description={error}
          retryAction={
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              <RefreshCw aria-hidden="true" />
              重新加载
            </Button>
          }
        />
      </div>
    );
  }

  if (!data || !catalog || !catalogGroup) {
    return (
      <div className="space-y-5">
        {header}
        <ErrorState description="服务商目录暂时不可用，请稍后重试。" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {error ? (
        <div
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-[12px] text-accent-red"
        >
          {error}
        </div>
      ) : null}

      {singleActiveMode ? (
        <div
          role="note"
          className="rounded-control border border-accent-yellow/25 bg-accent-yellow/5 px-3 py-2.5 text-[12px] leading-5 text-body"
        >
          <span className="font-medium text-ink">单一启用模式。 </span>
          {activeProvider
            ? `当前启用的是「${activeProvider.label}」。要切换服务商，请先明确停用当前实例；系统不会自动停用。`
            : "当前没有启用的服务商。只允许一个服务商处于启用状态。"}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-pill border border-hairline bg-surface-1 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-body">
            {data.providers.length} 个服务商
          </span>
          <span className="rounded-pill border border-accent-green/20 bg-accent-green/5 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent-green">
            {healthyCount} 个正常
          </span>
          <span className="rounded-pill border border-hairline bg-surface-1 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
            {enabledCount} 个启用
          </span>
        </div>
      </div>

      <ProviderPolicyCard
        group={group}
        role={role}
        data={data}
        routingModes={catalogGroup.routingModes}
        api={api}
        onMessage={setActionMessage}
        onSaved={() => {
          setActionMessage(group === "places" ? "地图路由策略已保存。" : "路由策略已保存。");
          void reload();
        }}
      />

      {data.providers.length > 1 ? (
        <ProviderOrderControls
          group={group}
          providers={data.providers}
          groupVersion={data.version}
          role={role}
          api={api}
          onSaved={() => {
            setActionMessage("服务商优先级顺序已保存。");
            void reload();
          }}
          onError={setActionMessage}
        />
      ) : null}

      {probeTarget ? (
        <ProviderProbePanel
          key={probeTarget.id}
          api={api}
          source={{
            kind: "saved",
            providerId: probeTarget.id,
            expectedVersion: probeTarget.version,
            label: probeTarget.label,
          }}
          autoRun
          onDismiss={() => setProbeTarget(null)}
          onComplete={() => {
            setActionMessage(`${probeTarget.label}测试完成。`);
            void reload();
          }}
        />
      ) : null}

      {data.providers.length === 0 ? (
        <ProviderEmptyState groupLabel={catalogGroup.label} canWrite={canWrite} onAdd={openAdd} />
      ) : (
        <ProviderList
          providers={data.providers}
          catalog={catalog}
          role={role}
          onEdit={(provider) => setDialog({ kind: "edit", provider })}
          onProbe={(provider) => {
            if (pendingProviderId === provider.id) {
              return;
            }
            setActionMessage(null);
            setProbeTarget(provider);
          }}
          onToggle={(provider, enabled) => {
            if (pendingProviderId === provider.id) {
              return;
            }
            void toggleProvider(provider, enabled);
          }}
          onDelete={(provider) => {
            if (pendingProviderId === provider.id) {
              return;
            }
            setDeleteTarget(provider);
          }}
        />
      )}

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {actionMessage}
      </div>

      {dialog ? (
        <ProviderEditor
          key={dialog.kind === "edit" ? `edit-${dialog.provider.id}` : `add-${group}`}
          open
          group={group}
          catalogGroup={catalogGroup}
          provider={dialog.kind === "edit" ? dialog.provider : null}
          groupVersion={data.version}
          api={api}
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null);
              void reload();
            }
          }}
          onSaved={(saved) => {
            setActionMessage(
              dialog.kind === "edit" ? `${saved.label}已更新。` : `${saved.label}已添加。`,
            );
            setDialog(null);
            void reload();
          }}
          canRevealSecret={role === "super_admin"}
          singleActive={singleActiveMode}
          activeProvider={
            singleActiveMode
              ? (data.providers.find(
                  (provider) =>
                    provider.enabled &&
                    (dialog.kind !== "edit" || provider.id !== dialog.provider.id),
                ) ?? null)
              : null
          }
          onActiveProviderDisabled={() => {
            void reload();
          }}
        />
      ) : null}

      <Dialog
        open={activeConflict !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActiveConflict(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>邮件和存储服务只允许一个启用的服务商</DialogTitle>
            <DialogDescription>
              {activeConflict?.activeProvider
                ? `当前「${activeConflict.activeProvider.label}」正在启用。要启用「${activeConflict.attemptedLabel}」，必须先在确认后停用当前实例。`
                : "当前已有启用的服务商。请先停用当前实例，再重新启用目标服务商。"}
            </DialogDescription>
          </DialogHeader>
          <p className="text-[11px] leading-5 text-muted">
            本次不会自动切换，也不会静默修改现有配置。停用当前实例后，再回到列表启用目标服务商即可。
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setActiveConflict(null)}>
              保留当前配置
            </Button>
            {activeConflict?.activeProvider ? (
              <Button
                variant="danger"
                size="sm"
                disabled={pendingProviderId === activeConflict.activeProvider.id}
                onClick={() => void disableActiveProvider()}
              >
                {pendingProviderId === activeConflict.activeProvider.id
                  ? "停用中…"
                  : "停用当前实例"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DestructiveActionDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title="删除服务商"
        description="该操作会软删除服务商并立即停止将其用于新的运行时请求；已有审计记录会保留。"
        targetName={deleteTarget?.label ?? ""}
        confirmationLabel="输入服务商名称确认"
        confirmActionLabel="确认删除"
        onConfirm={() => {
          const provider = deleteTarget;
          setDeleteTarget(null);
          if (provider) {
            void deleteProvider(provider);
          }
        }}
      />
    </div>
  );
}
