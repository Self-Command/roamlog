import { afterEach, describe, expect, it, vi } from "vitest";

import { AnthropicMessagesAdapter } from "../adapters/anthropic-messages.adapter.js";
import { OpenAiChatAdapter } from "../adapters/openai-chat.adapter.js";
import { OpenAiResponsesAdapter } from "../adapters/openai-responses.adapter.js";
import {
  parseAllowedModels,
  resolveAiSettingsFromStored,
  type AiSettings,
} from "../ai.settings.js";

/**
 * Stage 2/3 backend evidence: the two things the contract promises but a
 * browser test cannot see — how an attachment becomes a model-readable content
 * part, and how `reasoningEffort` is forwarded.
 *
 * The upstream reference for the wire shapes is vercel/chatbot
 * `app/(chat)/api/chat/route.ts` L301–L302 (`providerOptions.openai.reasoningEffort`)
 * plus AI SDK `convertToModelMessages` (image part → provider image part);
 * this repo has no AI SDK, so the adapters translate the part themselves and
 * these tests pin the translation.
 */

const IMAGE = {
  mimeType: "image/png",
  dataUrl: "data:image/png;base64,QUJD",
} as const;

const BASE: AiSettings = {
  protocol: "openai-chat",
  baseUrl: "https://gateway.test/v1",
  apiKey: "test-key",
  model: "openai/gpt-4o-mini",
  allowedModels: ["openai/gpt-4o-mini"],
  timeoutMs: 2_000,
  maxOutputTokens: 128,
  dailyQuota: 0,
  configured: true,
};

const USER_WITH_IMAGE = {
  role: "user" as const,
  content: "看看这张照片",
  images: [IMAGE],
};

function stubFetch(): { url: string; body: Record<string, unknown> }[] {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      // Any shape is fine: the assertions read the request, not the reply.
      return new Response(JSON.stringify({ choices: [], output: [], content: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attachment → model content part", () => {
  it("openai-chat sends image_url parts with the inlined data URL", async () => {
    const calls = stubFetch();
    const adapter = new OpenAiChatAdapter(BASE);

    await adapter
      .step({
        system: "s",
        messages: [USER_WITH_IMAGE],
        tools: [],
        maxTokens: 64,
        timeoutMs: 1_000,
      })
      .catch(() => undefined);

    const messages = calls[0]?.body.messages as Array<{ role: string; content: unknown }>;
    const user = messages.find((message) => message.role === "user");
    const parts = user?.content as Array<Record<string, unknown>>;

    expect(Array.isArray(parts)).toBe(true);
    expect(parts[0]).toMatchObject({ type: "text", text: "看看这张照片" });
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: IMAGE.dataUrl } });
  });

  it("keeps text-only turns on the plain string wire shape", async () => {
    const calls = stubFetch();
    const adapter = new OpenAiChatAdapter(BASE);

    await adapter
      .step({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        maxTokens: 64,
        timeoutMs: 1_000,
      })
      .catch(() => undefined);

    const messages = calls[0]?.body.messages as Array<{ role: string; content: unknown }>;
    expect(messages.find((message) => message.role === "user")?.content).toBe("hi");
  });

  it("openai-responses sends input_image parts", async () => {
    const calls = stubFetch();
    const adapter = new OpenAiResponsesAdapter({ ...BASE, protocol: "openai-responses" });

    await adapter
      .step({
        system: "s",
        messages: [USER_WITH_IMAGE],
        tools: [],
        maxTokens: 64,
        timeoutMs: 1_000,
      })
      .catch(() => undefined);

    const input = calls[0]?.body.input as Array<{ role?: string; content?: unknown }>;
    const user = input.find((item) => item.role === "user");
    const parts = user?.content as Array<Record<string, unknown>>;
    expect(parts[1]).toEqual({ type: "input_image", image_url: IMAGE.dataUrl });
  });

  it("anthropic-messages sends base64 image blocks", async () => {
    const calls = stubFetch();
    const adapter = new AnthropicMessagesAdapter({ ...BASE, protocol: "anthropic-messages" });

    await adapter
      .step({
        system: "s",
        messages: [USER_WITH_IMAGE],
        tools: [],
        maxTokens: 64,
        timeoutMs: 1_000,
      })
      .catch(() => undefined);

    const messages = calls[0]?.body.messages as Array<{ role: string; content: unknown }>;
    const user = messages.find((message) => message.role === "user");
    const parts = user?.content as Array<Record<string, unknown>>;
    expect(parts[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "QUJD" },
    });
  });
});

describe("reasoningEffort forwarding", () => {
  it("forwards the upstream value verbatim on openai-chat", async () => {
    const calls = stubFetch();
    const adapter = new OpenAiChatAdapter({ ...BASE, reasoningEffort: "high" });

    await adapter
      .step({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        maxTokens: 64,
        timeoutMs: 1_000,
      })
      .catch(() => undefined);

    expect(calls[0]?.body.reasoning_effort).toBe("high");
  });

  it("expresses \"none\" by omitting the parameter", async () => {
    const calls = stubFetch();
    const adapter = new OpenAiChatAdapter({ ...BASE, reasoningEffort: "none" });

    await adapter
      .step({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        maxTokens: 64,
        timeoutMs: 1_000,
      })
      .catch(() => undefined);

    expect("reasoning_effort" in (calls[0]?.body ?? {})).toBe(false);
  });

  it("forwards reasoning.effort on openai-responses and nothing on anthropic", async () => {
    const calls = stubFetch();

    await new OpenAiResponsesAdapter({
      ...BASE,
      protocol: "openai-responses",
      reasoningEffort: "medium",
    })
      .step({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        maxTokens: 64,
        timeoutMs: 1_000,
      })
      .catch(() => undefined);
    expect(calls[0]?.body.reasoning).toEqual({ effort: "medium" });

    await new AnthropicMessagesAdapter({
      ...BASE,
      protocol: "anthropic-messages",
      reasoningEffort: "medium",
    })
      .step({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        maxTokens: 64,
        timeoutMs: 1_000,
      })
      .catch(() => undefined);
    // No equivalent field exists on Messages; nothing is fabricated.
    expect("reasoning" in (calls[1]?.body ?? {})).toBe(false);
  });
});

describe("model allow-list", () => {
  it("always includes the configured model first, then the operator list", () => {
    expect(parseAllowedModels({}, "openai/gpt-4o-mini")).toEqual(["openai/gpt-4o-mini"]);
    expect(
      parseAllowedModels(
        { AI_ALLOWED_MODELS: " moonshotai/kimi-k2.5 , openai/gpt-4o-mini , ,google/gemini-2.0 " },
        "openai/gpt-4o-mini",
      ),
    ).toEqual(["openai/gpt-4o-mini", "moonshotai/kimi-k2.5", "google/gemini-2.0"]);
  });

  it("recomputes the list from the merged (stored > env) model", () => {
    const { settings } = resolveAiSettingsFromStored({
      env: { AI_MODEL: "env/model", AI_ALLOWED_MODELS: "extra/model" },
      stored: { "ai.model": "stored/model" },
    });
    expect(settings.model).toBe("stored/model");
    expect(settings.allowedModels?.[0]).toBe("stored/model");
    expect(settings.allowedModels).toContain("extra/model");
  });
});