import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiToolSpec } from "../adapters/adapter.js";
import { AnthropicMessagesAdapter } from "../adapters/anthropic-messages.adapter.js";
import { OpenAiChatAdapter } from "../adapters/openai-chat.adapter.js";
import { OpenAiResponsesAdapter } from "../adapters/openai-responses.adapter.js";
import type { AiSettings } from "../ai.settings.js";

const SETTINGS: AiSettings = {
  protocol: "openai-chat",
  baseUrl: "https://gateway.test/v1",
  apiKey: "test-key",
  model: "deepseek-flash",
  allowedModels: ["deepseek-flash"],
  timeoutMs: 2_000,
  maxOutputTokens: 128,
  dailyQuota: 0,
  configured: true,
};

const TOOL: AiToolSpec = {
  name: "places.search",
  description: "Search places",
  parameters: {
    type: "object",
    properties: { q: { type: "string" } },
    required: ["q"],
    additionalProperties: false,
  },
};

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider tool-name compatibility", () => {
  it("maps OpenAI Chat tool names to the wire pattern and back", async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return response({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "places_search", arguments: '{"q":"kyoto"}' },
                  },
                ],
              },
            },
          ],
        });
      }),
    );

    const result = await new OpenAiChatAdapter(SETTINGS).step({
      system: "system",
      messages: [
        { role: "user", content: "find a place" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_0", name: "places.search", input: { q: "kyoto" } }],
        },
        { role: "tool", results: [{ id: "call_0", name: "places.search", content: "ok" }] },
      ],
      tools: [TOOL],
      maxTokens: 128,
      timeoutMs: 2_000,
    });

    const tools = body?.tools as Array<{ function: { name: string } }>;
    expect(tools[0]?.function.name).toBe("places_search");
    const messages = body?.messages as Array<{
      role: string;
      tool_calls?: Array<{ function: { name: string } }>;
    }>;
    expect(
      messages.find((message) => message.role === "assistant")?.tool_calls?.[0]?.function.name,
    ).toBe("places_search");
    expect(result.toolCalls[0]?.name).toBe("places.search");
  });

  it("maps streamed OpenAI Chat tool names back before the planner sees them", async () => {
    let body: Record<string, unknown> | undefined;
    const stream = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"places_search","arguments":"{\\"q\\":\\"kyoto\\"}"}}]},"finish_reason":"tool_calls"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );

    const result = await new OpenAiChatAdapter(SETTINGS).streamStep({
      system: "system",
      messages: [{ role: "user", content: "find a place" }],
      tools: [TOOL],
      maxTokens: 128,
      timeoutMs: 2_000,
    });

    const tools = body?.tools as Array<{ function: { name: string } }>;
    expect(tools[0]?.function.name).toBe("places_search");
    expect(result.toolCalls[0]?.name).toBe("places.search");
  });

  it("maps OpenAI Responses tool names and response calls", async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return response({
          output: [
            {
              type: "function_call",
              call_id: "call_1",
              name: "places_search",
              arguments: '{"q":"kyoto"}',
            },
          ],
        });
      }),
    );

    const result = await new OpenAiResponsesAdapter({
      ...SETTINGS,
      protocol: "openai-responses",
    }).step({
      system: "system",
      messages: [{ role: "user", content: "find a place" }],
      tools: [TOOL],
      maxTokens: 128,
      timeoutMs: 2_000,
    });

    const tools = body?.tools as Array<{ name: string }>;
    expect(tools[0]?.name).toBe("places_search");
    expect(result.toolCalls[0]?.name).toBe("places.search");
  });

  it("maps Anthropic tool names and tool_use responses", async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return response({
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "places_search",
              input: { q: "kyoto" },
            },
          ],
        });
      }),
    );

    const result = await new AnthropicMessagesAdapter({
      ...SETTINGS,
      protocol: "anthropic-messages",
    }).step({
      system: "system",
      messages: [{ role: "user", content: "find a place" }],
      tools: [TOOL],
      maxTokens: 128,
      timeoutMs: 2_000,
    });

    const tools = body?.tools as Array<{ name: string }>;
    expect(tools[0]?.name).toBe("places_search");
    expect(result.toolCalls[0]?.name).toBe("places.search");
  });
});
