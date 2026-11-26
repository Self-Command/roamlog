"use client";

/**
 * Full model picker ported from vercel/chatbot:
 * - `components/ai-elements/model-selector.tsx` L21-L213
 * - `components/chat/multimodal-input.tsx` L786-L913
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0).
 *
 * Adaptation layer:
 * - Vercel AI Gateway's `/api/models` response is replaced by Roamlog's
 *   `GET .../ai/models`; it is already an allow-list, so every returned model is
 *   selectable.
 * - Provider logos are rendered as local two-letter marks because the upstream
 *   `models.dev` logo URLs are an external runtime dependency. Grouping, search,
 *   capability icons, keyboard behavior and the `chat-model` cookie are kept.
 * - The data hook has a small per-workspace external store so the selector and
 *   `VisionNote` share one request, matching upstream SWR's dedupe behavior.
 */

import {
  resolveReasoningEffort,
  type AiChatModel,
  type AiChatModelsResponse,
} from "@roamlog/contracts";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@roamlog/ui";
import { Brain, Check, ChevronDown, Eye, Loader2, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { fetchAiModels } from "../../lib/api/ai";
import { aiChatSelectionStore, useAiChatSelection } from "./chat-selection";
import { useAiReasoningDefault } from "./use-ai-reasoning";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";

const MODEL_COOKIE_NAME = "chat-model";
const MODEL_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface ModelSnapshot {
  readonly models: AiChatModelsResponse | null;
  readonly status: "idle" | "loading" | "ready" | "error";
}

interface ModelStore {
  getSnapshot: () => ModelSnapshot;
  subscribe: (listener: () => void) => () => void;
  refetch: () => Promise<void>;
}

const modelStores = new Map<string, ModelStore>();

function getModelStore(workspaceId: string): ModelStore {
  const existing = modelStores.get(workspaceId);
  if (existing) return existing;

  let snapshot: ModelSnapshot = { models: null, status: "idle" };
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function publish(next: ModelSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function load(): Promise<void> {
    if (inFlight) return inFlight;
    publish({ models: null, status: "loading" });
    inFlight = fetchAiModels(workspaceId)
      .then((models) => {
        publish({ models, status: "ready" });
      })
      .catch(() => {
        publish({ models: null, status: "error" });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const store: ModelStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      const wasEmpty = listeners.size === 0;
      listeners.add(listener);
      if (wasEmpty) void load();
      return () => {
        listeners.delete(listener);
      };
    },
    refetch: load,
  };
  modelStores.set(workspaceId, store);
  return store;
}

/** Test hook: forget cached model lists between test cases. */
export function resetAiChatModelStoresForTests(): void {
  modelStores.clear();
}

export function useAiChatModels(workspaceId: string): {
  models: AiChatModelsResponse | null;
  error: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
} {
  const store = getModelStore(workspaceId);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    models: snapshot.models,
    error: snapshot.status === "error",
    loading: snapshot.status === "idle" || snapshot.status === "loading",
    refetch: store.refetch,
  };
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  alibaba: "Alibaba",
  anthropic: "Anthropic",
  "arcee-ai": "Arcee AI",
  bytedance: "ByteDance",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  google: "Google",
  inception: "Inception",
  kwaipilot: "Kwaipilot",
  meituan: "Meituan",
  meta: "Meta",
  minimax: "MiniMax",
  mistral: "Mistral",
  moonshotai: "Moonshot",
  morph: "Morph",
  nvidia: "Nvidia",
  openai: "OpenAI",
  perplexity: "Perplexity",
  "prime-intellect": "Prime Intellect",
  xai: "xAI",
  xiaomi: "Xiaomi",
  zai: "Zai",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function providerMark(provider: string): string {
  const parts = provider.split(/[-_\s]+/u).filter(Boolean);
  if (parts.length > 1) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return provider.slice(0, 2).toUpperCase();
}

function readModelCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${MODEL_COOKIE_NAME}=`;
  const value = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function writeModelCookie(modelId: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${MODEL_COOKIE_NAME}=${encodeURIComponent(
    modelId,
  )}; path=/; max-age=${String(MODEL_COOKIE_MAX_AGE)}; SameSite=Lax`;
}

function ProviderMark({ provider }: { provider: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-hairline bg-surface-1 font-mono text-[7px] font-semibold tracking-[-0.04em] text-body"
      title={providerLabel(provider)}
    >
      {providerMark(provider)}
    </span>
  );
}

function CapabilityIcon({ icon: Icon, label }: { icon: typeof Wrench; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex text-stone" aria-label={label}>
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ProviderGroup({
  provider,
  models,
  selectedId,
  onSelect,
}: {
  provider: string;
  models: readonly AiChatModel[];
  selectedId: string | undefined;
  onSelect: (model: AiChatModel) => void;
}) {
  return (
    <CommandGroup
      data-testid={`model-selector-group-${provider}`}
      heading={providerLabel(provider)}
    >
      {models.map((model) => {
        const selected = model.id === selectedId;
        return (
          <CommandItem
            className="items-start gap-2.5 py-2"
            data-testid={`model-option-${model.id}`}
            keywords={[model.name, model.provider, model.description ?? ""]}
            key={model.id}
            onSelect={() => onSelect(model)}
            value={model.id}
          >
            <ProviderMark provider={model.provider} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] leading-5 text-ink">{model.name}</span>
                {selected ? (
                  <Check aria-label="当前 AI 模型" className="size-3.5 shrink-0 text-accent-green" />
                ) : null}
              </span>
              {model.description ? (
                <span className="mt-0.5 block truncate text-[10px] leading-4 text-stone">
                  {model.description}
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
              {model.reasoning ? <CapabilityIcon icon={Brain} label="支持思考" /> : null}
              {model.vision ? <CapabilityIcon icon={Eye} label="支持图片" /> : null}
              <CapabilityIcon icon={Wrench} label="支持工具调用" />
            </span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

export function ModelSelectorCompact({
  workspaceId,
  open: controlledOpen,
  onOpenChange,
}: {
  workspaceId: string;
  /** Controlled open state, matching the upstream `ModelSelector` root props. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { models, error, loading, refetch } = useAiChatModels(workspaceId);
  const selection = useAiChatSelection(workspaceId);
  const store = aiChatSelectionStore(workspaceId);
  const platformDefault = useAiReasoningDefault();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const restoredCookie = useRef(false);
  const focusTimeoutRef = useRef<number | null>(null);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  useEffect(() => {
    if (!open || focusTimeoutRef.current === null) return;
    // `/model` can reopen the selector inside the 50 ms window after a
    // selection. The upstream focus-return must not steal focus and close the
    // popover the user just requested.
    window.clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = null;
  }, [open]);

  useEffect(
    () => () => {
      if (focusTimeoutRef.current !== null) window.clearTimeout(focusTimeoutRef.current);
    },
    [],
  );

  const currentId = selection.model ?? models?.defaultModel;
  const current = models?.models.find((model) => model.id === currentId) ?? models?.models[0];
  const label = current?.name ?? (loading ? "正在加载 AI 服务…" : error ? "AI 服务加载失败" : "AI 服务");

  const grouped = useMemo(() => {
    if (!models) return [];
    const byProvider = new Map<string, AiChatModel[]>();
    for (const model of models.models) {
      const bucket = byProvider.get(model.provider) ?? [];
      bucket.push(model);
      byProvider.set(model.provider, bucket);
    }
    return [...byProvider.entries()]
      .sort(([left], [right]) => providerLabel(left).localeCompare(providerLabel(right), "zh-CN"))
      .map(([provider, entries]) => ({ provider, models: entries }));
  }, [models]);

  useEffect(() => {
    if (!models || restoredCookie.current) return;
    restoredCookie.current = true;
    if (selection.model && models.models.some((model) => model.id === selection.model)) return;
    const cookie = readModelCookie();
    const next =
      cookie && models.models.some((model) => model.id === cookie)
        ? cookie
        : models.models.some((model) => model.id === models.defaultModel)
          ? models.defaultModel
          : models.models[0]?.id;
    if (next && next !== selection.model) {
      store.set({ ...selection, model: next });
    }
  }, [models, selection, store]);

  const selectModel = useCallback(
    (model: AiChatModel) => {
      const reasoningEffort =
        selection.reasoningEffort === undefined
          ? undefined
          : resolveReasoningEffort(
              selection.reasoningEffort,
              model.reasoningEfforts,
              platformDefault,
            );
      store.set({
        ...selection,
        model: model.id,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort }),
      });
      writeModelCookie(model.id);
      setOpen(false);
      if (focusTimeoutRef.current !== null) window.clearTimeout(focusTimeoutRef.current);
      focusTimeoutRef.current = window.setTimeout(() => {
        focusTimeoutRef.current = null;
        document.querySelector<HTMLTextAreaElement>("[data-testid='multimodal-input']")?.focus();
      }, 50);
    },
    [platformDefault, selection, setOpen, store],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="选择 AI 模型"
          className="h-7 min-w-0 max-w-[220px] shrink gap-1.5 px-2 text-xs font-normal text-muted"
          data-testid="model-selector"
          size="sm"
          type="button"
          variant="ghost"
        >
          {loading ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : current ? (
            <ProviderMark provider={current.provider} />
          ) : null}
          <span className="truncate" data-testid="model-selector-current">
            {label}
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[320px] max-w-[calc(100vw-2rem)] p-0"
        side="top"
        sideOffset={8}
      >
        <TooltipProvider delayDuration={120}>
          <Command defaultValue={current?.id}>
            <CommandInput
              aria-label="搜索 AI 模型"
              autoFocus
              data-testid="model-selector-search"
              placeholder="搜索 AI 模型…"
            />
            {error ? (
              <div className="space-y-2 px-3 py-5 text-center text-xs text-muted">
                <p>暂时无法获取可用模型。</p>
                <Button size="sm" type="button" variant="outline" onClick={() => void refetch()}>
                  重新加载
                </Button>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                正在加载 AI 模型…
              </div>
            ) : !models || models.models.length === 0 ? (
              <p
                className="px-3 py-5 text-center text-xs text-muted"
                data-testid="model-selector-empty"
              >
                管理员还没有启用 AI 服务。
              </p>
            ) : (
              <CommandList>
                <CommandEmpty>没有匹配的 AI 模型。</CommandEmpty>
                {grouped.map((group) => (
                  <ProviderGroup
                    key={group.provider}
                    models={group.models}
                    onSelect={selectModel}
                    provider={group.provider}
                    selectedId={current?.id}
                  />
                ))}
              </CommandList>
            )}
            {models && models.models.length > 0 ? (
              <p className="border-t border-hairline px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                由管理员配置 · {models.models.length} 个 AI 模型
              </p>
            ) : null}
          </Command>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
