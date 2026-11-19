import type { AiSettings } from "../ai.settings.js";
import type {
  AiConversationMessage,
  AiProtocolAdapter,
  AiStepInput,
  AiStepResult,
  AiToolCallRequest,
} from "./adapter.js";
import { asArray, asRecord, numberValue, parseArguments, postJson, textValue } from "./http.js";

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