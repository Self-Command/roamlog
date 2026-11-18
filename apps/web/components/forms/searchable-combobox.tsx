"use client";

import { Button, Input } from "@roamlog/ui";
import { Loader2, Search, X } from "lucide-react";
import * as React from "react";

export interface ComboboxOption {
  id: string;
  label: string;
  description?: string;
  /** Right-aligned meta text, e.g. a country code or currency code. */
  meta?: string;
  /** Set by the combobox for the "use typed text" row. */
  manual?: boolean;
}

export interface ComboboxSearchResult {
  items: ComboboxOption[];
  /** Upstream place provider reported a degraded result. */
  degraded?: boolean;
}

export interface ComboboxSearchContext {
  signal: AbortSignal;
}

export type ComboboxSearch = (
  query: string,
  context: ComboboxSearchContext,
) => Promise<ComboboxSearchResult>;

export interface SearchableComboboxProps {
  id?: string;
  /** Accessible name for the search input. */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (option: ComboboxOption) => void;
  search: ComboboxSearch;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  /** Minimum trimmed query length before a request is issued. Default 2. */
  minQueryLength?: number;
  /** Debounce for typing, in milliseconds. Default 250. */
  debounceMs?: number;
  allowManual?: boolean;
  manualLabel?: (query: string) => string;
  onManual?: (query: string) => void;
  loadingLabel?: string;
  emptyLabel?: string;
  errorLabel?: string;
  /** Overrides the fixed copy used for classified failures (never the raw error). */
  errorMessages?: SearchFailureMessages;
  degradedLabel?: string;
  rateLimitedLabel?: (seconds: number) => string;
  clearLabel?: string;
  onClear?: () => void;
  className?: string;
}

type Status = "idle" | "loading" | "ready" | "error" | "rate-limited";

const DEFAULT_DEBOUNCE_MS = 250;

function readNumberProperty(error: unknown, key: string): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export type SearchFailureKind = "unavailable" | "timeout" | "offline" | "invalid-response";

/**
 * Fixed, user-readable copy for the failure kinds a search can report. The raw
 * exception is never rendered: it can contain HTTP status codes, request paths
 * or JSON parser output (see `.audit/g3-ui-journeys-report.md`).
 */
export interface SearchFailureMessages {
  timeout?: string;
  offline?: string;
  invalidResponse?: string;
}

const DEFAULT_FAILURE_MESSAGES: Required<SearchFailureMessages> = {
  timeout: "搜索超时，请重试，或直接输入内容。",
  offline: "网络连接中断，请检查网络后重试，或直接输入内容。",
  invalidResponse: "搜索服务返回异常，请重试，或直接输入内容。",
};

/**
 * Classify without ever trusting the exception text for display. Only the
 * stable error metadata (`status`, `code`, `name`) is inspected.
 */
export function classifySearchFailure(error: unknown): SearchFailureKind {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (record.code === "INVALID_RESPONSE" || record.name === "SyntaxError") {
      return "invalid-response";
    }
    if (record.name === "TimeoutError") return "timeout";
    const status = readNumberProperty(error, "status");
    if (status !== undefined) {
      if (status === 408 || status === 504) return "timeout";
      return "unavailable";
    }
    if (record.name === "TypeError") return "offline";
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    return "unavailable";
  }
  return "unavailable";
}

function failureMessage(
  error: unknown,
  errorLabel: string,
  messages: SearchFailureMessages,
): string {
  const kind = classifySearchFailure(error);
  if (kind === "timeout") return messages.timeout ?? DEFAULT_FAILURE_MESSAGES.timeout;
  if (kind === "offline") return messages.offline ?? DEFAULT_FAILURE_MESSAGES.offline;
  if (kind === "invalid-response") {
    return messages.invalidResponse ?? DEFAULT_FAILURE_MESSAGES.invalidResponse;
  }
  return errorLabel;
}

