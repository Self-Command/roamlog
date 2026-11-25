"use client";

import {
  AI_DEFAULT_SUGGESTED_PROMPTS,
  AiSuggestedPromptsSchema,
  PublicSettingsResponseSchema,
  type AiSuggestedPrompts,
} from "@roamlog/contracts";
import { useEffect, useState } from "react";

export const AI_SUGGESTED_PROMPTS_KEY = "ai.suggestedPrompts";

/**
 * The public setting is operator-editable JSON. A malformed value must never
 * take the empty state down, so invalid/missing data falls back to the same
 * code defaults the API ships.
 */
export function readSuggestedPrompts(value: unknown): AiSuggestedPrompts {
  const parsed = AiSuggestedPromptsSchema.safeParse(value);
  return parsed.success ? parsed.data : [...AI_DEFAULT_SUGGESTED_PROMPTS];
}

async function loadSuggestedPrompts(fetcher: typeof fetch): Promise<AiSuggestedPrompts> {
  try {
    const response = await fetcher("/v1/public/settings", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return [...AI_DEFAULT_SUGGESTED_PROMPTS];
    const parsed = PublicSettingsResponseSchema.safeParse(await response.json());
    return parsed.success
      ? readSuggestedPrompts(parsed.data.settings[AI_SUGGESTED_PROMPTS_KEY])
      : [...AI_DEFAULT_SUGGESTED_PROMPTS];
  } catch {
    return [...AI_DEFAULT_SUGGESTED_PROMPTS];
  }
}

export function useAiSuggestedPrompts(options?: {
  enabled?: boolean;
  fetcher?: typeof fetch;
}): AiSuggestedPrompts {
  const enabled = options?.enabled ?? true;
  const fetcher = options?.fetcher;
  const [prompts, setPrompts] = useState<AiSuggestedPrompts>(() => [
    ...AI_DEFAULT_SUGGESTED_PROMPTS,
  ]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadSuggestedPrompts(fetcher ?? fetch).then((next) => {
      if (!cancelled) setPrompts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, fetcher]);

  return prompts;
}
