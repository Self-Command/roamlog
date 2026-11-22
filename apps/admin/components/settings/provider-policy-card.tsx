"use client";

import { Route } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ProviderGroupResponse, ProviderRoutingMode } from "@roamlog/contracts";
import { Button, FormField, Input, Select } from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/admin-types";
import type { ProviderGroupKey, ProviderSettingsApi } from "../../lib/provider-settings-api";
import { providerMutationErrorMessage } from "../../lib/provider-settings";

export const ROUTING_COPY: Record<ProviderRoutingMode, { label: string; description: string }> = {
  priority: {
    label: "优先级回退",
    description:
      "按顺序尝试服务商；网络错误、超时、限流和 5xx 会切到下一个，流式响应开始后不切换。",
  },
  merge: {
    label: "并行召回合并",
    description:
      "并行查询符合条件的服务商，优先级用于来源顺序和同分排序；单个服务商失败不阻塞结果。",
  },
  priority_failover: {
    label: "严格优先级回退",
    description: "严格回退更省额度但延迟更高；结果不足或失败后才请求下一个服务商。",
  },
  single: {
    label: "单实例",
    description: "当前版本只允许一个启用的服务商；新增实例会保持停用，避免重复投递或对象路由冲突。",
  },
};

interface ProviderPolicyCardProps {
  group: ProviderGroupKey;
  role: AdminConsoleRole;
  data: ProviderGroupResponse;
  routingModes: readonly ProviderRoutingMode[];
  api: ProviderSettingsApi;
  onSaved: (next: ProviderGroupResponse) => void;
  onMessage: (message: string | null) => void;
}

function parseBoundedInteger(value: string, min: number, max: number): number | null {
  if (!/^\d+$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function ProviderPolicyCard({
  group,
  role,
  data,
  routingModes,
  api,
  onSaved,
  onMessage,
}: ProviderPolicyCardProps) {
  const [mode, setMode] = useState<ProviderRoutingMode>(data.routingMode);
  const [attempts, setAttempts] = useState(String(data.maxAttempts));
  const [cooldown, setCooldown] = useState(String(data.cooldownSeconds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(data.routingMode);
    setAttempts(String(data.maxAttempts));
    setCooldown(String(data.cooldownSeconds));
    setError(null);
  }, [data.cooldownSeconds, data.maxAttempts, data.routingMode, data.version]);

  const modes = useMemo(() => {
    const available = routingModes.filter(
      (value) => value === "merge" || value === "priority_failover",
    );
    return available.length > 0 ? available : [data.routingMode];
  }, [data.routingMode, routingModes]);

  const policyEditable = role === "super_admin" && (group === "places" || group === "ai");
  const routingEditable = group === "places" && role === "super_admin";
  const selectedCopy = ROUTING_COPY[mode];
  const parsedAttempts = parseBoundedInteger(attempts, 1, 5);
  const parsedCooldown = parseBoundedInteger(cooldown, 0, 3_600);
  const dirty =
    mode !== data.routingMode ||
    parsedAttempts !== data.maxAttempts ||
    parsedCooldown !== data.cooldownSeconds;

  async function save() {
    if (!policyEditable || !dirty || parsedAttempts === null || parsedCooldown === null) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await api.updatePolicy(group, {
        routingMode: mode,
        maxAttempts: parsedAttempts,
        cooldownSeconds: parsedCooldown,
        expectedVersion: data.version,
      });
      onMessage(null);
      onSaved(next);
    } catch (cause) {
      const message = providerMutationErrorMessage(cause);
      setError(message);
      onMessage(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-card border border-hairline-strong bg-surface-1 p-4 sm:p-5"
      data-testid="provider-policy-card"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-muted">
          <Route aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="type-eyebrow">路由策略</p>
          <h2 className="mt-1 text-[14px] font-medium text-ink">{selectedCopy.label}</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted">
            {selectedCopy.description}
          </p>
        </div>
      </div>

      {group === "places" || group === "ai" ? (
        <div className="mt-4 grid gap-3 border-t border-hairline pt-4 sm:grid-cols-[minmax(0,1.5fr)_110px_120px_auto] sm:items-end">
          <FormField label="路由模式">
            <Select
              aria-label="路由模式"
              value={mode}
              disabled={!routingEditable}
              onChange={(event) => setMode(event.currentTarget.value as ProviderRoutingMode)}
            >
              {modes.map((value) => (
                <option key={value} value={value}>
                  {ROUTING_COPY[value].label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="最大尝试">
            <Input
              type="number"
              min={1}
              max={5}
              value={attempts}
              disabled={!policyEditable}
              aria-invalid={parsedAttempts === null}
              onChange={(event) => setAttempts(event.currentTarget.value)}
            />
          </FormField>
          <FormField label="冷却（秒）">
            <Input
              type="number"
              min={0}
              max={3_600}
              value={cooldown}
              disabled={!policyEditable}
              aria-invalid={parsedCooldown === null}
              onChange={(event) => setCooldown(event.currentTarget.value)}
            />
          </FormField>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !policyEditable ||
              !dirty ||
              parsedAttempts === null ||
              parsedCooldown === null ||
              saving
            }
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存路由策略"}
          </Button>
        </div>
      ) : (
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-3 font-mono text-[9px] uppercase tracking-[0.08em]">
          <div>
            <dt className="inline text-muted">最大尝试 </dt>
            <dd className="inline text-body">{data.maxAttempts}</dd>
          </div>
          <div>
            <dt className="inline text-muted">冷却 </dt>
            <dd className="inline text-body">{data.cooldownSeconds}s</dd>
          </div>
          <div>
            <dt className="inline text-muted">版本 </dt>
            <dd className="inline text-body">v{data.version}</dd>
          </div>
        </dl>
      )}

      {mode === "priority_failover" ? (
        <p
          role="status"
          className="mt-3 rounded-control border border-accent-yellow/20 bg-accent-yellow/5 px-3 py-2 text-[11px] leading-5 text-accent-yellow"
        >
          严格回退更省额度但延迟更高：会按顺序请求服务商，结果不足或失败后才请求下一个。
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-[11px] leading-5 text-accent-red">
          {error}
        </p>
      ) : null}
    </section>
  );
}
