import type { AiSettings } from "../ai.settings.js";
import type {
  AiConversationMessage,
  AiProtocolAdapter,
  AiStepInput,
  AiStepResult,
  AiStreamOptions,
  AiTokenUsage,
  AiToolCallRequest,
} from "./adapter.js";
import {
  AiUpstreamError,
  asArray,
  asRecord,
  numberValue,
  parseArguments,
  postJson,
  textValue,
} from "./http.js";
import { parseSseStream, postSse } from "./sse.js";

/**
 * OpenAI Chat Completions adapter.
 *
 * Structured output uses the standard function-tool shape:
 * `tools: [{ type: "function", function: { name, description, parameters } }]`
 * with `tool_choice: "auto"`, and the loop is continued by sending the
 * assistant's `tool_calls` back followed by one `role: "tool"` message per call.
 */
export class OpenAiChatAdapter implements AiProtocolAdapter {
  readonly protocol = "openai-chat" as const;

  constructor(private readonly settings: AiSettings) {}

  async step(input: AiStepInput): Promise<AiStepResult> {
    if (!this.settings.baseUrl) {
      throw new Error("AI_BASE_URL is not configured");
    }

    const payload = await postJson({
      url: `${this.settings.baseUrl}/chat/completions`,
      headers: {
        ...(this.settings.apiKey ? { authorization: `Bearer ${this.settings.apiKey}` } : {}),
      },
      timeoutMs: input.timeoutMs,
      body: {
        model: this.settings.model,
        messages: [
          { role: "system", content: input.system },
          ...input.messages.flatMap(toMessages),
        ],
        tools: input.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: "auto",
        max_tokens: input.maxTokens,
      },
    });

    const choice = asRecord(asArray(payload.choices)[0]);
    const message = asRecord(choice?.message);
    if (!message) {
      throw new Error("Upstream response is missing choices[0].message");
    }

    const toolCalls: AiToolCallRequest[] = asArray(message.tool_calls).flatMap((entry) => {
      const call = asRecord(entry);
      const fn = asRecord(call?.function);
      const name = textValue(fn?.name);
      if (!call || !fn || !name) {
        return [];
      }
      return [
        {
          id: textValue(call.id) ?? `call_${name}`,
          name,
          input: parseArguments(fn.arguments),
        },
      ];
    });

    const usage = asRecord(payload.usage);

    return {
      text: textValue(message.content),
      toolCalls,
      usage: {
        ...(numberValue(usage?.prompt_tokens) === undefined
          ? {}
          : { inputTokens: numberValue(usage?.prompt_tokens) }),
        ...(numberValue(usage?.completion_tokens) === undefined
          ? {}
          : { outputTokens: numberValue(usage?.completion_tokens) }),
      },
    };
  }

  async streamStep(input: AiStepInput, options: AiStreamOptions = {}): Promise<AiStepResult> {
    if (!this.settings.baseUrl) {
      throw new Error("AI_BASE_URL is not configured");
    }

    const response = await postSse(`${this.settings.baseUrl}/chat/completions`, {
      headers: {
        ...(this.settings.apiKey ? { authorization: `Bearer ${this.settings.apiKey}` } : {}),
      },
      timeoutMs: input.timeoutMs,
      signal: options.signal,
      body: {
        model: this.settings.model,
        messages: [
          { role: "system", content: input.system },
          ...input.messages.flatMap(toMessages),
        ],
        tools: input.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: "auto",
        max_tokens: input.maxTokens,
        stream: true,
        // Required by OpenAI to receive the final `choices: []` usage chunk.
        stream_options: { include_usage: true },
      },
    });

    const body = response.body;
    if (!body) {
      throw new AiUpstreamError("invalid_response", response.status);
    }

    let text = "";
    let completed = false;
    let usage: AiTokenUsage = {};
    const slots = new Map<number, { id: string; name: string; argumentsJson: string }>();

    for await (const frame of parseSseStream(body, options.signal)) {
      if (frame.data === "[DONE]") {
        completed = true;
        break;
      }

      const chunk = parseJsonRecord(frame.data);

      for (const entry of asArray(chunk.choices)) {
        const choice = asRecord(entry);
        const delta = asRecord(choice?.delta);

        const content = textValue(delta?.content);
        if (content !== null && content.length > 0) {
          text += content;
          await emitDelta(options, content);
        }

        for (const rawCall of asArray(delta?.tool_calls)) {
          const call = asRecord(rawCall);
          const index = numberValue(call?.index);
          if (index === undefined) {
            continue;
          }
          // `arguments` arrives as a fragmented string; accumulate per index.
          const slot = slots.get(index) ?? { id: "", name: "", argumentsJson: "" };
          const id = textValue(call?.id);
          if (id) {
            slot.id = id;
          }
          const fn = asRecord(call?.function);
          const name = textValue(fn?.name);
          if (name) {
            slot.name = name;
          }
          const fragment = textValue(fn?.arguments);
          if (fragment) {
            slot.argumentsJson += fragment;
          }
          slots.set(index, slot);
        }

        // Gateways that close without `data: [DONE]` still signal completion
        // through finish_reason; keep that as a fallback.
        if (textValue(choice?.finish_reason)) {
          completed = true;
        }
      }

      // With `include_usage`, the last chunk has `choices: []` and carries usage.
      const chunkUsage = asRecord(chunk.usage);
      if (chunkUsage) {
        const inputTokens = numberValue(chunkUsage.prompt_tokens);
        const outputTokens = numberValue(chunkUsage.completion_tokens);
        if (inputTokens !== undefined) {
          usage = { ...usage, inputTokens };
        }
        if (outputTokens !== undefined) {
          usage = { ...usage, outputTokens };
        }
      }
    }

    if (!completed && !options.signal?.aborted) {
      throw new AiUpstreamError("invalid_response");
    }

    return {
      text: text.length > 0 ? text : null,
      toolCalls: toToolCalls(slots),
      usage,
    };
  }
}

function parseJsonRecord(data: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    throw new AiUpstreamError("invalid_response");
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new AiUpstreamError("invalid_response");
  }
  return record;
}

async function emitDelta(options: AiStreamOptions, delta: string): Promise<void> {
  const listener = options.onDelta ?? options.onTextDelta;
  if (listener) {
    await listener(delta);
  }
}

function toToolCalls(
  slots: Map<number, { id: string; name: string; argumentsJson: string }>,
): AiToolCallRequest[] {
  return [...slots.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, slot]) =>
      slot.name.length > 0
        ? [
            {
              id: slot.id || `call_${slot.name}`,
              name: slot.name,
              input: parseArguments(slot.argumentsJson),
            },
          ]
        : [],
    );
}

function toMessages(message: AiConversationMessage): Record<string, unknown>[] {
  if (message.role === "user") {
    return [{ role: "user", content: message.content }];
  }
  if (message.role === "tool") {
    return message.results.map((result) => ({
      role: "tool",
      tool_call_id: result.id,
      content: result.content,
    }));
  }
  return [
    {
      role: "assistant",
      content: message.content ?? "",
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      })),
    },
  ];
}