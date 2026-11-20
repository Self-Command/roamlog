import { describe, expect, it } from "vitest";
import { z } from "zod";

import { newRunId } from "../ai-run.store.js";

/** PostgreSQL canonical output form: 8-4-4-4-12 lowercase hex. */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The exact RFC 4122 check the audit read path applies to `targetId`. */
const RFC_UUID = z.uuid();

describe("newRunId", () => {
  it("mints a value that z.uuid() accepts", () => {
    const runId = newRunId();

    expect(RFC_UUID.safeParse(runId).success).toBe(true);
    expect(runId).toMatch(CANONICAL_UUID);
    expect(runId).toHaveLength(36);
  });

  it("is a version 7 UUID with the RFC 4122 variant bits", () => {
    // The bug being fixed was a 32-hex string that PostgreSQL canonicalised
    // into a variant-`f` value; both nibbles are asserted so a regression in
    // `generateUuidV7` cannot reintroduce it silently.
    for (const runId of Array.from({ length: 25 }, () => newRunId())) {
      expect(runId[14]).toBe("7");
      expect("89ab").toContain(runId[19]);
    }
  });

  it("never repeats a run id", () => {
    const ids = Array.from({ length: 5_000 }, () => newRunId());

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("regression: no longer emits the 32-hyphenless-hex form that broke the uuid column", () => {
    // A 32-hex string has no 8-4-4-4-12 separators at all, which is why
    // PostgreSQL's `uuid` input rewrote it without fixing the variant nibble.
    for (const runId of Array.from({ length: 50 }, () => newRunId())) {
      expect(runId).not.toMatch(/^[0-9a-f]{32}$/u);
    }
  });
});