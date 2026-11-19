import type { AiProtocol, AiSettings } from "../ai.settings.js";
import type { AiProtocolAdapter } from "./adapter.js";
import { AnthropicMessagesAdapter } from "./anthropic-messages.adapter.js";
import { OpenAiChatAdapter } from "./openai-chat.adapter.js";
import { OpenAiResponsesAdapter } from "./openai-responses.adapter.js";

/** Injection token for the single configured protocol adapter. */
export const AI_ADAPTER = Symbol("ROAMLOG_AI_ADAPTER");

/**
 * Builds the adapter for `AI_PROTOCOL`. Returns `undefined` when the gateway is
 * not configured, so the module boots without an upstream and the endpoints can
 * answer `503 AI_NOT_CONFIGURED` instead of crashing the app.
 */
export function createAiAdapter(settings: AiSettings): AiProtocolAdapter | undefined {
  if (!settings.configured) {
    return undefined;
  }
  return adapterFor(settings.protocol, settings);
}

export function adapterFor(protocol: AiProtocol, settings: AiSettings): AiProtocolAdapter {
  switch (protocol) {
    case "openai-responses":
      return new OpenAiResponsesAdapter(settings);
    case "anthropic-messages":
      return new AnthropicMessagesAdapter(settings);
    case "openai-chat":
    default:
      return new OpenAiChatAdapter(settings);
  }
}