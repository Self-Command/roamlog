import { webcrypto } from "node:crypto";

import { AI_REWRITE_MAX_INPUT_CHARS } from "@roamlog/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiRequestError } from "../api/ai";
import {
  selectionStillMatches,
  rewriteFailureMessage,
  rewriteSelection,
  streamRewrite,
  type RewriteSelectionInput,
} from "./rewrite";
import {
  hashSelection,
  rewriteBlockMessage,
  rewriteBlockReason,
  REWRITE_INSTRUCTION_LABELS,
} from "./selection";

const subtle = webcrypto.subtle;
const SELECTION = "早上从京都站坐车去岚山。";
const REWRITE = "清早自京都站出发前往岚山。";

function input(overrides: Partial<RewriteSelectionInput> = {}): RewriteSelectionInput {
  return {
    text: SELECTION,
    instruction: "improve",
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

  it("labels Novel's six options in Chinese", () => {
    expect(Object.keys(REWRITE_INSTRUCTION_LABELS)).toEqual([
      "improve",
      "fix",
      "shorter",
      "longer",
      "continue",
      "zap",
    ]);
    expect(REWRITE_INSTRUCTION_LABELS.improve).toBe("改善表达");
    expect(REWRITE_INSTRUCTION_LABELS.fix).toBe("修正语法");
    expect(REWRITE_INSTRUCTION_LABELS.shorter).toBe("更简短");
    expect(REWRITE_INSTRUCTION_LABELS.longer).toBe("更详细");
    expect(REWRITE_INSTRUCTION_LABELS.continue).toBe("接着往下写");
    expect(new Set(Object.values(REWRITE_INSTRUCTION_LABELS)).size).toBe(6);
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
      instruction: "improve",
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

describe("streamRewrite", () => {
  // A syntactically valid UUIDv7: the frozen `meta` frame still carries one.
  const CONVERSATION = "0193b1b0-7c3a-7d2e-8c4a-1b2c3d4e5f60";

  const meta = {
    type: "meta",
    v: 1,
    conversationId: CONVERSATION,
    userMessageId: "rewrite-0123456789abcdef",
    assistantMessageId: "rewrite-msg-1",
    provider: { protocol: "openai-chat", model: "auto/deepseek-v4.1-flash" },
  };

  /** Builds a Response whose body emits the frames one byte at a time. */
  function sseResponse(frames: unknown[]): Response {
    const encoder = new TextEncoder();
    const wire = frames
      .map((frame) => `event: ${(frame as { type: string }).type}\ndata: ${JSON.stringify(frame)}\n\n`)
      .join("");
    const bytes = encoder.encode(wire);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // One byte per chunk also exercises split multi-byte UTF-8 handling.
        for (let index = 0; index < bytes.length; index += 1) {
          controller.enqueue(bytes.slice(index, index + 1));
        }
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  async function collect(generator: AsyncGenerator<unknown>) {
    const events: Array<{ type: string; delta?: string }> = [];
    for await (const event of generator) {
      events.push(event as { type: string; delta?: string });
    }
    return events;
  }

  it("streams the deltas of the frozen v1 protocol and stops at done", async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      meta,
      { type: "text.delta", delta: "清早自" },
      { type: "text.delta", delta: "京都站出发前往岚山。" },
      { type: "usage", usage: { inputTokens: 41, outputTokens: 22 } },
      { type: "done", messageId: "rewrite-msg-1", finishReason: "stop" },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const events = await collect(streamRewrite("ws-1", input()));

    expect(events.map((event) => event.type)).toEqual([
      "meta",
      "text.delta",
      "text.delta",
      "usage",
      "done",
    ]);
    expect(events.filter((event) => event.type === "text.delta").map((event) => event.delta).join(""))
      .toBe(REWRITE);

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/v1/workspaces/ws-1/ai/rewrite/stream");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      text: SELECTION,
      instruction: "improve",
      selectionHash: "a".repeat(64),
    });
  });

  it("forwards `continue` context and `zap` commands on the wire", async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      meta,
      { type: "done", messageId: "rewrite-msg-1", finishReason: "stop" },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    await collect(streamRewrite("ws-1", {
      ...input(),
      instruction: "continue",
      contextBefore: "前一晚住在祇园。",
    }));
    await collect(streamRewrite("ws-1", {
      ...input(),
      instruction: "zap",
      command: "改成第二人称",
    }));

    const [, first] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, second] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(first.body))).toMatchObject({
      instruction: "continue",
      contextBefore: "前一晚住在祇园。",
    });
    expect(JSON.parse(String(second.body))).toMatchObject({
      instruction: "zap",
      command: "改成第二人称",
    });
  });

  it("maps a pre-flight quota failure to JSON instead of starting the stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, {
      type: "about:blank",
      title: "Too Many Requests",
      status: 429,
      code: "AI_QUOTA",
      instance: "/v1/workspaces/ws-1/ai/rewrite/stream",
    })));

    const error = await collect(streamRewrite("ws-1", input())).catch((cause) => cause);
    expect((error as AiRequestError).code).toBe("AI_QUOTA");
    expect(rewriteFailureMessage(error)).toBe("今天的 AI 额度已用完，请稍后再试");
  });

  it("refuses a frame that does not match the contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      meta,
      { type: "text.delta", delta: 42 },
    ])));

    const error = await collect(streamRewrite("ws-1", input())).catch((cause) => cause);
    expect((error as AiRequestError).code).toBe("INVALID_RESPONSE");
  });

  it("refuses a stream that ends without done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([meta, { type: "text.delta", delta: "半句" }])));

    const error = await collect(streamRewrite("ws-1", input())).catch((cause) => cause);
    expect((error as AiRequestError).code).toBe("INVALID_RESPONSE");
  });

  it("ends normally when the caller aborts, writing nothing", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([meta, { type: "text.delta", delta: "半句" }])));
    controller.abort();

    const events = await collect(streamRewrite("ws-1", input(), { signal: controller.signal }));
    expect(events).toEqual([]);
  });
});
