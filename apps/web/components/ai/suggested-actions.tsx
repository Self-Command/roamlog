"use client";

/**
 * Suggested actions ported from vercel/chatbot
 * `components/chat/suggested-actions.tsx` @ a8989b52 (Apache-2.0).
 *
 * Adaptation layer: the upstream `Suggestion` and `useChatHelpers.sendMessage`
 * are replaced by a button and an `onSelect` callback. Layout, responsive
 * horizontal/2-column behavior, stagger, hover motion and test id are kept.
 */

import { motion } from "framer-motion";

import { cn } from "./cn";

export const TRAVEL_SUGGESTIONS = [
  "想去京都一周，预算 8000，喜欢古寺和咖啡馆",
  "带爸妈去成都四天，节奏慢一点，少走路",
  "周末去杭州，预算 2000，想住湖边",
] as const;

export interface SuggestedActionsProps {
  suggestions?: readonly string[];
  onSelect: (suggestion: string) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}

export function SuggestedActions({
  suggestions = TRAVEL_SUGGESTIONS,
  onSelect,
  disabled = false,
  className,
}: SuggestedActionsProps) {
  return (
    <div
      className={cn(
        "flex w-full gap-2.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible",
        className,
      )}
      data-testid="suggested-actions"
      style={{
        msOverflowStyle: "none",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {suggestions.map((suggestion, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="min-w-[200px] shrink-0 sm:min-w-0 sm:shrink"
          exit={{ opacity: 0, y: 16 }}
          initial={{ opacity: 0, y: 16 }}
          key={suggestion}
          transition={{
            delay: 0.06 * index,
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <button
            className={cn(
              "h-auto w-full whitespace-nowrap rounded-card border border-hairline bg-surface-1 px-4 py-3 text-left text-[12px] leading-relaxed text-muted",
              "transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-2 hover:text-ink hover:shadow-lg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0",
              "motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:whitespace-normal sm:p-4 sm:text-[13px]",
              disabled && "pointer-events-none opacity-50",
            )}
            disabled={disabled}
            onClick={() => void onSelect(suggestion)}
            type="button"
          >
            {suggestion}
          </button>
        </motion.div>
      ))}
    </div>
  );
}
