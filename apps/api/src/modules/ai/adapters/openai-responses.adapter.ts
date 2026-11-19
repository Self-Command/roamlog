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
 * OpenAI Responses API adapter.
 *
 * `input` carries the normalized conversation as items: plain messages for
 * user/assistant text, `function_call` items echoing what the model asked for,
 * and `function_call_output` items carrying the server's tool results.
 */
export class OpenAiResponsesAdapter implements AiProtocolAdapter {
  readonly protocol = "openai-responses" as const;

  constructor(private readonly settings: AiSettings) {}

  async step(input: AiStepInput): Promise<AiStepResult> {
    if (!this.settings.baseUrl) {
      throw new Error("AI_BASE_URL is not configured");
    }

    const payload = await postJson({
      url: `${this.settings.baseUrl}/responses`,
      headers: {
        ...(this.settings.apiKey ? { authorization: `Bearer ${this.settings.apiKey}` } : {}),
      },
      timeoutMs: input.timeoutMs,
      body: {
        model: this.settings.model,
        instructions: input.system,
        input: input.messages.flatMap(toInputItems),
        tools: input.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
        tool_choice: "auto",
        max_output_tokens: input.maxTokens,
      },
    });

    const toolCalls: AiToolCallRequest[] = [];
    let text = "";

    for (const entry of asArray(payload.output)) {
      const item = asRecord(entry);
      if (!item) {
        continue;
      }
      if (item.type === "function_call") {
        const name = textValue(item.name);
        if (name) {
          toolCalls.push({
            id: textValue(item.call_id) ?? textValue(item.id) ?? `call_${name}`,
            name,
            input: parseArguments(item.arguments),
          });
        }
        continue;
      }
      if (item.type === "message") {
        for (const block of asArray(item.content)) {
          const content = asRecord(block);
          if (content?.type === "output_text" || content?.type === "text") {
            text += textValue(content.text) ?? "";
          }
        }
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

function toInputItems(message: AiConversationMessage): Record<string, unknown>[] {
  if (message.role === "user") {
    return [{ role: "user", content: message.content }];
  }
  if (message.role === "tool") {
    return message.results.map((result) => ({
      type: "function_call_output",
      call_id: result.id,
      output: result.content,
    }));
  }
  return [
    ...(message.content
      ? [{ role: "assistant", content: [{ type: "output_text", text: message.content }] }]
      : []),
    ...message.toolCalls.map((call) => ({
      type: "function_call",
      call_id: call.id,
      name: call.name,
      arguments: JSON.stringify(call.input),
    })),
  ];
}