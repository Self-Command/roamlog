"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ProviderDraftProbeRequest,
  ProviderProbeCheck,
  ProviderProbeResponse,
} from "@roamlog/contracts";
import { Button } from "@roamlog/ui";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { ProviderSettingsApi } from "../../lib/provider-settings-api";

export type ProviderProbeSource =
  | {
      kind: "saved";
      providerId: string;
      expectedVersion: number;
      label?: string;
    }
  | {
      kind: "draft";
      input: ProviderDraftProbeRequest;
      label?: string;
    };

interface ProviderProbePanelProps {
  api: ProviderSettingsApi;
  source: ProviderProbeSource;
  autoRun?: boolean;
  disabled?: boolean;
  buttonLabel?: string;
  className?: string;
  onBusyChange?: (busy: boolean) => void;
  onComplete?: (result: ProviderProbeResponse) => void;
  onDismiss?: () => void;
}

const PROBE_ERROR_COPY: Readonly<Record<string, string>> = {
  AUTH_FAILED: "认证失败：检查用户名、应用专用密码或 API Key。",
  PROVIDER_PROBE_FAILED: "服务商拒绝了测试请求，请检查连接和凭据。",
  PROVIDER_PROBE_TIMEOUT: "测试超时，请检查服务商地址和网络。",
  PROVIDER_SECRETS_UNAVAILABLE: "密钥服务当前不可用，请稍后重试。",
  PROVIDER_SECRET_FIELD_UNKNOWN: "缺少必需的凭据，请先补全密钥。",
  PROVIDER_EGRESS_BLOCKED: "该地址被安全策略阻止，请使用公开的 http(s) 服务地址。",
  PROVIDER_CONFIG_INVALID: "服务商配置无效，请检查地址、协议和凭据。",
  PROVIDER_LIMIT_REACHED: "服务商已限流，请稍后重试。",
  PROVIDER_NOT_FOUND: "服务商已不存在，请刷新后重试。",
  PROVIDER_ADAPTER_UNSUPPORTED: "当前后台不支持该服务商类型。",
  PROVIDER_VERSION_CONFLICT: "服务商已被其他运营修改，请刷新后重试。",
  ADMIN_2FA_REQUIRED: "请先完成两步验证，再测试连接。",
  ADMIN_ACCESS_DENIED: "当前账号没有测试服务商的权限。",
  ADMIN_API_NETWORK: "无法连接后台服务，请检查网络后重试。",
  ADMIN_RESPONSE_INVALID: "测试响应无法解析，请刷新后重试。",
};

function sourceKey(source: ProviderProbeSource): string {
  return source.kind === "saved"
    ? `saved:${source.providerId}:${source.expectedVersion}`
    : `draft:${JSON.stringify(source.input)}`;
}

function probeErrorMessage(error: unknown): string {
  if (!(error instanceof AdminMutationError)) {
    return "测试没有完成，请检查配置后重试。";
  }
  const mapped = PROBE_ERROR_COPY[error.failure.code];
  if (mapped) {
    return mapped;
  }
  if (error.failure.status === 403) {
    return "当前账号没有测试服务商的权限。";
  }
  if (error.failure.status === 429) {
    return "测试请求过于频繁，请稍后重试。";
  }
  if (error.failure.status === 0) {
    return "无法连接后台服务，请检查网络后重试。";
  }
  return "测试没有完成，请检查配置后重试。";
}

function checkLabel(status: ProviderProbeCheck["status"]): string {
  switch (status) {
    case "pass":
      return "通过";
    case "fail":
      return "失败";
    case "skip":
      return "跳过";
  }
}

function checkTone(status: ProviderProbeCheck["status"]): string {
  switch (status) {
    case "pass":
      return "text-accent-green";
    case "fail":
      return "text-accent-red";
    case "skip":
      return "text-muted";
  }
}

function totalLatency(checks: readonly ProviderProbeCheck[]): number {
  return checks.reduce((total, check) => total + (check.latencyMs ?? 0), 0);
}

function checkedCount(checks: readonly ProviderProbeCheck[]): number {
  return checks.filter((check) => check.status !== "skip").length;
}

