import { describe, expect, it } from "vitest";

import {
  reasoningCapabilitiesForModel,
  reasoningEffortsForModel,
} from "./ai-model-capabilities.js";

describe("AI model reasoning capabilities", () => {
  it("reads exact models.dev tiers and preserves xhigh/max", () => {
    expect(reasoningEffortsForModel({ modelId: "openai/gpt-5.6-sol" })).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("resolves ambiguous gateway aliases from the observed catalog signatures", () => {
    expect(reasoningEffortsForModel({ modelId: "deepseek-v4.1-flash" })).toEqual([
      "none",
      "low",
      "high",
      "max",
    ]);
    expect(reasoningEffortsForModel({ modelId: "auto/deepseek-v4.1-flash" })).toEqual([
      "none",
      "low",
      "high",
      "max",
    ]);
    expect(reasoningEffortsForModel({ modelId: "auto/openai/gpt-5.6-sol" })).toContain(
      "max",
    );
  });

  it("never invents tiers for unknown models or protocols without effort", () => {
    expect(reasoningEffortsForModel({ modelId: "totally-unknown-model-xyz" })).toEqual([]);
    expect(
      reasoningEffortsForModel({ modelId: "claude-opus-5", protocol: "anthropic-messages" }),
    ).toEqual([]);
  });

  it("persists the capability snapshot on discovered models", () => {
    expect(reasoningCapabilitiesForModel({ modelId: "openai/gpt-5.6-sol" })).toMatchObject({
      reasoning: true,
      reasoningEfforts: expect.arrayContaining(["high", "max"]),
    });
    expect(reasoningCapabilitiesForModel({ modelId: "totally-unknown-model-xyz" })).toEqual({
      reasoning: false,
    });
  });
});
