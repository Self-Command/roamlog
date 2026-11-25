import { AI_STREAM_DELTA_MAX_CHARS, AiStreamEventSchema } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import { serializeSseEvent, splitAiStreamEvent } from "../sse-frame.js";

describe("SSE frame delta cap", () => {
  it("splits oversized text deltas into protocol-valid events", () => {
    const text = "a".repeat(AI_STREAM_DELTA_MAX_CHARS + 10);
    const chunks = splitAiStreamEvent({ type: "text.delta", delta: text });

    expect(chunks).toHaveLength(2);
    expect(chunks.map((event) => (event.type === "text.delta" ? event.delta : "")).join("")).toBe(
      text,
    );
    for (const event of chunks) {
      expect(AiStreamEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("does not split a surrogate pair at the cap boundary", () => {
    const value = `${"a".repeat(AI_STREAM_DELTA_MAX_CHARS - 1)}😀b`;
    const chunks = splitAiStreamEvent({ type: "text.delta", delta: value });

    expect(chunks).toHaveLength(2);
    expect(chunks.map((event) => (event.type === "text.delta" ? event.delta : "")).join("")).toBe(
      value,
    );
    for (const event of chunks) {
      const delta = event.type === "text.delta" ? event.delta : "";
      expect(delta).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
      expect(delta).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    }
  });

  it("serializes split events with monotonically increasing ids", () => {
    const text = "a".repeat(AI_STREAM_DELTA_MAX_CHARS + 10);
    const serialized = serializeSseEvent({ type: "text.delta", delta: text }, 7);
    const frames = serialized.frame.trimEnd().split("\n\n");

    expect(serialized.nextSeq).toBe(9);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toContain("id: 000007");
    expect(frames[1]).toContain("id: 000008");
    const events = frames.map((frame) => JSON.parse(frame.split("\n")[2]!.slice(6)));
    for (const event of events) {
      expect(AiStreamEventSchema.safeParse(event).success).toBe(true);
    }
  });
});
