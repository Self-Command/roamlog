"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  PauseCircle,
  Pencil,
  Play,
  Trash2,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  ProviderCatalog,
  ProviderCatalogGroup,
  ProviderConnection,
  ProviderHealthStatus,
} from "@roamlog/contracts";
import { Badge, Button, Switch } from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/admin-types";
import { formatDateTime } from "../../lib/format";

type ProviderTone = "neutral" | "green" | "yellow" | "red" | "slate";

interface HealthView {
  label: string;
  tone: ProviderTone;
  icon: LucideIcon;
}

const HEALTH_VIEWS: Record<ProviderHealthStatus, HealthView> = {
  unknown: { label: "未验证", tone: "neutral", icon: CircleHelp },
  healthy: { label: "正常", tone: "green", icon: CheckCircle2 },
  degraded: { label: "降级", tone: "yellow", icon: AlertTriangle },
  unhealthy: { label: "异常", tone: "red", icon: XCircle },
};

const DISABLED_HEALTH: HealthView = {
  label: "已停用",
  tone: "slate",
  icon: PauseCircle,
};

export interface ProviderRowActions {
  onEdit: (provider: ProviderConnection) => void;
  onProbe: (provider: ProviderConnection) => void;
  onToggle: (provider: ProviderConnection, enabled: boolean) => void;
  onDelete: (provider: ProviderConnection) => void;
}

function catalogGroup(catalog: ProviderCatalog, group: string): ProviderCatalogGroup | null {
  return catalog.groups.find((entry) => entry.group === group) ?? null;
}

export function providerPresetLabel(
  provider: ProviderConnection,
  catalog: ProviderCatalog,
): string {
  const group = catalogGroup(catalog, provider.group);
  const adapter = group?.adapters.find((entry) => entry.adapter === provider.adapter);
  const preset = adapter?.presets.find((entry) => entry.preset === provider.preset);
  return preset?.label ?? adapter?.label ?? provider.adapter;
}

export function providerHealthView(provider: ProviderConnection): HealthView {
  return provider.enabled
    ? (HEALTH_VIEWS[provider.health.status] ?? HEALTH_VIEWS.unknown)
    : DISABLED_HEALTH;
}

export function providerSecretLabel(provider: ProviderConnection): string {
  const secret = provider.secrets.find((entry) => entry.hasValue);
  if (!secret) {
    return "未设置";
  }
  return secret.last4 ? `••••${secret.last4}` : "已设置";
}

function lastCheckedLabel(provider: ProviderConnection): string {
  return provider.health.lastCheckedAt ? formatDateTime(provider.health.lastCheckedAt) : "从未测试";
}

function HealthBadge({ provider }: { provider: ProviderConnection }) {
  const view = providerHealthView(provider);
  const Icon = view.icon;
  return (
    <Badge tone={view.tone}>
      <Icon aria-hidden="true" className="size-3" />
      {view.label}
    </Badge>
  );
}

function RowActions({
  provider,
  role,
  onEdit,
  onProbe,
  onDelete,
  compact = false,
}: {
  provider: ProviderConnection;
  role: AdminConsoleRole;
  onEdit: () => void;
  onProbe: () => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const canWrite = role === "super_admin";
  return (
    <div className={compact ? "flex flex-wrap items-center gap-1.5" : "flex justify-end gap-1.5"}>
      <Button
        variant="ghost"
        size="sm"
        disabled={!canWrite}
        aria-label={`测试 ${provider.label}`}
        title={canWrite ? `测试 ${provider.label}` : "你没有测试服务商的权限。"}
        onClick={onProbe}
      >
        <Play aria-hidden="true" />
        <span className={compact ? "" : "max-lg:hidden"}>测试</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!canWrite}
        aria-label={`编辑 ${provider.label}`}
        title={canWrite ? `编辑 ${provider.label}` : "你没有编辑服务商的权限。"}
        onClick={onEdit}
      >
        <Pencil aria-hidden="true" />
        <span className={compact ? "" : "max-lg:hidden"}>编辑</span>
      </Button>
      <Button
        variant="danger"
        size="sm"
        disabled={!canWrite}
        aria-label={`删除 ${provider.label}`}
        title={canWrite ? `删除 ${provider.label}` : "你没有删除服务商的权限。"}
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" />
        <span className={compact ? "" : "max-lg:hidden"}>删除</span>
      </Button>
    </div>
  );
}

interface ProviderRowProps extends ProviderRowActions {
  provider: ProviderConnection;
  catalog: ProviderCatalog;
  role: AdminConsoleRole;
}

export function ProviderTableRow({
  provider,
  catalog,
  role,
  onEdit,
  onProbe,
  onToggle,
  onDelete,
}: ProviderRowProps) {
  const canWrite = role === "super_admin";
  return (
    <tr className="border-t border-hairline align-middle" data-provider-id={provider.id}>
      <td className="px-3 py-4 font-mono text-[10px] text-muted">{provider.priority / 10}</td>
      <td className="max-w-[260px] px-3 py-4">
        <p className="truncate text-[13px] font-medium text-ink">{provider.label}</p>
        <p className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
          {providerPresetLabel(provider, catalog)}
        </p>
      </td>
      <td className="px-3 py-4">
        <HealthBadge provider={provider} />
      </td>
      <td className="px-3 py-4 font-mono text-[10px] text-body">{providerSecretLabel(provider)}</td>
      <td className="px-3 py-4 font-mono text-[9px] text-muted">{lastCheckedLabel(provider)}</td>
      <td className="px-3 py-4">
        <Switch
          checked={provider.enabled}
          disabled={!canWrite}
          aria-label={`启用 ${provider.label}`}
          onCheckedChange={(enabled) => onToggle(provider, enabled)}
        />
      </td>
      <td className="px-3 py-4">
        <RowActions
          provider={provider}
          role={role}
          onEdit={() => onEdit(provider)}
          onProbe={() => onProbe(provider)}
          onDelete={() => onDelete(provider)}
        />
      </td>
    </tr>
  );
}

export function ProviderMobileCard({
  provider,
  catalog,
  role,
  onEdit,
  onProbe,
  onToggle,
  onDelete,
}: ProviderRowProps) {
  const canWrite = role === "super_admin";
  return (
    <li
      className="rounded-card border border-hairline-strong bg-surface-1 p-4"
      data-provider-id={provider.id}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
            优先级 {provider.priority / 10}
          </p>
          <p className="mt-1 truncate text-[13px] font-medium text-ink">{provider.label}</p>
          <p className="mt-0.5 truncate font-mono text-[9px] text-muted">
            {providerPresetLabel(provider, catalog)}
          </p>
        </div>
        <Switch
          checked={provider.enabled}
          disabled={!canWrite}
          aria-label={`启用 ${provider.label}`}
          onCheckedChange={(enabled) => onToggle(provider, enabled)}
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3 text-[10px]">
        <div>
          <dt className="type-eyebrow">状态</dt>
          <dd className="mt-1">
            <HealthBadge provider={provider} />
          </dd>
        </div>
        <div>
          <dt className="type-eyebrow">凭据</dt>
          <dd className="mt-1 font-mono text-body">{providerSecretLabel(provider)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="type-eyebrow">最近验证</dt>
          <dd className="mt-1 text-muted">{lastCheckedLabel(provider)}</dd>
        </div>
      </dl>
      <div className="mt-4 border-t border-hairline pt-3">
        <RowActions
          provider={provider}
          role={role}
          onEdit={() => onEdit(provider)}
          onProbe={() => onProbe(provider)}
          onDelete={() => onDelete(provider)}
          compact
        />
      </div>
    </li>
  );
}
