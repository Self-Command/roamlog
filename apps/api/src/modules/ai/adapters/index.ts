import type { AiProtocol, AiSettings } from "../ai.settings.js";
import type { AiProtocolAdapter } from "./adapter.js";
import { AnthropicMessagesAdapter } from "./anthropic-messages.adapter.js";
import { OpenAiChatAdapter } from "./openai-chat.adapter.js";
import { OpenAiResponsesAdapter } from "./openai-responses.adapter.js";

/**
 * Builds the adapter for one request's resolved settings.
 *
 * The resolved protocol is per request (`ai.defaultProvider`), so the factory —
 * not a module-level singleton adapter — is what the module provides.
 */
export const AI_ADAPTER_FACTORY = Symbol("ROAMLOG_AI_ADAPTER_FACTORY");

export type AiAdapterFactory = (settings: AiSettings) => AiProtocolAdapter | undefined;

/**
 * Returns `undefined` when the gateway is not configured, so the module boots
 * without an upstream and the endpoints can answer `503 AI_NOT_CONFIGURED`
 * instead of crashing the app. A protocol the environment cannot serve is never
 * swapped for another one: the endpoint answers 503 instead.
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