export function ProviderProbePanel({
  api,
  source,
  autoRun = false,
  disabled = false,
  buttonLabel = "测试连接",
  className,
  onBusyChange,
  onComplete,
  onDismiss,
}: ProviderProbePanelProps) {
  const sourceRef = useRef(source);
  const apiRef = useRef(api);
  const disabledRef = useRef(disabled);
  const completeRef = useRef(onComplete);
  const busyRef = useRef(onBusyChange);
  const requestId = useRef(0);
  const lastAutoRunKey = useRef<string | null>(null);
  const key = sourceKey(source);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProviderProbeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  sourceRef.current = source;
  apiRef.current = api;
  disabledRef.current = disabled;
  completeRef.current = onComplete;
  busyRef.current = onBusyChange;

  const run = useCallback(async () => {
    if (disabledRef.current) {
      return;
    }
    const current = sourceRef.current;
    const thisRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    setResult(null);
    busyRef.current?.(true);
    try {
      const next =
        current.kind === "saved"
          ? await apiRef.current.probe(current.providerId, current.expectedVersion)
          : await apiRef.current.probeDraft(current.input);
      if (thisRequest !== requestId.current) {
        return;
      }
      setResult(next);
      completeRef.current?.(next);
    } catch (cause) {
      if (thisRequest !== requestId.current) {
        return;
      }
      setError(probeErrorMessage(cause));
    } finally {
      if (thisRequest === requestId.current) {
        setLoading(false);
        busyRef.current?.(false);
      }
    }
  }, []);

  useEffect(() => {
    requestId.current += 1;
    setLoading(false);
    setResult(null);
    setError(null);
    busyRef.current?.(false);
  }, [key]);

  useEffect(() => {
    if (!autoRun || disabled || lastAutoRunKey.current === key) {
      return;
    }
    lastAutoRunKey.current = key;
    void run();
  }, [autoRun, disabled, key, run]);

  useEffect(
    () => () => {
      requestId.current += 1;
      busyRef.current?.(false);
    },
    [],
  );

  const failedResult = result && !result.ok;
  const checks = result?.checks ?? [];
  const failureCheck = checks.find((check) => check.status === "fail");
  const failureSummary =
    failureCheck?.code && PROBE_ERROR_COPY[failureCheck.code]
      ? PROBE_ERROR_COPY[failureCheck.code]
      : "测试失败，请查看检查项后重试。";
  const retryLabel = result || error ? "重新测试" : buttonLabel;

  return (
    <section
      className={`rounded-card border border-hairline-strong bg-surface-1 p-4 ${className ?? ""}`}
      data-provider-probe-panel={source.kind}
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-eyebrow">连接测试</p>
          <p className="mt-1 text-[12px] leading-5 text-muted">
            {source.label ? `测试 ${source.label}` : "验证服务商地址、凭据和最小请求。"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onDismiss ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="关闭测试面板"
              onClick={onDismiss}
              disabled={loading}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || loading}
            onClick={() => void run()}
          >
            {loading ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            {loading ? "测试中…" : retryLabel}
          </Button>
        </div>
      </div>

      {loading ? (
        <p role="status" aria-live="polite" className="mt-3 text-[11px] leading-5 text-muted">
          正在连接服务商并执行最小可用性检查…
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-[11px] leading-5 text-accent-red"
        >
          {error}
        </div>
      ) : null}

      {result?.ok ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 rounded-control border border-accent-green/25 bg-accent-green/5 px-3 py-2"
        >
          <p className="flex items-center gap-2 text-[12px] font-medium text-accent-green">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            连接正常
          </p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
            {checkedCount(checks)} 项检查 · 延迟 {totalLatency(checks)} ms
          </p>
        </div>
      ) : null}

      {failedResult ? (
        <div
          role="alert"
          className="mt-3 rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2"
        >
          <p className="flex items-center gap-2 text-[12px] font-medium text-accent-red">
            <AlertTriangle aria-hidden="true" className="size-4" />
            测试未通过
          </p>
          <p className="mt-1 text-[11px] leading-5 text-accent-red">{failureSummary}</p>
        </div>
      ) : null}

      {result ? (
        <ul aria-label="连接检查项" className="mt-3 space-y-2 border-t border-hairline pt-3">
          {checks.map((check, index) => (
            <li
              key={`${check.name}-${index}`}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-[10px]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={`shrink-0 font-mono ${checkTone(check.status)}`}>
                  {checkLabel(check.status)}
                </span>
                <span className="truncate text-body">{check.name}</span>
              </span>
              <span className="font-mono text-[9px] text-muted">
                {check.latencyMs === null ? "—" : `${check.latencyMs} ms`}
              </span>
              {check.message ? (
                <p className="basis-full pl-10 text-[10px] leading-4 text-muted">{check.message}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
