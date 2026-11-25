"use client";

/**
 * Visual primitives for the AI tool card.
 *
 * Ported from vercel/chatbot `components/ai-elements/tool.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0), L25–L172.
 *
 * Deviations (all adaptation layer):
 * - `@/components/ui/collapsible` (Radix) is not a dependency of apps/web and
 *   this task may not add packages, so `Collapsible`/`CollapsibleTrigger`/
 *   `CollapsibleContent` below reproduce the small API surface the component
 *   tree uses (`open` / `defaultOpen` / `onOpenChange` / `data-state` /
 *   `aria-expanded`). The state machine is unchanged.
 * - shadcn tokens are remapped to Roamlog tokens: `border-border` →
 *   `border-hairline`, `bg-muted/50` → `bg-surface-2`, `text-muted-foreground`
 *   → `text-muted`, `rounded-md` → `rounded-card`, `bg-background` →
 *   `bg-surface-0`.
 * - The status labels are Chinese and live in `copy.ts` (i18n adaptation).
 */

import { Badge } from "@roamlog/ui";
import { CheckCircle, ChevronDown, Circle, Wrench, XCircle } from "lucide-react";
import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { cn } from "./cn";
import { CodeBlock } from "./code-block";
import { toolStatusLabel } from "./copy";

/* -------------------------------------------------------------------------- */
/* Collapsible (dependency-free stand-in for @radix-ui/react-collapsible)      */
/* -------------------------------------------------------------------------- */

interface CollapsibleContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null);

function useCollapsible(): CollapsibleContextValue {
  const value = useContext(CollapsibleContext);
  if (!value) {
    throw new Error("Collapsible components must be used within Collapsible");
  }
  return value;
}