export function SearchableCombobox({
  id,
  label,
  value,
  onValueChange,
  onSelect,
  search,
  placeholder = "搜索…",
  disabled = false,
  required = false,
  invalid = false,
  "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid,
  minQueryLength = 2,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  allowManual = false,
  manualLabel = (query) => `使用「${query}」`,
  onManual,
  loadingLabel = "正在搜索…",
  emptyLabel = "没有匹配的结果",
  errorLabel = "搜索失败，请重试，或直接输入内容。",
  errorMessages = {},
  degradedLabel = "搜索服务暂时降级，可手动填写。",
  rateLimitedLabel = (seconds) => `请求过于频繁，请等待约 ${seconds} 秒后重试。`,
  clearLabel = "清除",
  onClear,
  className,
}: SearchableComboboxProps) {
  const reactId = React.useId();
  const inputId = id ?? `${reactId}-input`;
  const listboxId = `${reactId}-listbox`;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const searchRef = React.useRef(search);
  const labelsRef = React.useRef({ rateLimitedLabel, errorLabel, errorMessages });
  const lastSelectionRef = React.useRef<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<Status>("idle");
  const [items, setItems] = React.useState<ComboboxOption[]>([]);
  const [degraded, setDegraded] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [retryToken, setRetryToken] = React.useState(0);

  React.useEffect(() => {
    searchRef.current = search;
    labelsRef.current = { rateLimitedLabel, errorLabel, errorMessages };
  }, [search, rateLimitedLabel, errorLabel, errorMessages]);

  const trimmedValue = value.trim();
  const manualOption: ComboboxOption | null =
    allowManual && trimmedValue.length > 0 && !disabled
      ? { id: `${reactId}-manual`, label: manualLabel(trimmedValue), manual: true }
      : null;
  const options = React.useMemo(
    () => (manualOption ? [...items, manualOption] : items),
    [items, manualOption],
  );

  React.useEffect(() => {
    if (disabled) return;
    if (lastSelectionRef.current !== null) {
      if (trimmedValue === lastSelectionRef.current) {
        lastSelectionRef.current = null;
        return;
      }
      lastSelectionRef.current = null;
    }
    if (trimmedValue.length < minQueryLength) {
      setStatus("idle");
      setItems([]);
      setDegraded(false);
      setActiveIndex(-1);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    setOpen(true);
    setStatus("loading");
    setErrorMessage("");

    const timer = setTimeout(() => {
      void searchRef
        .current(trimmedValue, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setItems(result.items);
          setDegraded(Boolean(result.degraded));
          setStatus("ready");
          const hasManualOption = allowManual && trimmedValue.length > 0;
          setActiveIndex(result.items.length > 0 || hasManualOption ? 0 : -1);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return;
          const statusCode = readNumberProperty(error, "status");
          const retryAfter = readNumberProperty(error, "retryAfterSeconds");
          setItems([]);
          setDegraded(false);
          // Keep the manual fallback reachable: Enter must be able to pick the
          // typed place once the search fails, not only in the `ready` state.
          const keepsManualOption = allowManual && trimmedValue.length > 0;
          setActiveIndex(keepsManualOption ? 0 : -1);
          setOpen(true);
          // Raw exceptions can carry HTTP status codes, request paths and JSON
          // parser output. They belong in the console, never in the DOM.
          console.warn("SearchableCombobox: search request failed", error);
          if (statusCode === 429) {
            const seconds = retryAfter && retryAfter > 0 ? retryAfter : 30;
            setStatus("rate-limited");
            setErrorMessage(labelsRef.current.rateLimitedLabel(seconds));
            return;
          }
          setStatus("error");
          setErrorMessage(
            failureMessage(
              error,
              labelsRef.current.errorLabel,
              labelsRef.current.errorMessages,
            ),
          );
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmedValue, minQueryLength, debounceMs, disabled, retryToken, allowManual]);

  React.useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function select(option: ComboboxOption) {
    if (option.manual) {
      onManual?.(trimmedValue);
    } else {
      lastSelectionRef.current = option.label;
      onSelect(option);
    }
    setOpen(false);
    setActiveIndex(-1);
  }

  function retry() {
    setRetryToken((current) => current + 1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      setActiveIndex((current) => (current + 1 >= options.length ? 0 : current + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      setActiveIndex((current) => (current - 1 < 0 ? options.length - 1 : current - 1));
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
      setActiveIndex(options.length - 1);
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      const option = options[activeIndex];
      if (!option) return;
      event.preventDefault();
      select(option);
    }
  }

  const activeOption = open ? options[activeIndex] : undefined;
  const showListbox = open && trimmedValue.length > 0 && !disabled;
  const showManualRow = Boolean(manualOption);
  const showEmpty = status === "ready" && items.length === 0 && !showManualRow;

  function renderOptionRow(option: ComboboxOption, index: number) {
    return (
      <div
        key={option.id}
        id={`${listboxId}-${option.id}`}
        role="option"
        aria-selected={index === activeIndex}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => select(option)}
        className={`flex cursor-pointer items-start justify-between gap-3 rounded-control px-2.5 py-2 ${
          index === activeIndex ? "bg-surface-1 text-ink" : "text-body"
        } ${option.manual ? "mt-1 border-t border-hairline pt-2.5" : ""}`}
      >
        <span className="min-w-0">
          <span className={`block truncate text-sm ${option.manual ? "text-ink" : ""}`}>
            {option.label}
          </span>
          {option.description ? (
            <span className="mt-0.5 block truncate text-xs text-muted">
              {option.description}
            </span>
          ) : null}
        </span>
        {option.meta ? (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-stone">
            {option.meta}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone"
        />
        <Input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={showListbox}
          aria-controls={showListbox ? listboxId : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-activedescendant={activeOption ? `${listboxId}-${activeOption.id}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid ?? (invalid || undefined)}
          required={required}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={() => {
            if (trimmedValue.length >= minQueryLength) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="pl-9 pr-16"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {status === "loading" ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin text-stone" />
          ) : null}
          {value.length > 0 && onClear ? (
            <button
              type="button"
              aria-label={clearLabel}
              onClick={() => {
                onClear();
                setOpen(false);
                inputRef.current?.focus();
              }}
              className="flex size-6 items-center justify-center rounded-control text-stone transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {showListbox ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${label}建议`}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-hairline-strong bg-surface-2 p-1 shadow-2xl"
        >
          {status === "loading" ? (
            <div role="status" className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              {loadingLabel}
            </div>
          ) : null}

          {status === "error" ? (
            <div role="status" className="px-2.5 py-3">
              <p className="text-xs leading-5 text-accent-red">{errorMessage || errorLabel}</p>
              <Button type="button" variant="subtle" size="sm" className="mt-2" onClick={retry}>
                重试
              </Button>
            </div>
          ) : null}

          {status === "rate-limited" ? (
            <div role="status" className="px-2.5 py-3">
              <p className="text-xs leading-5 text-accent-orange">{errorMessage}</p>
              <Button type="button" variant="subtle" size="sm" className="mt-2" onClick={retry}>
                重试
              </Button>
            </div>
          ) : null}

          {status === "ready" && degraded ? (
            <p role="status" className="px-2.5 py-2 text-xs leading-5 text-accent-orange">
              {degradedLabel}
            </p>
          ) : null}

          {showEmpty ? (
            <p role="status" className="px-2.5 py-3 text-xs text-muted">
              {emptyLabel}
            </p>
          ) : null}

          {status === "ready"
            ? options.map((option, index) => renderOptionRow(option, index))
            : (status === "error" || status === "rate-limited") && manualOption
              ? renderOptionRow(manualOption, options.length - 1)
              : null}
        </div>
      ) : null}
    </div>
  );
}
