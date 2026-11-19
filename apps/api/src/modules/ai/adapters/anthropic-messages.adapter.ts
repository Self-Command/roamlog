import type { AiSettings } from "../ai.settings.js";
import type {
  AiConversationMessage,
  AiProtocolAdapter,
  AiStepInput,
  AiStepResult,
  AiToolCallRequest,
} from "./adapter.js";
import { asArray, asRecord, numberValue, parseArguments, postJson, textValue } from "./http.js";

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic Messages adapter.
 *
 * Tool use is native: `tools[]` with `input_schema`, `tool_choice: "auto"`, and
 * the loop continues by appending the assistant `tool_use` blocks and then a
 * user message made of matching `tool_result` blocks.
 */
export class AnthropicMessagesAdapter implements AiProtocolAdapter {
  readonly protocol = "anthropic-messages" as const;

  constructor(private readonly settings: AiSettings) {}

  async step(input: AiStepInput): Promise<AiStepResult> {
    if (!this.settings.baseUrl) {
      throw new Error("AI_BASE_URL is not configured");
    }

    const payload = await postJson({
      url: `${this.settings.baseUrl}/messages`,
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        ...(this.settings.apiKey ? { "x-api-key": this.settings.apiKey } : {}),
      },
      timeoutMs: input.timeoutMs,
      body: {
        model: this.settings.model,
        system: input.system,
        max_tokens: input.maxTokens,
        tools: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
        tool_choice: { type: "auto" },
        messages: input.messages.map(toMessage),
      },
    });

    const toolCalls: AiToolCallRequest[] = [];
    let text = "";

    for (const block of asArray(payload.content)) {
      const item = asRecord(block);
      if (!item) {
        continue;
      }
      if (item.type === "tool_use") {
        const name = textValue(item.name);
        if (name) {
          toolCalls.push({
            id: textValue(item.id) ?? `toolu_${name}`,
            name,
            input: parseArguments(item.input),
          });
        }
        continue;
      }
      if (item.type === "text") {
        text += textValue(item.text) ?? "";
      }
    }

    const usage = asRecord(payload.usage);

    return {
      text: text.length > 0 ? text : null,
      toolCalls,
      usage: {
        ...(numberValue(usage?.input_tokens) === undefined
          ? {}
          : { inputTokens: numberValue(usage?.input_tokens) }),
        ...(numberValue(usage?.output_tokens) === undefined
          ? {}
          : { outputTokens: numberValue(usage?.output_tokens) }),
      },
    };
  }
}

function toMessage(message: AiConversationMessage): Record<string, unknown> {
  if (message.role === "user") {
    return { role: "user", content: [{ type: "text", text: message.content }] };
  }
  if (message.role === "tool") {
    return {
      role: "user",
      content: message.results.map((result) => ({
        type: "tool_result",
        tool_use_id: result.id,
        content: result.content,
      })),
    };
  }
  return {
    role: "assistant",
    content: [
      ...(message.content ? [{ type: "text", text: message.content }] : []),
      ...message.toolCalls.map((call) => ({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    ],
  };
}