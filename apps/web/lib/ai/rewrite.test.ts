import { webcrypto } from "node:crypto";

import { AI_REWRITE_MAX_INPUT_CHARS } from "@roamlog/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiRequestError } from "../api/ai";
import {
  selectionStillMatches,
  rewriteFailureMessage,
  rewriteSelection,
  type RewriteSelectionInput,
} from "./rewrite";
import { describeSegments, isUnchanged, previewSegments, toDiffSegments } from "./rewrite-preview";
import {
  hashSelection,
  rewriteBlockMessage,
  rewriteBlockReason,
  REWRITE_INSTRUCTION_LABELS,
} from "./selection";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff } from "./diff";

const subtle = webcrypto.subtle;
const SELECTION = "早上从京都站坐车去岚山。";
const REWRITE = "清早自京都站出发前往岚山。";

function input(overrides: Partial<RewriteSelectionInput> = {}): RewriteSelectionInput {
  return {
    text: SELECTION,
    instruction: "polish",
    selectionHash: "a".repeat(64),
    ...overrides,
  };
}

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hashSelection", () => {
  it("matches the server's SHA-256 hex for the same bytes", async () => {
    expect(await hashSelection("abc", subtle)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await hashSelection("", subtle)).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes UTF-8, so CJK text matches Node's digest of the same string", async () => {
    const expected = webcrypto.subtle
      .digest("SHA-256", new TextEncoder().encode(SELECTION))
      .then((buffer) =>
        Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      );
    expect(await hashSelection(SELECTION, subtle)).toBe(await expected);
    expect(await hashSelection(SELECTION, subtle)).toHaveLength(64);
  });

  it("refuses to run without Web Crypto instead of silently skipping the check", async () => {
    await expect(hashSelection("abc", {} as never)).rejects.toThrow(/Web Crypto is unavailable/u);
  });
});

describe("selectionStillMatches", () => {
  it("is false once the selection changed under the preview", async () => {
    const hash = await hashSelection(SELECTION, subtle);
    expect(await selectionStillMatches(hash, SELECTION, subtle)).toBe(true);
    expect(await selectionStillMatches(hash, `${SELECTION}又加了一句。`, subtle)).toBe(false);
    // Whitespace is part of the selection: trimming would write over the wrong range.
    expect(await selectionStillMatches(hash, `${SELECTION} `, subtle)).toBe(false);
  });
});

describe("rewriteBlockReason", () => {
  const base = { text: SELECTION, readOnly: false, workspaceId: "ws-1" };

  it("enables the entry only for a non-empty, in-range, editable selection", () => {
    expect(rewriteBlockReason(base)).toBeNull();
    expect(rewriteBlockReason({ ...base, text: "   " })).toBe("empty");
    expect(rewriteBlockReason({ ...base, text: "字".repeat(AI_REWRITE_MAX_INPUT_CHARS + 1) })).toBe(
      "too_long",
    );
    expect(rewriteBlockReason({ ...base, readOnly: true })).toBe("read_only");
    expect(rewriteBlockReason({ ...base, workspaceId: null })).toBe("no_workspace");
  });

  it("explains every disabled state in Chinese instead of hiding the button", () => {
    expect(rewriteBlockMessage(null)).toBeNull();
    expect(rewriteBlockMessage("empty")).toContain("选中");
    expect(rewriteBlockMessage("too_long")).toContain(String(AI_REWRITE_MAX_INPUT_CHARS));
    expect(rewriteBlockMessage("read_only")).toContain("权限");
    expect(rewriteBlockMessage("no_workspace")).toBeTruthy();
  });

  it("labels all six instructions", () => {
    expect(Object.keys(REWRITE_INSTRUCTION_LABELS)).toEqual([
      "shorten",
      "expand",
      "polish",
      "tone_formal",
      "tone_casual",
      "fix_grammar",
    ]);
    expect(new Set(Object.values(REWRITE_INSTRUCTION_LABELS)).size).toBe(6);
  });
});

