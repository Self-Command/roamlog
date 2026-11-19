import type { AiProtocol } from "../ai.settings.js";

export interface AiToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the arguments object. */
  readonly parameters: Record<string, unknown>;
}

export interface AiToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface AiToolResultMessage {
  readonly id: string;
  readonly name: string;
  /** JSON-encoded tool output; never the raw user prompt. */
  readonly content: string;
}

/** One normalized conversation, translated per protocol by each adapter. */
export type AiConversationMessage =
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly toolCalls: readonly AiToolCallRequest[];
    }
  | { readonly role: "tool"; readonly results: readonly AiToolResultMessage[] };

export interface AiStepInput {
  readonly system: string;
  readonly messages: readonly AiConversationMessage[];
  readonly tools: readonly AiToolSpec[];
  readonly maxTokens: number;
  readonly timeoutMs: number;
}

export interface AiTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface AiStepResult {
  readonly text: string | null;
  readonly toolCalls: readonly AiToolCallRequest[];
  readonly usage?: AiTokenUsage;
}

/**
 * One model turn. The loop lives in `AiPlanService`, so an adapter only has to
 * translate one request/response pair — never to orchestrate tools itself.
 */
export interface AiProtocolAdapter {
  readonly protocol: AiProtocol;
  step(input: AiStepInput): Promise<AiStepResult>;
}