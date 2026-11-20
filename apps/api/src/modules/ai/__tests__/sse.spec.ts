import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiStepInput } from "../adapters/adapter.js";
import { AnthropicMessagesAdapter } from "../adapters/anthropic-messages.adapter.js";
import { AiUpstreamError } from "../adapters/http.js";
import { OpenAiChatAdapter } from "../adapters/openai-chat.adapter.js";
import { OpenAiResponsesAdapter } from "../adapters/openai-responses.adapter.js";
import { parseSseStream, postSse } from "../adapters/sse.js";
import type { SseFrame } from "../adapters/sse.js";
import type { AiSettings } from "../ai.settings.js";

const encoder = new TextEncoder();

function streamOf(...chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collectFrames(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  for await (const frame of parseSseStream(body, signal)) {
    frames.push(frame);
  }
  return frames;
}

function sseResponse(chunks: readonly string[]): Response {
  return new Response(streamOf(...chunks), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

/**
 * Builds an event stream from the same JSON payloads the three gateways send.
 * `data` strings are written verbatim so `[DONE]` stays a sentinel.
 */
function sseFrames(frames: ReadonlyArray<{ event?: string; data: unknown }>): string[] {
  return frames.map((frame) => {
    const event = frame.event ? `event: ${frame.event}\n` : "";
    const data = typeof frame.data === "string" ? frame.data : JSON.stringify(frame.data);
    return `${event}data: ${data}\n\n`;
  });
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function settings(protocol: AiSettings["protocol"]): AiSettings {
  return {
    protocol,
    baseUrl: "http://gateway.test/v1",
    apiKey: "test-key",
    model: "test-model",
    allowedModels: ["test-model"],
    timeoutMs: 5_000,
    maxOutputTokens: 1_000,
    dailyQuota: 20,
    configured: true,
  };
}

const INPUT: AiStepInput = {
  system: "You are a test.",
  messages: [{ role: "user", content: "hello" }],
  tools: [],
  maxTokens: 256,
  timeoutMs: 5_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSseStream", () => {
  it("parses CRLF frames with id/event/data", async () => {
    const frames = await collectFrames(
      streamOf(
        'id: 000042\r\nevent: text.delta\r\ndata: {"type":"text.delta","delta":"北"}\r\n\r\n',
      ),
    );

    expect(frames).toEqual([
      {
        id: "000042",
        event: "text.delta",
        data: '{"type":"text.delta","delta":"北"}',
      },
    ]);
  });

  it("joins multi-line data fields with a newline", async () => {
    const frames = await collectFrames(streamOf("data: line1\ndata: line2\n\n"));

    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe("line1\nline2");
  });

  it("skips comment/heartbeat blocks and comment lines", async () => {
    const frames = await collectFrames(
      streamOf(
        ": hb 2026-11-19T00:00:00Z\n\n",
        ": another comment\n",
        "event: text.delta\ndata: real\n\n",
      ),
    );

    expect(frames).toEqual([{ event: "text.delta", data: "real" }]);
  });

  it("surfaces [DONE] and splits multiple frames from one chunk", async () => {
    const frames = await collectFrames(
      streamOf('data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n'),
    );

    expect(frames.map((frame) => frame.data)).toEqual(['{"a":1}', '{"a":2}', "[DONE]"]);
  });

  it("accepts data before event and a frame split across chunks", async () => {
    const frames = await collectFrames(
      streamOf('data: {"half":1}\n\nevent: text.delta\ndata: split-', "frame\n\n"),
    );

    expect(frames).toEqual([
      { data: '{"half":1}' },
      { event: "text.delta", data: "split-frame" },
    ]);
  });

  it("decodes UTF-8 characters split across chunk boundaries", async () => {
    // "data: 你好\n\n" — slice at 8 bytes lands in the middle of 你 (3 bytes),
    // so a decoder without { stream: true } would emit replacement characters.
    const bytes = encoder.encode("data: 你好\n\n");
    const frames = await collectFrames(streamOf(bytes.slice(0, 8), bytes.slice(8)));

    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe("你好");
  });

  it("flushes a trailing frame that has no blank-line terminator", async () => {
    const frames = await collectFrames(streamOf('data: {"tail":true}'));

    expect(frames).toEqual([{ data: '{"tail":true}' }]);
  });

  it("ends the generator cleanly when the AbortSignal fires", async () => {
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // The second block is intentionally a half frame: aborting must not
        // flush it as if it were complete.
        controller.enqueue(encoder.encode("data: first\n\ndata: partial-"));
        // Intentionally never closes: the abort must cancel the reader.
      },
    });

    const frames: SseFrame[] = [];
    const consumer = (async () => {
      for await (const frame of parseSseStream(body, abort.signal)) {
        frames.push(frame);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 0));
    abort.abort();

    await expect(consumer).resolves.toBeUndefined();
    expect(frames.map((frame) => frame.data)).toEqual(["first"]);
  });
});

describe("postSse", () => {
  it("throws AiUpstreamError('http', 429) without echoing the upstream body", async () => {
    const secret = "PROMPT_ECHO_MUST_NOT_LEAK";
    stubFetch(
      new Response(`<html>error for prompt: ${secret}</html>`, {
        status: 429,
        headers: { "content-type": "text/html" },
      }),
    );

    let caught: unknown;
    try {
      await postSse("http://gateway.test/v1/chat/completions", {
        body: { messages: [{ role: "user", content: secret }] },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AiUpstreamError);
    const upstream = caught as AiUpstreamError;
    expect(upstream.kind).toBe("http");
    expect(upstream.httpStatus).toBe(429);
    expect(upstream.message).not.toContain(secret);
    expect(upstream.message).not.toContain("<html>");
    expect(upstream.detail ?? "").not.toContain(secret);
  });

  it("rejects a 200 response that is not text/event-stream", async () => {
    stubFetch(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );

    await expect(postSse("http://gateway.test/v1/responses")).rejects.toMatchObject({
      name: "AiUpstreamError",
      kind: "invalid_response",
      httpStatus: 200,
    });
  });
});

/**
 * Protocol fixtures mirror §1.2 exactly: real chunk JSON shapes, fragmented
 * tool arguments and the final usage frame. No live gateway is involved.
 */
const OPENAI_CHAT_CHUNKS = sseFrames([
  {
    data: {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 1_730_000_000,
      model: "test-model",
      choices: [
        { index: 0, delta: { role: "assistant", content: "" }, finish_reason: null },
      ],
    },
  },
  {
    data: {
      id: "chatcmpl-1",
      choices: [{ index: 0, delta: { content: "京都" }, finish_reason: null }],
    },
  },
  {
    data: {
      id: "chatcmpl-1",
      choices: [{ index: 0, delta: { content: "很美" }, finish_reason: null }],
    },
  },
  {
    data: {
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_abc",
                type: "function",
                function: { name: "trips.create", arguments: '{"tit' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
  },
  {
    data: {
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: 'le":"Kyoto"}' } }] },
          finish_reason: "tool_calls",
        },
      ],
    },
  },
  {
    data: {
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 1,
                id: "call_def",
                type: "function",
                function: { name: "stops.add", arguments: '{"city":' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
  },
  {
    data: {
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 1, function: { arguments: '"Osaka"}' } }] },
          finish_reason: "tool_calls",
        },
      ],
    },
  },
  {
    data: {
      id: "chatcmpl-1",
      choices: [],
      usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
    },
  },
  { data: "[DONE]" },
]);