describe("previewSegments", () => {
  it("marks only the characters that actually changed", () => {
    const segments = previewSegments("The cat sat.", "The dog sat.");

    expect(segments.find((segment) => segment.kind === "delete")?.text).toBe("cat");
    expect(segments.find((segment) => segment.kind === "insert")?.text).toBe("dog");
    expect(segments[0]).toEqual({ kind: "equal", text: "The " });
    expect(segments[segments.length - 1]).toEqual({ kind: "equal", text: " sat." });
  });

  it("returns a single equal segment for an unchanged rewrite", () => {
    expect(previewSegments(SELECTION, SELECTION)).toEqual([{ kind: "equal", text: SELECTION }]);
    expect(isUnchanged(SELECTION, SELECTION)).toBe(true);
    expect(isUnchanged(SELECTION, REWRITE)).toBe(false);
  });

  it("keeps CJK and emoji whole across edit boundaries", () => {
    const original = "去岚山看竹🎋林，然后回酒店。";
    const replacement = "去岚山看竹🎋林，然后回旅馆。";
    const segments = previewSegments(original, replacement);

    // Reconstructing both sides must be lossless, including the surrogate pair.
    const deleted = segments.filter((s) => s.kind !== "insert").map((s) => s.text).join("");
    const inserted = segments.filter((s) => s.kind !== "delete").map((s) => s.text).join("");
    expect(deleted).toBe(original);
    expect(inserted).toBe(replacement);
    for (const segment of segments) {
      expect(segment.text).not.toContain("\uFFFD");
    }
  });

  it("merges adjacent same-kind segments and skips empty text", () => {
    expect(
      toDiffSegments([
        [DIFF_EQUAL, "a"],
        [DIFF_EQUAL, "b"],
        [DIFF_DELETE, ""],
        [DIFF_DELETE, "c"],
        [DIFF_INSERT, "d"],
      ]),
    ).toEqual([
      { kind: "equal", text: "ab" },
      { kind: "delete", text: "c" },
      { kind: "insert", text: "d" },
    ]);
  });

  it("stays within a linear pass for a full-paragraph rewrite", () => {
    const original = "地".repeat(2_000);
    const replacement = "山".repeat(2_000);
    const started = Date.now();
    const segments = previewSegments(original, replacement);
    expect(Date.now() - started).toBeLessThan(500);
    expect(segments).toEqual([
      { kind: "delete", text: original },
      { kind: "insert", text: replacement },
    ]);
  });

  it("describes the change in words for screen readers", () => {
    const text = describeSegments([
      { kind: "equal", text: "The " },
      { kind: "delete", text: "cat" },
      { kind: "insert", text: "dog" },
      { kind: "equal", text: " sat." },
    ]);
    expect(text).toBe("删除「cat」；新增「dog」");
    expect(describeSegments([{ kind: "equal", text: "same" }])).toBe("");
  });
});

describe("diff", () => {
  it("returns no tuples for two empty strings and one equality for identical text", () => {
    expect(diff("", "")).toEqual([]);
    expect(diff("abc", "abc")).toEqual([[DIFF_EQUAL, "abc"]]);
  });
});

describe("rewriteSelection", () => {
  it("posts the selection and parses the contract response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      replacement: REWRITE,
      selectionHash: await hashSelection(SELECTION, subtle),
      model: "auto/deepseek-v4.1-flash",
      usage: { inputTokens: 41, outputTokens: 22 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const hash = await hashSelection(SELECTION, subtle);
    const result = await rewriteSelection("ws-1", input({ selectionHash: hash }));

    expect(result.replacement).toBe(REWRITE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/v1/workspaces/ws-1/ai/rewrite");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      text: SELECTION,
      instruction: "polish",
      selectionHash: hash,
    });
  });

  it("maps a stale-hash rejection to the fixed retry copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse(422, {
        type: "about:blank",
        title: "Unprocessable Entity",
        status: 422,
        code: "AI_SELECTION_HASH_MISMATCH",
        instance: "/v1/workspaces/ws-1/ai/rewrite",
      }),
    ));

    const error = await rewriteSelection("ws-1", input()).catch((cause) => cause);
    expect(error).toBeInstanceOf(AiRequestError);
    expect((error as AiRequestError).code).toBe("AI_SELECTION_HASH_MISMATCH");
    expect(rewriteFailureMessage(error)).toBe("原文已变化，请重试");
  });

  it("maps a quota rejection to retry-later copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse(429, {
        type: "about:blank",
        title: "Too Many Requests",
        status: 429,
        code: "AI_QUOTA",
        instance: "/v1/workspaces/ws-1/ai/rewrite",
      }),
    ));

    const error = await rewriteSelection("ws-1", input()).catch((cause) => cause);
    expect(rewriteFailureMessage(error)).toBe("今天的 AI 额度已用完，请稍后再试");
  });

  it("rejects a body that does not match the contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { replacement: REWRITE })));

    const error = await rewriteSelection("ws-1", input()).catch((cause) => cause);
    expect(error).toBeInstanceOf(AiRequestError);
    expect((error as AiRequestError).code).toBe("INVALID_RESPONSE");
  });

  it("reports a network failure as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    const error = await rewriteSelection("ws-1", input()).catch((cause) => cause);
    expect((error as AiRequestError).kind).toBe("network");
    expect(rewriteFailureMessage(error)).toBe("网络不可用，请检查连接后重试");
  });
});
