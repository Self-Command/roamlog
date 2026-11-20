import { describe, expect, it } from "vitest";

import { AiChatResponseSchema, AiRunIdSchema, AiStreamEventSchema } from "../api/ai";

/** What `newRunId()` returned before the fix: 32 hyphenless hex digits. */
const LEGACY_RUN_ID = "726d652afcfc877cf34f593a6ec94c59";
/** What `newRunId()` returns now: `generateUuidV7()`. */
const UUID_V7_RUN_ID = "0197e00d-0000-7000-8000-000000000001";
const RFC_V4_RUN_ID = "550e8400-e29b-41d4-a716-446655440000";

function chatResponse(runId: string): Record<string, unknown> {
  return {
    runId,
    message: "Here is my plan.",
    plannedCalls: [{ tool: "trips.create", args: { title: "Kyoto" } }],
    readOnlyTrace: [],
    usage: { inputTokens: 12, outputTokens: 3 },
    provider: { protocol: "openai-chat", model: "auto/deepseek-v4.1-flash" },
    expiresAt: "2026-11-19T14:00:00+08:00",
  };
}

describe("AiRunIdSchema", () => {
  it("accepts the legacy 32-hex run id already stored in Redis and echoed to clients", () => {
    expect(AiRunIdSchema.safeParse(LEGACY_RUN_ID).success).toBe(true);
  });

  it("accepts the RFC 4122 UUID newRunId() now mints", () => {
    expect(AiRunIdSchema.safeParse(UUID_V7_RUN_ID).success).toBe(true);
    expect(AiRunIdSchema.safeParse(RFC_V4_RUN_ID).success).toBe(true);
  });

  it("still rejects values neither writer could produce", () => {
    for (const value of [
      "",
      "abc",
      "0".repeat(31),
      "0".repeat(33),
      "0197e00d-0000-7000-8000-00000000000", // 8-4-4-4-11
      "0197e00d_0000_7000_8000_000000000001", // underscores
      "0197e00d-0000-7000-8000-00000000000g", // non-hex
    ]) {
      expect(AiRunIdSchema.safeParse(value).success).toBe(false);
    }
  });

  it("regression: an in-flight legacy plan still round-trips through the chat response", () => {
    expect(() => AiChatResponseSchema.parse(chatResponse(LEGACY_RUN_ID))).not.toThrow();
    expect(AiChatResponseSchema.parse(chatResponse(UUID_V7_RUN_ID)).runId).toBe(UUID_V7_RUN_ID);
  });

  it("regression: both run id shapes survive every SSE frame that carries one", () => {
    for (const runId of [LEGACY_RUN_ID, UUID_V7_RUN_ID]) {
      const parsed = AiStreamEventSchema.safeParse({
        type: "plan",
        runId,
        message: "Plan ready.",
        plannedCalls: [],
        readOnlyTrace: [],
        expiresAt: "2026-11-19T14:00:00+08:00",
      });

      expect(parsed.success).toBe(true);
    }
  });
});