const OPENAI_RESPONSES_CHUNKS = sseFrames([
  {
    event: "response.created",
    data: { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
  },
  {
    event: "response.output_text.delta",
    data: {
      type: "response.output_text.delta",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      delta: "你好",
    },
  },
  {
    event: "response.output_text.delta",
    data: {
      type: "response.output_text.delta",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      delta: "，世界",
    },
  },
  {
    event: "response.output_item.added",
    data: {
      type: "response.output_item.added",
      output_index: 1,
      item: {
        id: "fc_1",
        type: "function_call",
        status: "in_progress",
        call_id: "call_xyz",
        name: "trips.create",
        arguments: "",
      },
    },
  },
  {
    event: "response.function_call_arguments.delta",
    data: {
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      output_index: 1,
      delta: '{"title":"京都',
    },
  },
  {
    event: "response.function_call_arguments.delta",
    data: {
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      output_index: 1,
      delta: '之旅"}',
    },
  },
  {
    event: "response.function_call_arguments.done",
    data: {
      type: "response.function_call_arguments.done",
      item_id: "fc_1",
      output_index: 1,
      arguments: '{"title":"京都之旅"}',
    },
  },
  {
    event: "response.completed",
    data: {
      type: "response.completed",
      response: {
        id: "resp_1",
        status: "completed",
        usage: { input_tokens: 88, output_tokens: 21, total_tokens: 109 },
      },
    },
  },
]);

const ANTHROPIC_CHUNKS = sseFrames([
  {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [],
        model: "test-model",
        usage: { input_tokens: 57, output_tokens: 1 },
      },
    },
  },
  {
    event: "content_block_start",
    data: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
  },
  { event: "ping", data: { type: "ping" } },
  {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "京都" },
    },
  },
  {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "的秋天" },
    },
  },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
  {
    event: "content_block_start",
    data: {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_01", name: "trips.create", input: {} },
    },
  },
  {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"title":' },
    },
  },
  {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '"京都之旅"}' },
    },
  },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
  {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 42 },
    },
  },
  { event: "message_stop", data: { type: "message_stop" } },
]);

