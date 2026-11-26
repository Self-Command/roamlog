"use client";

/**
 * Model selector + reasoning-depth selector for the chat composer.
 *
 * Porting source: vercel/chatbot
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0)
 * - `components/ai-elements/model-selector.tsx` L21–L213 — the popover/listbox
 *   primitives (`ModelSelector`, `ModelSelectorTrigger`, `ModelSelectorContent`,
 *   `ModelSelectorItem`, `ModelSelectorName`).
 * - `components/chat/multimodal-input.tsx` L786–L913 — `PureModelSelectorCompact`:
 *   fetch the model list (`/api/models`), remember the selected id, render the
 *   current name in a ghost trigger and one radio row per model.
 * - `lib/ai/models.ts` L23 — the original upstream effort vocabulary; the
 *   runtime now extends it with `xhigh`/`max` from the models.dev capability
 *   snapshot, and each model exposes only the subset it actually supports.
 *
 * Adaptation layer:
 * 1. `@radix-ui/react-popover` + `cmdk` (upstream `Command`) are not wired in
 *    this app's design system; the repo's own `DropdownMenu` radio group is the
 *    single-select list primitive available, so the popover becomes a dropdown.
 *    Selection semantics (one value, current value shown, list of options) are
 *    unchanged.
 * 2. Upstream has **no user-facing reasoning-depth control**: `reasoningEffort`
 *    is a per-model constant (L23, L47/L55) forwarded by the route at
 *    `app/(chat)/api/chat/route.ts` L301–L302. The task requires a visible
 *    thinking-depth control, so this selector exposes the selected model's
 *    declared tiers (never the global vocabulary); the label copy is Chinese
 *    (i18n adaptation) and the control is disabled when the selected model has
 *    no effort parameter (for example Anthropic Messages today).
 * 3. The list comes from `GET .../ai/models` (this API's allow-list) instead of
 *    the Vercel AI Gateway catalog.
 */

import type { AiReasoningEffort } from "@roamlog/contracts";
import {
  AI_DEFAULT_REASONING_EFFORT,
  resolveReasoningEffort,
} from "@roamlog/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@roamlog/ui";
import { Brain, ChevronDown } from "lucide-react";
import { useEffect } from "react";

import { aiChatSelectionStore, useAiChatSelection } from "./chat-selection";
import { useAiChatModels } from "./model-selector";
import { useAiReasoningDefault } from "./use-ai-reasoning";

export { ModelSelectorCompact, useAiChatModels } from "./model-selector";

/**
 * i18n for upstream's five values. The *values* are the contract's (which are
 * upstream's); only the human labels are translated.
 */
const REASONING_LABELS: Record<AiReasoningEffort, string> = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};

export function ReasoningSelectorCompact({ workspaceId }: { workspaceId: string }) {
  const { models } = useAiChatModels(workspaceId);
  const selection = useAiChatSelection(workspaceId);
  const store = aiChatSelectionStore(workspaceId);
  const platformDefault = useAiReasoningDefault();
  const currentModel =
    models?.models.find((model) => model.id === (selection.model ?? models.defaultModel)) ??
    models?.models[0];
  const supportedEfforts = currentModel?.reasoningEfforts ?? [];
  const hasReasoning = supportedEfforts.length > 0;
  const resolvedEffort = resolveReasoningEffort(
    selection.reasoningEffort ?? platformDefault,
    supportedEfforts,
    platformDefault,
  );
  const currentEffort = resolvedEffort ?? AI_DEFAULT_REASONING_EFFORT;
  const currentLabel = hasReasoning ? REASONING_LABELS[currentEffort] : "不可用";

  useEffect(() => {
    if (!currentModel || selection.reasoningEffort === undefined) return;
    if (resolvedEffort === undefined) {
      store.set({ ...selection, reasoningEffort: undefined });
      return;
    }
    if (!supportedEfforts.includes(selection.reasoningEffort)) {
      store.set({ ...selection, reasoningEffort: resolvedEffort });
    }
  }, [currentModel, resolvedEffort, selection, store, supportedEfforts]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="选择思考深度"
          disabled={!hasReasoning}
          title={
            models === null
              ? "正在加载模型能力"
              : hasReasoning
                ? undefined
                : "当前模型不支持调整思考强度"
          }
          className="h-7 min-w-0 shrink gap-1.5 px-2 text-xs font-normal text-muted"
          data-testid="reasoning-selector"
        >
          <Brain aria-hidden="true" className="size-3.5" />
          <span className="truncate" data-testid="reasoning-selector-current">
            {currentLabel}
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel className="type-meta px-2.5 py-1 text-stone">思考深度</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={currentEffort}
          onValueChange={(value) => {
            store.set({
              ...selection,
              reasoningEffort: value as AiReasoningEffort,
            });
          }}
        >
          {supportedEfforts.map((effort) => (
            <DropdownMenuRadioItem
              key={effort}
              value={effort}
              data-testid={`reasoning-option-${effort}`}
            >
              {REASONING_LABELS[effort]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {hasReasoning ? null : (
          <p className="px-2.5 py-2 text-xs text-muted">
            当前模型不支持调整思考强度。
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
