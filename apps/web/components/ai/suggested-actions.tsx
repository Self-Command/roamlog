"use client";

/**
 * Suggested actions ported from vercel/chatbot
 * `components/chat/suggested-actions.tsx` @ a8989b52 (Apache-2.0).
 *
 * Adaptation layer: the upstream `Suggestion` and `useChatHelpers.sendMessage`
 * are replaced by a button and an `onSelect` callback. The product renders the
 * list inside the empty thread instead of above the composer, so the cards use
 * a one-column mobile / two-column desktop grid. The cards render immediately
 * (no initial opacity animation) so every option is visible on first paint.
 */

import { Sparkles } from "lucide-react";

import { AI_DEFAULT_SUGGESTED_PROMPTS } from "@roamlog/contracts";
import { cn } from "./cn";

/** Kept as a named export for the existing empty-state tests. */
export const GENERIC_SUGGESTIONS = AI_DEFAULT_SUGGESTED_PROMPTS;

export interface SuggestedActionsProps {
  suggestions?: readonly string[];
  onSelect: (suggestion: string) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}

export function SuggestedActions({
  suggestions = GENERIC_SUGGESTIONS,
  onSelect,
  disabled = false,
  className,
}: SuggestedActionsProps) {
  return (
    <div
      className={cn(
        "grid w-full grid-cols-1 gap-2 sm:grid-cols-2",
        className,
      )}
      data-testid="suggested-actions"
    >
      {suggestions.map((suggestion) => (
        <div className="min-w-0" key={suggestion}>
          <button
            className={cn(
              "group flex h-auto min-h-12 w-full items-center gap-3 whitespace-normal rounded-card border border-hairline-strong bg-surface-1 px-3 py-3 text-left text-[13px] leading-relaxed text-body",
              "transition-colors duration-150 hover:border-accent-blue/50 hover:bg-surface-2 hover:text-ink focus-visible:border-accent-blue",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0",
              "motion-reduce:transition-none sm:px-4 sm:py-3",
              disabled && "pointer-events-none opacity-50",
            )}
            disabled={disabled}
            onClick={() => void onSelect(suggestion)}
            type="button"
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-control border border-hairline bg-accent-blue/10 text-accent-blue transition-colors group-hover:border-accent-blue/40 group-hover:bg-accent-blue/15"
            >
              <Sparkles className="size-4" />
            </span>
            <span className="min-w-0 flex-1">{suggestion}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
