"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { ProviderDiscoveredModel, ProviderGroup } from "@roamlog/contracts";
import { Button, Input, Label } from "@roamlog/ui";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { ProviderSettingsApi } from "../../lib/provider-settings-api";
import { providerMutationErrorMessage } from "../../lib/provider-settings";

export type ProviderModelDiscoveryStatus = "idle" | "loading" | "ready" | "empty" | "error";

export interface ProviderModelDiscoveryState {
  readonly status: ProviderModelDiscoveryStatus;
  readonly models: readonly ProviderDiscoveredModel[];
  readonly message: string | null;
  readonly manualEntryRequired: boolean;
}

interface UseProviderModelDiscoveryOptions {
  api: ProviderSettingsApi;
  enabled: boolean;
  group: ProviderGroup;
  adapter: string;
  preset: string | null;
  baseUrl: string;
  apiKeyDraft: string;
  hasSavedKey: boolean;
  providerId?: string;
  expectedVersion?: number;
  onVersionBump?: (version: number) => void;
}

const DEBOUNCE_MS = 700;

function idleMessage(
  providerId: string | undefined,
  hasSavedKey: boolean,
  baseUrl: string,
  apiKeyDraft: string,
): string {
  if (!baseUrl.trim()) {
    return "填写 Base URL 后获取模型。";
  }
  if (!apiKeyDraft.trim() && !hasSavedKey) {
    return "填写 API Key 后自动获取模型。";
  }
  if (providerId && !apiKeyDraft.trim() && hasSavedKey) {
    return "已保存密钥。点击“获取模型”使用已保存密钥刷新目录。";
  }
  return "准备获取模型…";
}

