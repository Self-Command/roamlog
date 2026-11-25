"use client";

/**
 * Reasoning disclosure ported from vercel/chatbot:
 * - `components/chat/message-reasoning.tsx` @ a8989b52 (Apache-2.0)
 * - `components/ai-elements/reasoning.tsx` @ a8989b52 (Apache-2.0)
 *
 * Adaptation layer:
 * - `@streamdown/*` and `streamdown` are not dependencies of apps/web, so the
 *   content body uses Roamlog's existing `markdown.tsx` renderer.
 * - shadcn/Radix Collapsible is replaced by the dependency-free collapsible in
 *   `tool-card-primitives.tsx` (same open/defaultOpen/onOpenChange contract).
 * - The auto-open / auto-close state machine, duration measurement and
 *   `hasBeenStreaming` logic are kept verbatim from upstream.
 */

import { ChevronDown } from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "./cn";
import { Markdown } from "./markdown";
import { Collapsible, CollapsibleTrigger } from "./tool-card-primitives";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from "./elements/chain-of-thought";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = (): ReasoningContextValue => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

function useControllableState<T>({
  prop,
  defaultProp,
  onChange,
}: {
  prop: T | undefined;
  defaultProp: T;
  onChange?: (value: T) => void;
}) {
  const [state, setState] = useState<T>(defaultProp);
  const value = prop === undefined ? state : prop;

  const setValue = useCallback(
    (next: T) => {
      if (prop === undefined) setState(next);
      onChange?.(next);
    },
    [prop, onChange],
  );

  return [value, setValue] as const;
}

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const resolvedDefaultOpen = defaultOpen ?? isStreaming;
    // Track if defaultOpen was explicitly set to false (to prevent auto-open).
    const isExplicitlyClosed = defaultOpen === false;

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: open,
    });
    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    });

    const hasEverStreamedRef = useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const startTimeRef = useRef<number | null>(null);

    // Track when streaming starts and compute duration.
    useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming, setDuration]);

    // Auto-open when streaming starts (unless explicitly closed).
    useEffect(() => {
      if (isStreaming && !isOpen && !isExplicitlyClosed) {
        setIsOpen(true);
      }
    }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

    // Auto-close when streaming ends (once only, and only if it ever streamed).
    useEffect(() => {
      if (hasEverStreamedRef.current && !isStreaming && isOpen && !hasAutoClosed) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        setIsOpen(newOpen);
      },
      [setIsOpen],
    );

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

Reasoning.displayName = "Reasoning";

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) {
    return <span className="animate-pulse font-medium">思考中…</span>;
  }
  if (duration === undefined) {
    return <span>思考了几秒</span>;
  }
  return <span>已思考 {duration} 秒</span>;
};

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 text-[13px] leading-[1.65] text-muted transition-colors hover:text-ink",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDown
              className={cn(
                "size-4 transition-transform motion-reduce:transition-none",
                isOpen ? "rotate-180" : "rotate-0",
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  },
);

ReasoningTrigger.displayName = "ReasoningTrigger";

export type ReasoningContentProps = HTMLAttributes<HTMLDivElement> & {
  children: string;
};

export const ReasoningContent = memo(({ className, children, ...props }: ReasoningContentProps) => {
  const { isStreaming, isOpen } = useReasoning();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [children, isStreaming]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "mt-2 text-[11px] leading-relaxed text-muted [overflow-anchor:none]",
        className,
      )}
      {...props}
    >
      <div
        className="max-h-[200px] overflow-y-auto rounded-card border border-hairline bg-surface-2 px-3 py-2"
        ref={scrollRef}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <Markdown text={children} />
      </div>
    </div>
  );
});

ReasoningContent.displayName = "ReasoningContent";

export type MessageReasoningProps = {
  isLoading: boolean;
  reasoning: string;
};

export function MessageReasoning({ isLoading, reasoning }: MessageReasoningProps) {
  // Reasoning is model-provided diagnostic copy, not the answer. Keep it
  // available but collapsed by default so a long English reasoning trace does
  // not dominate an enterprise conversation before the user asks for it.
  const [open, setOpen] = useState(false);
  const startRef = useRef<number | null>(isLoading ? Date.now() : null);
  const [duration, setDuration] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (isLoading) {
      startRef.current ??= Date.now();
      return;
    }
    if (startRef.current !== null) {
      setDuration(Math.max(1, Math.ceil((Date.now() - startRef.current) / 1000)));
      startRef.current = null;
    }
  }, [isLoading]);

  const languageNote = /[\u3400-\u9fff]/u.test(reasoning)
    ? "模型原始思考"
    : "模型原始思考（英文原文，未翻译）";

  return (
    <ChainOfThought open={open} onOpenChange={setOpen} data-testid="message-reasoning">
      <ChainOfThoughtHeader>
        {isLoading
          ? "模型原始思考（生成中）"
          : duration === undefined
            ? languageNote
            : `${languageNote} · 已思考 ${String(duration)} 秒`}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent aria-busy={isLoading}>
        <p className="px-1 text-[11px] leading-5 text-stone">
          以下是模型返回的原始思考，不是最终答案，也不会被翻译或改写。
        </p>
        <div className="max-h-[240px] overflow-y-auto rounded-card border border-hairline bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
          <Markdown text={reasoning} />
        </div>
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}