export type CollapsibleProps = ComponentProps<"div"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function Collapsible({
  className,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const contentId = useId();
  const open = openProp ?? uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <CollapsibleContext.Provider value={{ open, setOpen, contentId }}>
      <div className={className} data-state={open ? "open" : "closed"} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

export type CollapsibleTriggerProps = ComponentProps<"button">;

export function CollapsibleTrigger({
  className,
  children,
  onClick,
  ...props
}: CollapsibleTriggerProps) {
  const { open, setOpen, contentId } = useCollapsible();

  return (
    <button
      type="button"
      aria-controls={contentId}
      aria-expanded={open}
      data-state={open ? "open" : "closed"}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export type CollapsibleContentProps = ComponentProps<"div">;

export function CollapsibleContent({ className, children, ...props }: CollapsibleContentProps) {
  const { open, contentId } = useCollapsible();
  if (!open) return null;

  return (
    <div id={contentId} data-state="open" className={className} {...props}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tool card                                                                  */
/* -------------------------------------------------------------------------- */

export type ToolCardState = "running" | "complete" | "error" | "cancelled" | "waiting";

export type ToolProps = CollapsibleProps;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "group not-prose mb-4 w-full min-w-0 overflow-hidden rounded-card border border-hairline bg-surface-1",
      className,
    )}
    {...props}
  />
);

/**
 * Pulses while one tool call is in flight.
 *
 * Upstream's running state is `<Badge>运行中</Badge>` with a pulsing clock
 * (`ai-elements/tool.tsx` L109–L118 `state === "input-available"` branch). The
 * task requires a visible pulse-dot indicator next to the live `progress.label`,
 * so the badge icon is the three-dot `dot-pulse` animation from
 * vercel/chatbot `app/globals.css` L287–L298 / L364–L366 (`@utility dot-pulse`),
 * applied to `roamlog-ai-dot` in `ai-motion.tsx`. The label text is unchanged so
 * the existing accessible name (`搜索地点 运行中`) stays stable.
 */
const RunningDots = () => (
  <span aria-hidden="true" className="flex items-end gap-0.5">
    <i className="roamlog-ai-dot" />
    <i className="roamlog-ai-dot" />
    <i className="roamlog-ai-dot" />
  </span>
);

const statusIcons: Record<ToolCardState, ReactNode> = {
  running: <RunningDots />,
  complete: <CheckCircle aria-hidden="true" className="size-3 text-accent-green" />,
  error: <XCircle aria-hidden="true" className="size-3 text-accent-red" />,
  cancelled: <XCircle aria-hidden="true" className="size-3 text-accent-slate" />,
  waiting: <Circle aria-hidden="true" className="size-3 text-accent-amber" />,
};

const statusTones: Record<
  ToolCardState,
  "neutral" | "blue" | "green" | "red" | "slate" | "yellow"
> = {
  running: "blue",
  complete: "green",
  error: "red",
  cancelled: "slate",
  waiting: "yellow",
};

export const getStatusBadge = (state: ToolCardState) => (
  <Badge tone={statusTones[state]} className="gap-1">
    {statusIcons[state]}
    {toolStatusLabel(state)}
  </Badge>
);

export type ToolHeaderProps = {
  title?: string;
  className?: string;
  /** Upstream's `type` prop is renamed: `type` on a <button> is the HTML type. */
  toolType?: string;
  state: ToolCardState;
  toolName?: string;
  durationMs?: number;
  progressLabel?: string;
} & ComponentProps<typeof CollapsibleTrigger>;

export const ToolHeader = ({
  className,
  title,
  toolType,
  state,
  toolName,
  durationMs,
  progressLabel,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    toolType === "dynamic-tool" ? toolName : (toolType?.split("-").slice(1).join("-") ?? toolName);
  const label = title ?? derivedName ?? "工具";

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-start justify-between gap-3 p-3 text-left outline-none transition-colors hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1",
        className,
      )}
      aria-label={`${label} ${toolStatusLabel(state)}`}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <Wrench aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 max-w-full truncate text-sm font-medium leading-6 text-ink">
          {label}
        </span>
        {getStatusBadge(state)}
        {durationMs !== undefined ? (
          <span data-testid="tool-duration" className="type-meta shrink-0 text-stone">
            {formatDuration(durationMs)}
          </span>
        ) : null}
        {progressLabel ? (
          <span className="min-w-0 max-w-full truncate type-meta text-muted">{progressLabel}</span>
        ) : null}
      </div>
      <ChevronDown
        aria-hidden="true"
        className="mt-1 size-4 shrink-0 text-muted transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
      />
    </CollapsibleTrigger>
  );
};

/** Matches the official assistant-ui ToolFallback duration format, in Chinese. */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "";
  if (durationMs < 1000) return "<1 秒";
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} 分 ${rest} 秒`;
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "space-y-4 border-t border-hairline p-4 text-body transition-[opacity,transform] duration-150 motion-reduce:transition-none",
      className,
    )}
    {...props}
  />
);

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
  /** Raw streamed JSON. It may be incomplete while the model is still writing. */
  rawText?: string;
  preferRaw?: boolean;
  /** Compact, product-language summary shown before the raw JSON. */
  summary?: ReactNode;
  /** True while the model is still producing the argument JSON. */
  streaming?: boolean;
};

export const ToolInput = ({
  className,
  input,
  rawText,
  preferRaw = false,
  summary,
  streaming = false,
  ...props
}: ToolInputProps) => {
  if (input === undefined && !rawText) return null;
  const code = preferRaw && rawText && rawText.length > 0 ? rawText : jsonText(input ?? {});

  return (
    <div className={cn("min-w-0 space-y-2 overflow-hidden", className)} {...props}>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted">参数</h4>
      {summary ? (
        <div
          className="min-w-0 rounded-control border border-hairline bg-surface-0/45 px-3 py-2"
          data-testid="tool-input-summary"
        >
          {summary}
        </div>
      ) : streaming ? (
        <p className="text-xs leading-5 text-muted" data-testid="tool-input-streaming">
          正在准备操作…
        </p>
      ) : null}
      <details className="group/raw min-w-0 rounded-control border border-hairline bg-surface-0/30">
        <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink [&::-webkit-details-marker]:hidden">
          查看原始参数
        </summary>
        <div className="min-w-0 overflow-hidden border-t border-hairline bg-surface-2">
          <CodeBlock code={code} language="json" />
        </div>
      </details>
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText?: string;
  /** Compact, product-language result summary shown before the raw JSON. */
  summary?: ReactNode;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  summary,
  ...props
}: ToolOutputProps) => {
  if (output === undefined && !errorText) return null;

  const isError = Boolean(errorText);

  return (
    <div className={cn("min-w-0 space-y-2", className)} {...props}>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
        {isError ? "错误" : "结果"}
      </h4>
      <div
        role={isError ? "alert" : undefined}
        className={cn(
          "min-w-0 rounded-card text-xs",
          isError && "bg-accent-red/10 text-accent-red",
        )}
      >
        {errorText ? (
          <div className="whitespace-pre-wrap break-words px-3 py-2">{errorText}</div>
        ) : null}
      </div>
      {summary && !isError ? (
        <div
          className="min-w-0 rounded-control border border-hairline bg-surface-0/45 px-3 py-2"
          data-testid="tool-output-summary"
        >
          {summary}
        </div>
      ) : null}
      {output !== undefined ? (
        <details className="min-w-0 rounded-control border border-hairline bg-surface-0/30">
          <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink [&::-webkit-details-marker]:hidden">
            查看原始结果
          </summary>
          <div className="min-w-0 overflow-x-auto border-t border-hairline">
            <CodeBlock code={jsonText(output)} language="json" />
          </div>
        </details>
      ) : null}
    </div>
  );
};
