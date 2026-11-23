import type { ChatModelRunOptions } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAiStreamStatus, resumeAiPlanStream, streamAiPlanRecords } from "../../../lib/api/ai";
import { createAiResumeStream, PLAN_TOOL_NAME } from "../chat-model-adapter";

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";
const CONVERSATION_ID = "018f0a00-0000-7000-8000-0000000000cc";
const ASSISTANT_ID = "assistant-refreshed-1";
const RUN_ID = "0123456789abcdef0123456789abcdef";

function frame(id: number, type: string, data: unknown): string {
  return `id: ${String(id).padStart(6, "0")}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function meta(streamId?: string): string {
  return frame(1, "meta", {
    type: "meta",
    v: 1,
    conversationId: CONVERSATION_ID,
    userMessageId: "user-1",
    assistantMessageId: ASSISTANT_ID,
    ...(streamId ? { streamId } : {}),
    provider: { protocol: "openai-chat", model: "auto/test" },
  });
}

const PLAN_FRAME = frame(3, "plan", {
  type: "plan",
  runId: RUN_ID,
  message: "请确认计划。",
  plannedCalls: [{ tool: "trips.create", args: { title: "京都" } }],
  readOnlyTrace: [],
  expiresAt: "2026-11-23T15:00:00.000Z",
});

const DONE_FRAME = frame(4, "done", {
  type: "done",
  messageId: ASSISTANT_ID,
  finishReason: "tool-calls",
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resumable AI stream transport", () => {
  it("returns the original SSE frame ids for POST streams", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        `${meta()}\n${frame(2, "text.delta", {
          type: "text.delta",
          delta: "计划",
        })}\n${DONE_FRAME}\n`,
      ),
    );

    const records = [];
    for await (const record of streamAiPlanRecords(WORKSPACE_ID, {
      message: "京都",
    })) {
      records.push(record);
    }

    expect(records.map((record) => record.eventId)).toEqual([1, 2, 4]);
    expect(records[1]?.event).toEqual({ type: "text.delta", delta: "计划" });
  });

  it("treats a 204 resume probe as no active producer", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const records = [];
    for await (const record of resumeAiPlanStream(WORKSPACE_ID, CONVERSATION_ID, ASSISTANT_ID)) {
      records.push(record);
    }

    expect(records).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/ai/conversations/${CONVERSATION_ID}/stream?assistantMessageId=${ASSISTANT_ID}`,
      ),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("probes stream status without inventing an active state", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ active: true, streamId: CONVERSATION_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fetchAiStreamStatus(WORKSPACE_ID, CONVERSATION_ID)).resolves.toEqual({
      active: true,
      streamId: CONVERSATION_ID,
    });
  });
});

describe("createAiResumeStream", () => {
  it("rebuilds text + plan into a requires-action snapshot after refresh", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        `${meta(CONVERSATION_ID)}\n${frame(2, "text.delta", {
          type: "text.delta",
          delta: "请确认计划。",
        })}\n${PLAN_FRAME}\n${DONE_FRAME}\n`,
      ),
    );

    const run = createAiResumeStream({
      workspaceId: WORKSPACE_ID,
      conversationId: CONVERSATION_ID,
    })({
      messages: [],
      runConfig: {},
      abortSignal: new AbortController().signal,
      context: {},
      unstable_assistantMessageId: ASSISTANT_ID,
      unstable_getMessage: () => {
        throw new Error("not used");
      },
    } as unknown as ChatModelRunOptions);

    let last;
    for await (const result of run) {
      last = result;
    }

    expect(last).toMatchObject({
      status: { type: "requires-action", reason: "tool-calls" },
    });
    expect(last?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "请确认计划。" }),
        expect.objectContaining({
          type: "tool-call",
          toolName: PLAN_TOOL_NAME,
        }),
      ]),
    );
  });
});
