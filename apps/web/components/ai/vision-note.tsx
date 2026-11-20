"use client";

/**
 * "This model cannot read images" disclosure for the composer.
 *
 * Why a note instead of a disabled attachment button: an attached photo is
 * still useful without vision — it is uploaded to the workspace media store and
 * kept on the sent message (the backend stores the image parts and the thread
 * renders the thumbnail after a reload, see
 * `apps/api/src/modules/ai/ai-plan.service.ts` `userTurnParts`). Disabling the
 * control would silently remove that archiving path, and the product must not
 * decide for the user that a photo has no value. What the user must never get
 * is the model's "I can't see this photo" reply treated as a normal answer, so
 * the composer states the limitation *before* the send.
 *
 * `vision` is the API's declared capability (`GET .../ai/models`, operator
 * opt-in via `AI_VISION_SUPPORTED`, default `false`); it is never inferred from
 * the gateway catalog. Until the list has loaded nothing is claimed: an
 * unknown capability must not be presented as either yes or no.
 *
 * Upstream reference for the declared-capability model: vercel/chatbot
 * `lib/ai/models.ts` L17–L24 declares `vision` per curated model rather than
 * reading provider metadata; this note is the composer-side consequence of
 * that same rule (the i18n copy is the adaptation layer).
 */

import type { AiChatModel } from "@roamlog/contracts";

import { useAiChatModels } from "./chat-controls";
import { useAiChatSelection } from "./chat-selection";

/** The copy the composer and the attachment button share. */
export const VISION_UNAVAILABLE_NOTE =
  "当前模型无法识别图片：图片只会作为附件保存在会话里，不会发送给模型。";

/**
 * The model the next turn will actually use.
 *
 * Mirrors the request-side resolution in `chat-model-adapter.ts`
 * (`selection.model ?? server default`), so the note describes the same model
 * the message is sent to, not a stale mount-time value.
 */
export function useCurrentChatModel(workspaceId: string): AiChatModel | null {
  const { models } = useAiChatModels(workspaceId);
  const selection = useAiChatSelection(workspaceId);
  if (!models) return null;
  const id = selection.model ?? models.defaultModel;
  return models.models.find((model) => model.id === id) ?? models.models[0] ?? null;
}

/** Renders the limitation only when the model is known and cannot see images. */
export function VisionNote({ model }: { model: AiChatModel | null | undefined }) {
  if (!model || model.vision) return null;
  return (
    <p
      className="basis-full px-2 text-[11px] leading-5 text-stone"
      data-testid="vision-note"
      role="note"
    >
      {VISION_UNAVAILABLE_NOTE}
    </p>
  );
}