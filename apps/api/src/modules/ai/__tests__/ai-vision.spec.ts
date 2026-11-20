/**
 * `vision` truthfulness (`AI_VISION_TRUTH`).
 *
 * A deployment used to report `vision: true` for every model because the
 * gateway's `/v1/models` claims `modalities.input: ["text","image"]`. The model
 * could not read an image: the gateway answered 200 with empty content and a
 * reasoning trace that said the visual analysis was skipped. The contract says
 * the capability is "declared by the operator, never guessed" — these tests pin
 * that: off unless `AI_VISION_SUPPORTED` is set, and when it is off no image
 * part ever reaches the model while the conversation still keeps its image
 * parts.
 */

import { AiChatModelsResponseSchema } from "@roamlog/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiProtocolAdapter } from "../adapters/adapter.js";
import { OpenAiChatAdapter } from "../adapters/openai-chat.adapter.js";
import { AiPlanService } from "../ai-plan.service.js";
import {
  resolveAiSettings,
  resolveAiSettingsFromStored,
  staticAiSettingsSource,
  type AiSettings,
} from "../ai.settings.js";
import { AiToolbox } from "../ai-tools.js";
import {
  actorStub,
  aiSettings,
  fixedClock,
  loggerStub,
  membershipStub,
  quotaStub,
  runStoreStub,
  scriptedAdapter,
  toolServiceMocks,
} from "./ai-fixtures.js";

const ATTACHMENT = {
  mediaId: "01942f30-1200-7000-8000-000000000301",
  kind: "image" as const,
  name: "kyoto.png",
  mimeType: "image/png" as const,
  sizeBytes: 1_024,
};

const MEDIA_URL = "https://media.test/kyoto.png";

function mediaStub() {
  return {
    getOne: vi.fn().mockResolvedValue({
      id: ATTACHMENT.mediaId,
      mimeType: ATTACHMENT.mimeType,
      status: "ready",
      url: MEDIA_URL,
      thumbUrl: null,
    }),
  };
}

