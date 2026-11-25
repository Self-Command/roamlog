"use client";

import {
  AI_DEFAULT_REASONING_EFFORT,
  AI_REASONING_EFFORTS,
  type AiReasoningEffort,
} from "@roamlog/contracts";
import { useEffect, useState } from "react";

let cachedDefault: AiReasoningEffort | null = null;
let inFlight: Promise<AiReasoningEffort> | null = null;

function asReasoningEffort(value: unknown): AiReasoningEffort | undefined {
  return typeof value === "string" &&
    (AI_REASONING_EFFORTS as readonly string[]).includes(value)
    ? (value as AiReasoningEffort)
    : undefined;
}

async function loadPlatformDefault(): Promise<AiReasoningEffort> {
  try {
    const response = await fetch("/v1/public/settings", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return AI_DEFAULT_REASONING_EFFORT;
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "settings" in body &&
      typeof body.settings === "object" &&
      body.settings !== null
    ) {
      const value = (body.settings as Record<string, unknown>)["ai.defaultReasoningEffort"];
      return asReasoningEffort(value) ?? AI_DEFAULT_REASONING_EFFORT;
    }
  } catch {
    // The settings endpoint is optional during a partial deployment.
  }
  return AI_DEFAULT_REASONING_EFFORT;
}

/**
 * The platform default is display-only. The server applies the same setting
 * when a request omits `reasoningEffort`, so the selector never lies about the
 * effective effort.
 */
export function useAiReasoningDefault(): AiReasoningEffort {
  const [value, setValue] = useState<AiReasoningEffort>(
    cachedDefault ?? AI_DEFAULT_REASONING_EFFORT,
  );

  useEffect(() => {
    if (cachedDefault !== null) return;
    inFlight ??= loadPlatformDefault().then((resolved) => {
      cachedDefault = resolved;
      inFlight = null;
      return resolved;
    });
    let active = true;
    void inFlight.then((resolved) => {
      if (active) setValue(resolved);
    });
    return () => {
      active = false;
    };
  }, []);

  return value;
}

/** Test hook: clear the module-level public-settings cache. */
export function resetAiReasoningDefaultForTests(): void {
  cachedDefault = null;
  inFlight = null;
}