function discoveryErrorMessage(error: unknown): string {
  if (error instanceof AdminMutationError) {
    switch (error.failure.code) {
      case "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED":
        return "该服务商没有可用的模型目录，请手动填写模型 ID。";
      case "PROVIDER_MODELS_DISCOVERY_TIMEOUT":
        return "获取模型超时，请检查 Base URL 和服务商网络后重试。";
      case "PROVIDER_MODELS_RESPONSE_TOO_LARGE":
        return "服务商返回的模型目录过大，已拒绝处理。";
      case "PROVIDER_EGRESS_BLOCKED":
        return "该地址被安全策略阻止，不能用于获取模型。";
      case "PROVIDER_MODELS_DISCOVERY_FAILED":
        return "获取模型失败，请确认 Base URL、协议和 API Key 是否正确。";
      case "PROVIDER_SECRETS_UNAVAILABLE":
        return "密钥服务不可用，暂时无法使用已保存密钥获取模型。";
      case "ADMIN_2FA_REQUIRED":
        return "需要完成 TOTP 两步验证后再获取模型。";
      case "ADMIN_ACCESS_DENIED":
        return "当前账号没有获取服务商模型的权限。";
      default:
        break;
    }
  }
  return providerMutationErrorMessage(error);
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function useProviderModelDiscovery({
  api,
  enabled,
  group,
  adapter,
  preset,
  baseUrl,
  apiKeyDraft,
  hasSavedKey,
  providerId,
  expectedVersion,
  onVersionBump,
}: UseProviderModelDiscoveryOptions): ProviderModelDiscoveryState & {
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<ProviderModelDiscoveryState>({
    status: "idle",
    models: [],
    message: idleMessage(providerId, hasSavedKey, baseUrl, apiKeyDraft),
    manualEntryRequired: false,
  });
  const requestId = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const versionBumpRef = useRef(onVersionBump);
  versionBumpRef.current = onVersionBump;
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) {
      return;
    }
    const normalizedBaseUrl = baseUrl.trim();
    if (!normalizedBaseUrl) {
      setState({
        status: "idle",
        models: [],
        message: "填写 Base URL 后获取模型。",
        manualEntryRequired: false,
      });
      return;
    }

    const draftKey = apiKeyDraft.trim();
    if (!draftKey && !hasSavedKey) {
      setState({
        status: "idle",
        models: [],
        message: "填写 API Key 后自动获取模型。",
        manualEntryRequired: false,
      });
      return;
    }

    if (providerId && !draftKey && hasSavedKey && expectedVersion === undefined) {
      setState({
        status: "error",
        models: [],
        message: "缺少当前服务商版本，请关闭并重新打开编辑器后再试。",
        manualEntryRequired: false,
      });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const thisRequest = ++requestId.current;
    setState({
      status: "loading",
      models: [],
      message: null,
      manualEntryRequired: false,
    });

    try {
      const usingSavedCredential = Boolean(providerId && !draftKey && hasSavedKey);
      const response = usingSavedCredential
        ? await api.refreshModels(providerId as string, expectedVersion as number, {
            signal: controller.signal,
          })
        : await api.discoverModels(
            {
              group,
              adapter,
              preset,
              baseUrl: normalizedBaseUrl,
              ...(draftKey ? { apiKey: draftKey } : {}),
              ...(providerId && !draftKey
                ? {
                    providerId,
                    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
                  }
                : {}),
            },
            { signal: controller.signal },
          );
      if (thisRequest !== requestId.current || controller.signal.aborted) {
        return;
      }
      if (usingSavedCredential && expectedVersion !== undefined) {
        versionBumpRef.current?.(expectedVersion + 1);
      }
      setState({
        status: response.models.length > 0 ? "ready" : "empty",
        models: response.models,
        message:
          response.models.length > 0 ? null : "服务商返回了空模型列表，可以手动填写模型 ID。",
        manualEntryRequired: response.manualEntryRequired || response.models.length === 0,
      });
    } catch (error) {
      if (thisRequest !== requestId.current || isAbortError(error, controller.signal)) {
        return;
      }
      setState({
        status: "error",
        models: [],
        message: discoveryErrorMessage(error),
        manualEntryRequired: true,
      });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [
    adapter,
    api,
    apiKeyDraft,
    baseUrl,
    enabled,
    expectedVersion,
    group,
    hasSavedKey,
    preset,
    providerId,
  ]);

  const autoDiscover =
    enabled &&
    baseUrl.trim().length > 0 &&
    (!providerId ? Boolean(apiKeyDraft.trim() || hasSavedKey) : Boolean(apiKeyDraft.trim()));
  refreshRef.current = refresh;

  useEffect(() => {
    if (!autoDiscover) {
      controllerRef.current?.abort();
      setState({
        status: "idle",
        models: [],
        message: idleMessage(providerId, hasSavedKey, baseUrl, apiKeyDraft),
        manualEntryRequired: false,
      });
      return;
    }
    const timer = setTimeout(() => {
      void refreshRef.current();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controllerRef.current?.abort();
    };
  }, [autoDiscover, apiKeyDraft, baseUrl, hasSavedKey, providerId]);

  useEffect(
    () => () => {
      requestId.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  return { ...state, refresh };
}

interface ProviderModelPickerProps {
  api: ProviderSettingsApi;
  group: ProviderGroup;
  adapter: string;
  preset: string | null;
  baseUrl: string;
  apiKeyDraft: string;
  hasSavedKey: boolean;
  providerId?: string;
  expectedVersion?: number;
  value: string;
  label?: string;
  help?: string;
  error?: string;
  disabled?: boolean;
  onChange: (modelId: string) => void;
  onVersionBump?: (version: number) => void;
  onModelsChange?: (models: readonly ProviderDiscoveredModel[]) => void;
}

function optionLabel(model: ProviderDiscoveredModel): string {
  return model.displayName === model.modelId
    ? model.modelId
    : `${model.displayName} · ${model.modelId}`;
}

export function ProviderModelPicker({
  api,
  group,
  adapter,
  preset,
  baseUrl,
  apiKeyDraft,
  hasSavedKey,
  providerId,
  expectedVersion,
  value,
  label = "默认模型",
  help = "填写 Base URL 和 API Key 后自动获取；目录不可用时可手动填写模型 ID。",
  error,
  disabled = false,
  onChange,
  onVersionBump,
  onModelsChange,
}: ProviderModelPickerProps) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const discovery = useProviderModelDiscovery({
    api,
    enabled: !disabled,
    group,
    adapter,
    preset,
    baseUrl,
    apiKeyDraft,
    hasSavedKey,
    providerId,
    expectedVersion,
    onVersionBump,
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [manualMode, setManualMode] = useState(false);
  const modelsChangeRef = useRef(onModelsChange);
  modelsChangeRef.current = onModelsChange;

  useEffect(() => {
    modelsChangeRef.current?.(discovery.models);
  }, [discovery.models]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return discovery.models;
    }
    return discovery.models.filter(
      (model) =>
        model.modelId.toLocaleLowerCase().includes(normalized) ||
        model.displayName.toLocaleLowerCase().includes(normalized),
    );
  }, [discovery.models, query]);

  const currentMissing =
    Boolean(value) &&
    discovery.status === "ready" &&
    !discovery.models.some((model) => model.modelId === value);
  const canRefresh =
    !disabled && baseUrl.trim().length > 0 && (Boolean(apiKeyDraft.trim()) || hasSavedKey);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
        setQuery("");
        setActiveIndex(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return;
    }
    const option = document.getElementById(`${listboxId}-${activeIndex}`);
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, listboxId, open]);

  function selectModel(model: ProviderDiscoveredModel) {
    onChange(model.modelId);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (manualMode) {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setQuery("");
      }
      setActiveIndex((current) => Math.min(current + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(-1, Math.min(current - 1, filtered.length - 1)));
      return;
    }
    if (event.key === "Home") {
      if (!open) return;
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
      return;
    }
    if (event.key === "Enter") {
      if (open && activeIndex >= 0 && filtered[activeIndex]) {
        event.preventDefault();
        selectModel(filtered[activeIndex]);
      }
      return;
    }
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
    }
  }

  const statusText =
    discovery.status === "loading"
      ? "正在获取模型…"
      : discovery.status === "ready"
        ? `已获取 ${discovery.models.length} 个模型`
        : discovery.status === "empty"
          ? "没有返回模型，可手动填写模型 ID。"
          : discovery.status === "error"
            ? discovery.message
            : discovery.message;

  return (
    <div className="w-full" ref={containerRef} data-testid="provider-model-picker">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Label htmlFor={inputId} className="mb-1.5">
          {label}
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canRefresh || discovery.status === "loading"}
          onClick={() => void discovery.refresh()}
        >
          {discovery.status === "loading" ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          {discovery.status === "loading" ? "获取中…" : "获取模型"}
        </Button>
      </div>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open && !manualMode}
          aria-controls={open && !manualMode ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
          }
          aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder="搜索模型 ID 或名称"
          className="pl-9"
          value={manualMode ? value : open ? query : value}
          onFocus={() => {
            if (manualMode) return;
            setOpen(true);
            setQuery("");
            setActiveIndex(-1);
          }}
          onClick={() => {
            if (manualMode) return;
            setOpen(true);
          }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (manualMode) {
              onChange(next);
              return;
            }
            setOpen(true);
            setQuery(next);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />

        {open && !manualMode && filtered.length > 0 ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="可用模型"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-control border border-hairline-strong bg-surface-1 p-1 shadow-lg"
          >
            {filtered.map((model, index) => (
              <li
                key={model.modelId}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={model.modelId === value}
                data-active={index === activeIndex ? "true" : undefined}
                className={`cursor-pointer rounded-control px-3 py-2 text-xs ${
                  index === activeIndex ? "bg-surface-2 text-ink" : "text-body hover:bg-surface-2"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectModel(model)}
              >
                <span className="block truncate">{optionLabel(model)}</span>
                {model.ownedBy ? (
                  <span className="mt-0.5 block font-mono text-[9px] text-muted">
                    {model.ownedBy}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {currentMissing ? (
        <p className="mt-1.5 text-[10px] leading-4 text-accent-yellow">
          当前模型不在本次返回的目录中，保存前请确认或重新选择。
        </p>
      ) : null}
      {statusText ? (
        <p
          role={discovery.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`mt-1.5 flex items-start gap-1.5 text-[11px] leading-5 ${
            discovery.status === "error"
              ? "text-accent-red"
              : discovery.status === "ready"
                ? "text-accent-green"
                : "text-muted"
          }`}
        >
          {discovery.status === "loading" ? (
            <Loader2 aria-hidden="true" className="mt-0.5 size-3.5 animate-spin" />
          ) : discovery.status === "error" ? (
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5" />
          ) : discovery.status === "ready" ? (
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5" />
          ) : null}
          <span>{statusText}</span>
        </p>
      ) : null}
      {discovery.manualEntryRequired && !manualMode ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1"
          onClick={() => {
            setManualMode(true);
            setOpen(false);
            setQuery("");
          }}
        >
          手动输入模型 ID
        </Button>
      ) : null}
      {manualMode ? (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] leading-4 text-accent-yellow">
            手动模型未验证，保存后请先测试连接。
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setManualMode(false);
              setOpen(false);
            }}
          >
            选择目录模型
          </Button>
        </div>
      ) : null}
      {help ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs leading-5 text-muted">
          {help}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="mt-1.5 text-xs leading-5 text-accent-red"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