function conversationsStub() {
  return {
    getOrCreate: vi.fn().mockResolvedValue({ id: "conversation-1", title: null }),
    loadContext: vi.fn().mockResolvedValue({ messages: [], facts: {} }),
    appendUserMessage: vi
      .fn()
      .mockResolvedValue({ messageId: "message-user-1", clientId: "client-1", created: true }),
    startStream: vi.fn().mockResolvedValue({ streamId: "stream-1" }),
    finishAssistantMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function buildService(settings: AiSettings, options: {
  adapter: AiProtocolAdapter;
  conversations?: ReturnType<typeof conversationsStub>;
  media?: ReturnType<typeof mediaStub>;
}): AiPlanService {
  const tools = toolServiceMocks();
  const toolbox = new AiToolbox(
    tools.places as never,
    tools.trips as never,
    tools.stops as never,
    tools.itinerary as never,
    tools.packing as never,
  );
  return new AiPlanService(
    staticAiSettingsSource(settings),
    () => options.adapter,
    toolbox,
    quotaStub() as never,
    runStoreStub() as never,
    loggerStub() as never,
    fixedClock(),
    options.conversations as never,
    undefined,
    options.media as never,
  );
}

/** Stubs the object-store read so an inlined image has real bytes to encode. */
function stubMediaFetch() {
  const fetchMock = vi.fn(
    async () =>
      new Response(Buffer.from("PNGDATA"), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Consumes a stream without asserting on its frames. */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const event of stream) {
    void event;
  }
}

/** The model-facing text of the first user turn the adapter received. */
function firstUserContent(adapter: {
  readonly inputs: readonly { readonly messages: readonly unknown[] }[];
}): string {
  const last = adapter.inputs[0]?.messages.at(-1) as { content?: unknown } | undefined;
  return String(last?.content ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vision setting resolution", () => {
  it("defaults to false when AI_VISION_SUPPORTED is unset, empty or unrecognised", () => {
    expect(resolveAiSettings({}).vision).toBe(false);
    expect(resolveAiSettings({ AI_VISION_SUPPORTED: "" }).vision).toBe(false);
    expect(resolveAiSettings({ AI_VISION_SUPPORTED: "   " }).vision).toBe(false);
    expect(resolveAiSettings({ AI_VISION_SUPPORTED: "maybe" }).vision).toBe(false);
    expect(resolveAiSettings({ AI_VISION_SUPPORTED: "false" }).vision).toBe(false);
    expect(resolveAiSettings({ AI_VISION_SUPPORTED: "0" }).vision).toBe(false);
  });

  it("only an explicit operator opt-in turns vision on", () => {
    for (const value of ["true", "TRUE", " 1 ", "yes", "on"]) {
      expect(resolveAiSettings({ AI_VISION_SUPPORTED: value }).vision).toBe(true);
    }
  });

  it("lets a stored ai.vision row override the environment, and an env-locked key win", () => {
    const storedWins = resolveAiSettingsFromStored({
      env: { AI_VISION_SUPPORTED: "true" },
      stored: { "ai.vision": false },
    });
    expect(storedWins.settings.vision).toBe(false);

    const storedOn = resolveAiSettingsFromStored({
      env: {},
      stored: { "ai.vision": true },
    });
    expect(storedOn.settings.vision).toBe(true);

    const locked = resolveAiSettingsFromStored({
      env: { AI_VISION_SUPPORTED: "true" },
      stored: { "ai.vision": false },
      envLockOf: (key) =>
        key === "ai.vision" ? { envLocked: true, envVar: "AI_VISION_SUPPORTED" } : undefined,
    });
    expect(locked.settings.vision).toBe(true);
    expect(locked.ignored).toEqual([]);
  });
});

describe("chatModels() vision", () => {
  async function modelsFor(settings: AiSettings) {
    // `baseUrl: null` keeps `gatewayModelNames` offline; the display name falls
    // back to `readableModelName`, which is irrelevant here.
    const adapter = scriptedAdapter([{ text: "ok", toolCalls: [] }]);
    const response = await buildService(settings, { adapter }).chatModels();
    return AiChatModelsResponseSchema.parse(response);
  }

  it("returns vision:false when the setting is not configured", async () => {
    const response = await modelsFor(aiSettings({ baseUrl: null }));
    expect(response.models).toHaveLength(1);
    expect(response.models[0]?.vision).toBe(false);
  });

  it("returns vision:false when the operator keeps it off", async () => {
    const response = await modelsFor(aiSettings({ baseUrl: null, vision: false }));
    expect(response.models[0]?.vision).toBe(false);
  });

  it("returns vision:true only after the operator enables it", async () => {
    const response = await modelsFor(aiSettings({ baseUrl: null, vision: true }));
    expect(response.models[0]?.vision).toBe(true);
  });
});

describe("vision:false keeps images out of the model, not out of the conversation", () => {
  it("streamChat: no image part in the model messages, image part in the stored turn", async () => {
    const fetchMock = stubMediaFetch();
    const adapter = scriptedAdapter([{ text: "好的", toolCalls: [] }]);
    const conversations = conversationsStub();
    const media = mediaStub();
    const service = buildService(aiSettings({ vision: false }), {
      adapter,
      conversations,
      media,
    });

    await drain(
      service.streamChat(actorStub(), membershipStub(), {
        message: "这张照片是什么颜色？",
        attachments: [ATTACHMENT],
      }),
    );

    // Model input: text only, no `images` key at all.
    const modelTurn = adapter.inputs[0]?.messages.at(-1);
    expect(modelTurn).toMatchObject({ role: "user" });
    expect("images" in (modelTurn ?? {})).toBe(false);
    expect(JSON.stringify(modelTurn)).not.toContain("base64");
    // The bytes were never fetched from the object store.
    expect(fetchMock).not.toHaveBeenCalled();

    // Persisted turn: the image part is still there, so the thumbnail survives
    // a reload and the conversation keeps the user's attachment.
    const stored = conversations.appendUserMessage.mock.calls[0]?.[0] as {
      content?: readonly Record<string, unknown>[];
    };
    const imageParts = (stored.content ?? []).filter((part) => part.type === "image");
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0]?.["providerMetadata"]).toMatchObject({
      roamlog: { mediaId: ATTACHMENT.mediaId, kind: "image" },
    });
  });

  it("streamChat: tells the model it cannot see the attached images", async () => {
    stubMediaFetch();
    const adapter = scriptedAdapter([{ text: "好的", toolCalls: [] }]);
    const service = buildService(aiSettings({ vision: false }), {
      adapter,
      conversations: conversationsStub(),
      media: mediaStub(),
    });

    await drain(
      service.streamChat(actorStub(), membershipStub(), {
        message: "这张照片是什么颜色？",
        attachments: [ATTACHMENT],
      }),
    );

    const content = firstUserContent(adapter);
    expect(content).toContain("用户附了 1 张图片");
    expect(content).toContain("当前模型无法查看图片内容");
    expect(content).toContain("不要编造图片内容");
    // The envelope is untouched; the note is appended after it, never inside.
    expect(JSON.parse(content.split("\n\n")[0] ?? "{}")).toEqual({
      request: "这张照片是什么颜色？",
      hints: {},
    });
  });

  it("streamChat: the note is absent when vision is on", async () => {
    stubMediaFetch();
    const adapter = scriptedAdapter([{ text: "好的", toolCalls: [] }]);
    const service = buildService(aiSettings({ vision: true }), {
      adapter,
      conversations: conversationsStub(),
      media: mediaStub(),
    });

    await drain(
      service.streamChat(actorStub(), membershipStub(), {
        message: "这张照片是什么颜色？",
        attachments: [ATTACHMENT],
      }),
    );

    const content = firstUserContent(adapter);
    expect(content).not.toContain("无法查看图片内容");
  });

  it("streamChat: a turn without attachments keeps the prompt byte for byte", async () => {
    const adapter = scriptedAdapter([{ text: "好的", toolCalls: [] }]);
    const service = buildService(aiSettings({ vision: false }), {
      adapter,
      conversations: conversationsStub(),
    });

    await drain(
      service.streamChat(actorStub(), membershipStub(), {
        message: "帮我做个三天行程",
        hints: { destinations: ["Kyoto"] },
      }),
    );

    expect(firstUserContent(adapter)).toBe(
      JSON.stringify({ request: "帮我做个三天行程", hints: { destinations: ["Kyoto"] } }),
    );
  });

  it("streamChat: the notice counts every attachment, not a hard-coded 1", async () => {
    const media = {
      getOne: vi.fn(async (_actor: unknown, _membership: unknown, mediaId: string) => ({
        id: mediaId,
        mimeType: "image/png",
        status: "ready",
        url: `https://media.test/${mediaId}.png`,
        thumbUrl: null,
      })),
    };
    const adapter = scriptedAdapter([{ text: "好的", toolCalls: [] }]);
    const conversations = conversationsStub();
    const service = buildService(aiSettings({ vision: false }), {
      adapter,
      conversations,
      media: media as never,
    });
    const three = ["301", "302", "303"].map((suffix) => ({
      ...ATTACHMENT,
      mediaId: `01942f30-1200-7000-8000-000000000${suffix}`,
    }));

    await drain(
      service.streamChat(actorStub(), membershipStub(), {
        message: "这三张照片是哪里的？",
        attachments: three,
      }),
    );

    const content = firstUserContent(adapter);
    expect(content).toContain("用户附了 3 张图片");
    expect(content).not.toContain("用户附了 1 张图片");
    // Every attachment is still persisted for the conversation.
    const stored = conversations.appendUserMessage.mock.calls[0]?.[0] as {
      content?: readonly Record<string, unknown>[];
    };
    expect((stored.content ?? []).filter((part) => part.type === "image")).toHaveLength(3);
  });

  it("streamChat: no image part reaches the model while the notice and the stored image both exist", async () => {
    stubMediaFetch();
    const adapter = scriptedAdapter([{ text: "好的", toolCalls: [] }]);
    const conversations = conversationsStub();
    const service = buildService(aiSettings({ vision: false }), {
      adapter,
      conversations,
      media: mediaStub(),
    });

    await drain(
      service.streamChat(actorStub(), membershipStub(), {
        message: "这张照片是什么颜色？",
        attachments: [ATTACHMENT],
      }),
    );

    // Two facts at once: the model gets no image content ...
    const modelTurn = adapter.inputs[0]?.messages.at(-1) as
      | { content?: unknown; images?: unknown }
      | undefined;
    expect("images" in (modelTurn ?? {})).toBe(false);
    // ... but it *is* told about the attachment, and the stored turn keeps it.
    expect(String(modelTurn?.content)).toContain("当前模型无法查看图片内容");
    const stored = conversations.appendUserMessage.mock.calls[0]?.[0] as {
      content?: readonly Record<string, unknown>[];
    };
    expect((stored.content ?? []).filter((part) => part.type === "image")).toHaveLength(1);
  });

  it("streamChat: with vision on the same turn does carry an image part", async () => {
    stubMediaFetch();
    const adapter = scriptedAdapter([{ text: "好的", toolCalls: [] }]);
    const service = buildService(aiSettings({ vision: true }), {
      adapter,
      conversations: conversationsStub(),
      media: mediaStub(),
    });

    await drain(
      service.streamChat(actorStub(), membershipStub(), {
        message: "这张照片是什么颜色？",
        attachments: [ATTACHMENT],
      }),
    );

    const modelTurn = adapter.inputs[0]?.messages.at(-1) as {
      images?: readonly { dataUrl: string }[];
    };
    expect(modelTurn.images?.[0]?.dataUrl).toBe(
      "data:image/png;base64,UE5HREFUQQ==",
    );
  });

  it("chat(): validates the attachment but still sends no image part", async () => {
    const fetchMock = stubMediaFetch();
    const adapter = scriptedAdapter([{ text: "好的", toolCalls: [] }]);
    const service = buildService(aiSettings({ vision: false }), {
      adapter,
      media: mediaStub(),
    });

    await service.chat(actorStub(), membershipStub(), {
      message: "这张照片是什么颜色？",
      attachments: [ATTACHMENT],
    });

    const modelTurn = adapter.inputs[0]?.messages.at(-1) as
      | { content?: unknown; images?: unknown }
      | undefined;
    expect("images" in (modelTurn ?? {})).toBe(false);
    // The blocking endpoint carries the same disclosure as the stream.
    expect(String(modelTurn?.content)).toContain("当前模型无法查看图片内容");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the real OpenAI wire body carries no image_url part with vision off", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "好的" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const scripted = scriptedAdapter([{ text: "好的", toolCalls: [] }]);
    const service = buildService(aiSettings({ vision: false }), {
      adapter: scripted,
      conversations: conversationsStub(),
      media: mediaStub(),
    });
    await drain(
      service.streamChat(actorStub(), membershipStub(), {
        message: "这张照片是什么颜色？",
        attachments: [ATTACHMENT],
      }),
    );

    // The exact messages the planner produced, sent through the real adapter:
    // the request body the gateway would receive, captured here.
    const messages = scripted.inputs[0]?.messages ?? [];
    const adapter = new OpenAiChatAdapter(aiSettings({ vision: false }));
    await adapter
      .step({ system: "s", messages, tools: [], maxTokens: 64, timeoutMs: 1_000 })
      .catch(() => undefined);

    const user = (bodies[0]?.["messages"] as Array<{ role: string; content: unknown }>).find(
      (message) => message.role === "user",
    );
    expect(typeof user?.content).toBe("string");
    expect(JSON.stringify(bodies[0] ?? {})).not.toContain("image_url");
  });

  it("chat(): an unusable attachment is still a 400 with vision off", async () => {
    const media = mediaStub();
    media.getOne.mockRejectedValueOnce(new Error("not in this workspace"));
    const service = buildService(aiSettings({ vision: false }), {
      adapter: scriptedAdapter([{ text: "ok", toolCalls: [] }]),
      media,
    });

    const error = await service
      .chat(actorStub(), membershipStub(), {
        message: "这张照片是什么颜色？",
        attachments: [ATTACHMENT],
      })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect((error as { getStatus?: () => number } | undefined)?.getStatus?.()).toBe(400);
    expect((error as { getResponse?: () => { code?: string } })?.getResponse?.().code).toBe(
      "AI_ATTACHMENT_INVALID",
    );
  });
});