describe("openai-chat streamStep", () => {
  it("emits text deltas, merges indexed tool-call fragments and returns usage", async () => {
    const fetchMock = stubFetch(sseResponse(OPENAI_CHAT_CHUNKS));
    const adapter = new OpenAiChatAdapter(settings("openai-chat"));
    const deltas: string[] = [];

    const result = await adapter.streamStep(INPUT, {
      onDelta: (delta) => {
        deltas.push(delta);
      },
    });

    expect(deltas).toEqual(["京都", "很美"]);
    expect(result.text).toBe("京都很美");
    expect(result.toolCalls).toEqual([
      { id: "call_abc", name: "trips.create", input: { title: "Kyoto" } },
      { id: "call_def", name: "stops.add", input: { city: "Osaka" } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 45 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://gateway.test/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});

describe("openai-responses streamStep", () => {
  it("reads response.output_text.delta and function_call_arguments deltas", async () => {
    const fetchMock = stubFetch(sseResponse(OPENAI_RESPONSES_CHUNKS));
    const adapter = new OpenAiResponsesAdapter(settings("openai-responses"));
    const deltas: string[] = [];

    const result = await adapter.streamStep(INPUT, {
      onDelta: (delta) => {
        deltas.push(delta);
      },
    });

    expect(deltas).toEqual(["你好", "，世界"]);
    expect(result.text).toBe("你好，世界");
    expect(result.toolCalls).toEqual([
      { id: "call_xyz", name: "trips.create", input: { title: "京都之旅" } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 88, outputTokens: 21 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://gateway.test/v1/responses");
    expect((JSON.parse(String(init.body)) as Record<string, unknown>).stream).toBe(true);
  });
});

describe("anthropic-messages streamStep", () => {
  it("reads text_delta and input_json_delta and keeps cumulative usage", async () => {
    const fetchMock = stubFetch(sseResponse(ANTHROPIC_CHUNKS));
    const adapter = new AnthropicMessagesAdapter(settings("anthropic-messages"));
    const deltas: string[] = [];

    const result = await adapter.streamStep(INPUT, {
      // Alias from the porting spec: adapters must accept both callback names.
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
    });

    expect(deltas).toEqual(["京都", "的秋天"]);
    expect(result.text).toBe("京都的秋天");
    expect(result.toolCalls).toEqual([
      { id: "toolu_01", name: "trips.create", input: { title: "京都之旅" } },
    ]);
    // message_start said 1; message_delta's cumulative value must win.
    expect(result.usage).toEqual({ inputTokens: 57, outputTokens: 42 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://gateway.test/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect((JSON.parse(String(init.body)) as Record<string, unknown>).stream).toBe(true);
  });

  it("surfaces an `event: error` frame as AiUpstreamError(invalid_response)", async () => {
    stubFetch(
      sseResponse(
        sseFrames([
          {
            event: "error",
            data: {
              type: "error",
              error: { type: "overloaded_error", message: "Overloaded" },
            },
          },
        ]),
      ),
    );

    await expect(
      new AnthropicMessagesAdapter(settings("anthropic-messages")).streamStep(INPUT, {}),
    ).rejects.toMatchObject({ name: "AiUpstreamError", kind: "invalid_response" });
  });
});

describe("streamStep abort", () => {
  it("stops at the current text without throwing when the client aborts", async () => {
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"index":0,"delta":{"content":"半"},"finish_reason":null}]}\n\n',
          ),
        );
        // Never closes; the abort in onDelta must end the loop.
      },
    });
    stubFetch(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));

    const deltas: string[] = [];
    const result = await new OpenAiChatAdapter(settings("openai-chat")).streamStep(INPUT, {
      signal: abort.signal,
      onDelta: (delta) => {
        deltas.push(delta);
        abort.abort();
      },
    });

    expect(deltas).toEqual(["半"]);
    expect(result.text).toBe("半");
  });
});
