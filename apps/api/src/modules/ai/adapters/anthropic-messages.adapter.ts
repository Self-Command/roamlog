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
import { createToolNameCodec } from "./tool-name-codec.js";

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
    const toolNames = createToolNameCodec(input.tools);

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
          name: toolNames.toWire(tool.name),
          description: tool.description,
          input_schema: tool.parameters,
        })),
        tool_choice: { type: "auto" },
        messages: input.messages.map((message) => toMessage(message, toolNames.toWire)),
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
            name: toolNames.toInternal(name),
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

  async streamStep(input: AiStepInput, options: AiStreamOptions = {}): Promise<AiStepResult> {
    if (!this.settings.baseUrl) {
      throw new Error("AI_BASE_URL is not configured");
    }
    const toolNames = createToolNameCodec(input.tools);

    const response = await postSse(`${this.settings.baseUrl}/messages`, {
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        ...(this.settings.apiKey ? { "x-api-key": this.settings.apiKey } : {}),
      },
      timeoutMs: input.timeoutMs,
      signal: options.signal,
      body: {
        model: this.settings.model,
        system: input.system,
        max_tokens: input.maxTokens,
        tools: input.tools.map((tool) => ({
          name: toolNames.toWire(tool.name),
          description: tool.description,
          input_schema: tool.parameters,
        })),
        tool_choice: { type: "auto" },
        messages: input.messages.map((message) => toMessage(message, toolNames.toWire)),
        stream: true,
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
      // Anthropic always sends `event:`; data.type is a defensive fallback.
      const type = frame.event ?? textValue(event.type) ?? "";

      switch (type) {
        case "message_start": {
          const message = asRecord(event.message);
          const usage = asRecord(message?.usage);
          const inTokens = numberValue(usage?.input_tokens);
          const outTokens = numberValue(usage?.output_tokens);
          if (inTokens !== undefined) {
            inputTokens = inTokens;
          }
          if (outTokens !== undefined) {
            outputTokens = outTokens;
          }
          break;
        }
        case "content_block_start": {
          const index = numberValue(event.index);
          const block = asRecord(event.content_block);
          if (index !== undefined && block?.type === "tool_use") {
            const name = textValue(block.name);
            if (name) {
              const initialInput = asRecord(block.input);
              slots.set(index, {
                id: textValue(block.id) ?? "",
                name: toolNames.toInternal(name),
                argumentsJson:
                  initialInput && Object.keys(initialInput).length > 0
                    ? JSON.stringify(initialInput)
                    : "",
              });
            }
          }
          break;
        }
        case "content_block_delta": {
          const delta = asRecord(event.delta);
          if (delta?.type === "text_delta") {
            const chunk = textValue(delta.text);
            if (chunk !== null && chunk.length > 0) {
              text += chunk;
              await emitDelta(options, chunk);
            }
          } else if (delta?.type === "input_json_delta") {
            const index = numberValue(event.index);
            const slot = index === undefined ? undefined : slots.get(index);
            const partial = textValue(delta.partial_json);
            if (slot && partial) {
              slot.argumentsJson += partial;
            }
          }
          break;
        }
        case "message_delta": {
          // Anthropic's usage is cumulative, so this overwrites (never adds).
          const usage = asRecord(event.usage);
          const outTokens = numberValue(usage?.output_tokens);
          if (outTokens !== undefined) {
            outputTokens = outTokens;
          }
          break;
        }
        case "message_stop":
          completed = true;
          break;
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
              id: slot.id || `toolu_${slot.name}`,
              name: slot.name,
              input: parseArguments(slot.argumentsJson),
            },
          ]
        : [],
    );
}

/**
 * One Anthropic message. Image attachments become `image` content blocks with a
 * base64 `source` — the Messages API accepts no URL for images, so the data URL
 * resolved by the planner is split into `media_type` + `data`.
 *
 * Note: Anthropic Messages has no `reasoningEffort` equivalent, so
 * `settings.reasoningEffort` is deliberately not forwarded on this protocol
 * (declared in the delivery report; the UI marks that per model).
 */
/** `data:<mime>;base64,<payload>` → `<payload>`; anything else is passed through. */
export function base64Payload(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return dataUrl.startsWith("data:") && comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function toMessage(
  message: AiConversationMessage,
  toWireName: (name: string) => string,
): Record<string, unknown> {
  if (message.role === "user") {
    const images = message.images ?? [];
    if (images.length === 0) {
      return { role: "user", content: [{ type: "text", text: message.content }] };
    }
    return {
      role: "user",
      content: [
        ...(message.content.trim().length > 0 ? [{ type: "text", text: message.content }] : []),
        ...images.map((image) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mimeType,
            data: base64Payload(image.dataUrl),
          },
        })),
      ],
    };
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
        name: toWireName(call.name),
        input: call.input,
      })),
    ],
  };
}
