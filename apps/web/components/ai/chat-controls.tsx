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
 * - `lib/ai/models.ts` L23 — the `reasoningEffort` value set
 *   (`"none" | "minimal" | "low" | "medium" | "high"`) and L26–L64 the per-model
 *   declaration of whether a model reasons at all.
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
 *    thinking-depth control, so this selector exposes *exactly* upstream's five
 *    values and nothing more; the label copy is Chinese (i18n adaptation) and the
 *    control is disabled when the served protocol has no such parameter
 *    (`AiChatModelsResponse.reasoningSupported`, i.e. Anthropic Messages).
 * 3. The list comes from `GET .../ai/models` (this API's allow-list) instead of
 *    the Vercel AI Gateway catalog.
 */

import type { AiReasoningEffort } from "@roamlog/contracts";
import { AI_REASONING_EFFORTS } from "@roamlog/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@roamlog/ui";
import { Brain, ChevronDown } from "lucide-react";

import { aiChatSelectionStore, useAiChatSelection } from "./chat-selection";
import { useAiChatModels } from "./model-selector";

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
};

export function ReasoningSelectorCompact({ workspaceId }: { workspaceId: string }) {
  const { models } = useAiChatModels(workspaceId);
  const selection = useAiChatSelection(workspaceId);
  const store = aiChatSelectionStore(workspaceId);
  const supported = models?.reasoningSupported ?? true;
  const currentLabel =
    selection.reasoningEffort === undefined ? "默认" : REASONING_LABELS[selection.reasoningEffort];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="选择思考深度"
          disabled={!supported}
          title={supported ? undefined : "当前网关协议不接收思考深度参数"}
          className="h-7 gap-1.5 px-2 text-xs font-normal text-muted"
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
          value={selection.reasoningEffort ?? "default"}
          onValueChange={(value) => {
            store.set({
              ...selection,
              ...(value === "default"
                ? { reasoningEffort: undefined }
                : { reasoningEffort: value as AiReasoningEffort }),
            });
          }}
        >
          <DropdownMenuRadioItem value="default" data-testid="reasoning-option-default">
            默认（由网关决定）
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {AI_REASONING_EFFORTS.map((effort) => (
            <DropdownMenuRadioItem
              key={effort}
              value={effort}
              data-testid={`reasoning-option-${effort}`}
            >
              {REASONING_LABELS[effort]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {supported ? null : (
          <p className="px-2.5 py-2 text-xs text-muted">
            当前协议（Anthropic Messages）没有思考深度字段，后端不会转发。
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
