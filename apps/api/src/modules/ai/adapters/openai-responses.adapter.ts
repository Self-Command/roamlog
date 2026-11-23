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
import { createToolNameCodec, type ToolNameCodec } from "./tool-name-codec.js";

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
    const toolNames = createToolNameCodec(input.tools);

    const payload = await postJson({
      url: `${this.settings.baseUrl}/responses`,
      headers: {
        ...(this.settings.apiKey ? { authorization: `Bearer ${this.settings.apiKey}` } : {}),
      },
      timeoutMs: input.timeoutMs,
      body: {
        model: this.settings.model,
        instructions: input.system,
        input: input.messages.flatMap((message) => toInputItems(message, toolNames)),
        tools: input.tools.map((tool) => ({
          type: "function",
          name: toolNames.toWire(tool.name),
          description: tool.description,
          parameters: tool.parameters,
        })),
        tool_choice: "auto",
        max_output_tokens: input.maxTokens,
        ...reasoningField(this.settings),
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
            name: toolNames.toInternal(name),
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

  async streamStep(input: AiStepInput, options: AiStreamOptions = {}): Promise<AiStepResult> {
    if (!this.settings.baseUrl) {
      throw new Error("AI_BASE_URL is not configured");
    }
    const toolNames = createToolNameCodec(input.tools);

    const response = await postSse(`${this.settings.baseUrl}/responses`, {
      headers: {
        ...(this.settings.apiKey ? { authorization: `Bearer ${this.settings.apiKey}` } : {}),
      },
      timeoutMs: input.timeoutMs,
      signal: options.signal,
      body: {
        model: this.settings.model,
        instructions: input.system,
        input: input.messages.flatMap((message) => toInputItems(message, toolNames)),
        tools: input.tools.map((tool) => ({
          type: "function",
          name: toolNames.toWire(tool.name),
          description: tool.description,
          parameters: tool.parameters,
        })),
        tool_choice: "auto",
        max_output_tokens: input.maxTokens,
        stream: true,
        ...reasoningField(this.settings),
      },
    });

    const body = response.body;
    if (!body) {
      throw new AiUpstreamError("invalid_response", response.status);
    }

    let text = "";
    let completed = false;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    const slots = new Map<number, { id: string; name: string; argumentsJson: string }>();

    for await (const frame of parseSseStream(body, options.signal)) {
      const event = parseJsonRecord(frame.data);
      // Semantic events carry `event:`; fall back to the payload `type` for
      // gateways that only send `data:`.
      const type = frame.event ?? textValue(event.type) ?? "";

      switch (type) {
        case "response.output_text.delta": {
          const delta = textValue(event.delta);
          if (delta !== null && delta.length > 0) {
            text += delta;
            await emitDelta(options, delta);
          }
          break;
        }
        case "response.output_item.added": {
          const index = numberValue(event.output_index);
          const item = asRecord(event.item);
          if (index !== undefined && item?.type === "function_call") {
            const name = textValue(item.name);
            if (name) {
              slots.set(index, {
                id: textValue(item.call_id) ?? textValue(item.id) ?? "",
                name: toolNames.toInternal(name),
                argumentsJson: textValue(item.arguments) ?? "",
              });
            }
          }
          break;
        }
        case "response.function_call_arguments.delta": {
          const index = numberValue(event.output_index);
          const slot = index === undefined ? undefined : slots.get(index);
          const delta = textValue(event.delta);
          if (slot && delta) {
            slot.argumentsJson += delta;
          }
          break;
        }
        case "response.function_call_arguments.done": {
          const index = numberValue(event.output_index);
          const slot = index === undefined ? undefined : slots.get(index);
          const args = textValue(event.arguments);
          if (slot && args !== null) {
            // The done event carries the complete JSON; it wins over fragments.
            slot.argumentsJson = args;
          }
          break;
        }
        case "response.completed": {
          const finished = asRecord(event.response);
          const usage = asRecord(finished?.usage);
          const inTokens = numberValue(usage?.input_tokens);
          const outTokens = numberValue(usage?.output_tokens);
          if (inTokens !== undefined) {
            inputTokens = inTokens;
          }
          if (outTokens !== undefined) {
            outputTokens = outTokens;
          }
          completed = true;
          break;
        }
        case "response.failed":
        case "error":
          throw new AiUpstreamError("invalid_response");
        default:
          break;
      }

      if (completed) {
        break;
      }
    }

    if (!completed && !options.signal?.aborted) {
      throw new AiUpstreamError("invalid_response");
    }

    const usage: AiTokenUsage = {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    };

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

/**
 * Reasoning depth for the Responses API.
 *
 * Same upstream value set (vercel/chatbot `lib/ai/models.ts` L23) and the same
 * rule as the Chat Completions adapter: the exact string is forwarded as
 * `reasoning.effort`, and `"none"` is expressed by omitting the object.
 */
export function reasoningField(settings: AiSettings): Record<string, unknown> {
  const effort = settings.reasoningEffort;
  return effort && effort !== "none" ? { reasoning: { effort } } : {};
}

function toInputItems(
  message: AiConversationMessage,
  toolNames: ToolNameCodec,
): Record<string, unknown>[] {
  if (message.role === "user") {
    const images = message.images ?? [];
    if (images.length === 0) {
      return [{ role: "user", content: message.content }];
    }
    // Responses input items: `input_text` / `input_image` parts (the Responses
    // equivalent of the `image_url` part used by Chat Completions).
    return [
      {
        role: "user",
        content: [
          ...(message.content.trim().length > 0
            ? [{ type: "input_text", text: message.content }]
            : []),
          ...images.map((image) => ({
            type: "input_image",
            image_url: image.dataUrl,
          })),
        ],
      },
    ];
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
      name: toolNames.toWire(call.name),
      arguments: JSON.stringify(call.input),
    })),
  ];
}
