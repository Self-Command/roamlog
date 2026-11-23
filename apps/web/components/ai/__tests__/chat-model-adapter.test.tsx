import type { AiStreamEvent } from "@roamlog/contracts";
import type { ChatModelRunResult } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { streamAiPlan } from "@/lib/api/ai";

import { PLAN_TOOL_NAME, createAiChatModelAdapter } from "../chat-model-adapter";

/**
 * Streaming branch coverage for the assistant-ui adapter.
 *
 * The old blocking adapter tests live one directory up; these tests drive the
 * real `streamAiPlan` through a mocked `fetch` so the HTTP body, SSE framing and
 * `ChatModelRunResult` snapshots are exercised end-to-end.
 */

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";
const CONVERSATION_ID = "018f0a00-0000-7000-8000-0000000000cc";
const RUN_ID = "0123456789abcdef0123456789abcdef";

const encoder = new TextEncoder();
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sseFrame(event: AiStreamEvent, id: number): string {
  return `id: ${String(id).padStart(6, "0")}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function metaEvent(streamId?: string): AiStreamEvent {
  return {
    type: "meta",
    v: 1,
    conversationId: CONVERSATION_ID,
    userMessageId: "u1",
    assistantMessageId: "a1",
    ...(streamId ? { streamId } : {}),
    provider: { protocol: "openai-chat", model: "auto/test" },
  };
}

function erroringResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      setTimeout(() => controller.error(new Error("network dropped")), 0);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function streamResponse(chunks: Uint8Array[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function responseFrom(text: string, status = 200): Response {
  return streamResponse([encoder.encode(text)], status);
}

async function collectStream(
  events: AsyncGenerator<AiStreamEvent, void, void>,
): Promise<AiStreamEvent[]> {
  const collected: AiStreamEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

interface PartLike {
  type: string;
  text?: string;
  toolName?: string;
  args?: { plan?: { plannedCalls?: unknown[] } };
}

async function collectAdapter(
  messages: readonly unknown[],
  threadId?: string,
  assistantMessageId?: string,
): Promise<ChatModelRunResult[]> {
  const adapter = createAiChatModelAdapter({ workspaceId: WORKSPACE_ID, canWrite: true });
  const stream = adapter.run({
    messages,
    abortSignal: new AbortController().signal,
    ...(threadId ? { unstable_threadId: threadId } : {}),
    ...(assistantMessageId ? { unstable_assistantMessageId: assistantMessageId } : {}),
  } as never) as AsyncGenerator<ChatModelRunResult, void, void>;

  const chunks: ChatModelRunResult[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function textOf(chunk: ChatModelRunResult | undefined): string {
  if (!chunk?.content) return "";
  return (chunk.content as readonly PartLike[])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

const USER_MESSAGE = {
  role: "user",
  id: "u1",
  createdAt: new Date(),
  content: [{ type: "text", text: "去京都玩三天" }],
};

const PLAN_CALL = {
  tool: "trips.create" as const,
  args: {
    title: "京都三日",
    startDate: "2027-04-01",
    endDate: "2027-04-03",
    visibility: "private",
  },
};

describe("streamAiPlan SSE parsing", () => {
  it("frames events, ignores comment heartbeats and decodes Chinese split across chunks", async () => {
    const body = [
      ": ok\n\n",
      ": hb 2026-11-20T00:00:00.000Z\n\n",
      sseFrame(metaEvent(), 1),
      sseFrame({ type: "text.delta", delta: "京都的" }, 2),
      ": hb 2026-11-20T00:00:01.000Z\n\n",
      sseFrame({ type: "text.delta", delta: "古寺" }, 3),
      sseFrame({ type: "done", messageId: "a1", finishReason: "stop" }, 4),
    ].join("");

    // Five bytes per chunk deliberately slices multi-byte UTF-8 characters.
    const bytes = encoder.encode(body);
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.length; offset += 5) {
      chunks.push(bytes.slice(offset, offset + 5));
    }
    fetchMock.mockResolvedValue(streamResponse(chunks));

    const events = await collectStream(streamAiPlan(WORKSPACE_ID, { message: "去京都" }));

    expect(events.map((event) => event.type)).toEqual(["meta", "text.delta", "text.delta", "done"]);
    expect(events[1]).toEqual({ type: "text.delta", delta: "京都的" });
    expect(events[2]).toEqual({ type: "text.delta", delta: "古寺" });
  });

  it("rejects a frame that does not match the frozen contract instead of dropping it", async () => {
    const body = [
      sseFrame(metaEvent(), 1),
      `id: 000002\nevent: text.delta\ndata: ${JSON.stringify({ type: "text.delta" })}\n\n`,
    ].join("");
    fetchMock.mockResolvedValue(responseFrom(body));

    const stream = streamAiPlan(WORKSPACE_ID, { message: "去京都" });

    // The first frame is valid; the malformed second one must throw rather
    // than being skipped so a client never waits forever for a missing plan.
    await expect(stream.next()).resolves.toMatchObject({ value: { type: "meta" } });
    await expect(stream.next()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: expect.stringContaining("frame 2"),
    });
  });

  it("throws a readable error for a non-2xx response before parsing any SSE frame", async () => {
    const problem = {
      type: "https://roamlog.app/errors/ai-not-configured",
      title: "Service Unavailable",
      status: 503,
      detail: "AI is not configured",
      code: "AI_NOT_CONFIGURED",
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(problem), {
        status: 503,
        headers: { "content-type": "application/problem+json" },
      }),
    );

    const stream = streamAiPlan(WORKSPACE_ID, { message: "去京都" });

    await expect(stream.next()).rejects.toMatchObject({
      status: 503,
      code: "AI_NOT_CONFIGURED",
      message: "AI is not configured",
      kind: "not_configured",
    });
  });

  it("aborts the fetch signal and ends the generator normally", async () => {
    let capturedSignal: AbortSignal | undefined;
    // This stream never produces data until the abort listener cancels it.
    const body = new ReadableStream<Uint8Array>({ start() {} });

    fetchMock.mockImplementation((_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    });

    const abort = new AbortController();
    const generator = streamAiPlan(WORKSPACE_ID, { message: "去京都" }, abort.signal);
    const first = generator.next();

    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    abort.abort();

    await expect(first).resolves.toEqual({ done: true, value: undefined });
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe("chat model adapter streaming", () => {
  it("resumes the same message after a dropped body and de-duplicates replayed events", async () => {
    const streamId = "018f0a00-0000-7000-8000-0000000000dd";
    fetchMock
      .mockResolvedValueOnce(
        erroringResponse([
          sseFrame(metaEvent(streamId), 1),
          sseFrame({ type: "text.delta", delta: "你" }, 2),
        ]),
      )
      .mockResolvedValueOnce(
        responseFrom(
          [
            sseFrame(metaEvent(streamId), 1),
            sseFrame({ type: "text.delta", delta: "你" }, 2),
            sseFrame({ type: "text.delta", delta: "好" }, 3),
            sseFrame({ type: "done", messageId: "a1", finishReason: "stop" }, 4),
          ].join(""),
        ),
      );

    const chunks = await collectAdapter([USER_MESSAGE], CONVERSATION_ID, "a1");

    expect(textOf(chunks[chunks.length - 1])).toBe("你好");
    expect(chunks.some((chunk) => chunk.status?.type === "incomplete")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `/ai/conversations/${CONVERSATION_ID}/stream?assistantMessageId=`,
    );
  });

  it("yields one snapshot per text.delta and keeps the accumulated text", async () => {
    const body = [
      sseFrame(metaEvent(), 1),
      sseFrame({ type: "text.delta", delta: "创建" }, 2),
      sseFrame({ type: "text.delta", delta: "京都" }, 3),
      sseFrame({ type: "text.delta", delta: "行程" }, 4),
      sseFrame({ type: "usage", usage: { inputTokens: 10, outputTokens: 5 } }, 5),
      sseFrame({ type: "done", messageId: "a1", finishReason: "stop" }, 6),
    ].join("");
    fetchMock.mockResolvedValue(responseFrom(body));

    const chunks = await collectAdapter([USER_MESSAGE]);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => textOf(chunk))).toEqual(["创建", "创建京都", "创建京都行程"]);
    expect(textOf(chunks[chunks.length - 1])).toBe("创建京都行程");
  });

  it("keeps progress visible after a text.delta and clears it on done", async () => {
    const body = [
      sseFrame(metaEvent(), 1),
      sseFrame({ type: "text.delta", delta: "京都的" }, 2),
      sseFrame({ type: "progress", stage: "searching", label: "正在查询地点（1/2）" }, 3),
      sseFrame({ type: "text.delta", delta: "古寺" }, 4),
      sseFrame({ type: "progress", stage: "reading", label: "正在读取行程…" }, 5),
      sseFrame({ type: "done", messageId: "a1", finishReason: "stop" }, 6),
    ].join("");
    fetchMock.mockResolvedValue(responseFrom(body));

    const chunks = await collectAdapter([USER_MESSAGE]);

    // The preamble is not replaced: the progress snapshot still carries it.
    expect(textOf(chunks[0])).toBe("京都的");
    expect(chunks[0]?.metadata?.custom?.progress).toBeUndefined();
    expect(chunks[1]?.metadata?.custom?.progress).toEqual({
      type: "progress",
      stage: "searching",
      label: "正在查询地点（1/2）",
    });
    expect(textOf(chunks[1])).toBe("京都的");

    // More text arrives while the tool round continues; progress survives.
    expect(textOf(chunks[2])).toBe("京都的古寺");
    expect(chunks[3]?.metadata?.custom?.progress).toEqual({
      type: "progress",
      stage: "reading",
      label: "正在读取行程…",
    });
    expect(textOf(chunks[3])).toBe("京都的古寺");

    // `done` clears the status line and keeps the answer text intact.
    expect(chunks).toHaveLength(5);
    expect(chunks[4]?.status).toEqual({ type: "complete", reason: "stop" });
    expect(chunks[4]?.metadata?.custom?.progress).toBeUndefined();
    expect(textOf(chunks[4])).toBe("京都的古寺");
    expect(textOf(chunks[4])).not.toContain("正在");
  });

  it("shows a readable error and never a success state when error is followed by done(error)", async () => {
    const body = [
      sseFrame(metaEvent(), 1),
      sseFrame(
        {
          type: "error",
          code: "AI_UPSTREAM",
          message: "The model gateway failed.",
          retryable: true,
        },
        2,
      ),
      sseFrame({ type: "done", messageId: "a1", finishReason: "error" }, 3),
    ].join("");
    fetchMock.mockResolvedValue(responseFrom(body));

    const chunks = await collectAdapter([USER_MESSAGE]);
    const final = chunks[chunks.length - 1];

    expect(final?.status).toEqual({ type: "incomplete", reason: "error" });
    expect(textOf(final)).toContain("模型服务暂时不可用");
    expect(textOf(final)).not.toContain("计划已整理");
    expect(chunks.some((chunk) => chunk.status?.type === "complete")).toBe(false);
  });

  it("turns a plan frame into the plan-card tool part with its plannedCalls", async () => {
    const body = [
      sseFrame(metaEvent(), 1),
      sseFrame({ type: "progress", stage: "thinking", label: "正在思考…" }, 2),
      sseFrame(
        {
          type: "plan",
          runId: RUN_ID,
          message: "计划已整理。",
          plannedCalls: [PLAN_CALL],
          readOnlyTrace: [],
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
        3,
      ),
      sseFrame({ type: "done", messageId: "a1", finishReason: "tool-calls" }, 4),
    ].join("");
    fetchMock.mockResolvedValue(responseFrom(body));

    const chunks = await collectAdapter([USER_MESSAGE], CONVERSATION_ID);
    const final = chunks[chunks.length - 1];

    expect(final?.status).toEqual({ type: "requires-action", reason: "tool-calls" });
    // `plan` is terminal for the status line: it must not keep showing
    // "正在思考…" once the plan card is on screen.
    expect(final?.metadata?.custom?.progress).toBeUndefined();
    const tool = (final?.content ?? []).find((part) => part.type === "tool-call") as
      PartLike | undefined;
    expect(tool?.toolName).toBe(PLAN_TOOL_NAME);
    expect(tool?.args?.plan?.plannedCalls).toEqual([PLAN_CALL]);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe(`/v1/workspaces/${WORKSPACE_ID}/ai/chat/stream`);
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      message: "去京都玩三天",
      conversationId: CONVERSATION_ID,
      clientMessageId: "u1",
    });

    // Streaming only plans: no execute request was made.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
