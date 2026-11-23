import { NotFoundException } from "@nestjs/common";
import type { AiSettings } from "../ai.settings.js";
import type { AiSettingsResolver } from "../ai.settings.js";
import type { AiAdapterFactory } from "../adapters/index.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import type { AppConfigService } from "../../../config/app-config.service.js";
import type { MediaUrlService } from "../../media/media-url.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { describe, expect, it, vi } from "vitest";

import {
  AiConversationService,
  createAiConversationShareToken,
  parseAiConversationShareToken,
} from "../ai-conversation.service.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const CONVERSATION_ID = "01942f30-1200-7000-8000-000000000003";
const SHARE_ID = "01942f30-1200-7000-8000-000000000004";
const USER_MESSAGE_ID = "01942f30-1200-7000-8000-000000000005";
const ASSISTANT_MESSAGE_ID = "01942f30-1200-7000-8000-000000000006";
const SECRET = "test-only-secret-that-is-at-least-32-bytes";
const CREATED_AT = new Date("2026-11-20T08:00:00.000Z");

const settings: AiSettings = {
  protocol: "openai-chat",
  baseUrl: null,
  apiKey: null,
  model: "",
  allowedModels: [],
  timeoutMs: 30_000,
  maxOutputTokens: 4_096,
  dailyQuota: 20,
  configured: false,
};

function conversationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CONVERSATION_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    title: "京都慢游",
    titleSource: "manual",
    status: "regular",
    visibility: "private",
    shareId: null,
    shareRevision: 0,
    lastMessageAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: USER_MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    parentId: null,
    role: "user",
    content: [
      { type: "text", text: "帮我规划京都。" },
      {
        type: "image",
        image: "https://cdn.example.test/kyoto.webp",
        filename: "kyoto.webp",
      },
    ],
    status: null,
    clientId: "local-user",
    modelContext: { secret: "internal" },
    metadata: { provider: "secret" },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeService(
  client: Record<string, unknown>,
  mediaUrls?: MediaUrlService,
): AiConversationService {
  return new AiConversationService(
    { client } as unknown as PrismaService,
    { resolve: async () => settings } as unknown as AiSettingsResolver,
    (() => undefined) as AiAdapterFactory,
    {
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    } as unknown as PinoLoggerService,
    () => CREATED_AT,
    {
      appUrl: "https://we.spacedo.org",
      betterAuthSecret: SECRET,
    } as unknown as AppConfigService,
    mediaUrls,
  );
}

describe("AI conversation public sharing", () => {
  it("creates and verifies an opaque token bound to the share revision", () => {
    const token = createAiConversationShareToken(SHARE_ID, 3, SECRET);
    expect(token).not.toContain(CONVERSATION_ID);
    expect(token).not.toContain(WORKSPACE_ID);
    expect(parseAiConversationShareToken(token, SECRET)).toEqual({
      shareId: SHARE_ID,
      revision: 3,
    });
    expect(parseAiConversationShareToken(`${token}x`, SECRET)).toBeNull();
    expect(parseAiConversationShareToken(token, `${SECRET}-different`)).toBeNull();
  });

  it("turns private into a signed public URL and revokes it on the next transition", async () => {
    let current = conversationRow();
    let generatedShareId: string | null = null;
    const aiConversation = {
      findFirst: vi.fn(async () => current),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        generatedShareId =
          typeof data.shareId === "string" ? data.shareId : (current.shareId as string | null);
        current = {
          ...current,
          visibility: data.visibility as string,
          shareId: generatedShareId,
          shareRevision:
            (current.shareRevision as number) +
            ((data.shareRevision as { increment?: number } | undefined)?.increment ?? 0),
        };
        return { count: 1 };
      }),
    };
    const service = makeService({ aiConversation });

    const published = await service.setVisibility(USER_ID, WORKSPACE_ID, CONVERSATION_ID, {
      visibility: "public",
    });
    expect(published.visibility).toBe("public");
    expect(published.shareUrl).toMatch(/^https:\/\/we\.spacedo\.org\/share\/chat\/aic1\./);
    expect(generatedShareId).toBeTruthy();
    expect(generatedShareId).not.toBe(CONVERSATION_ID);

    const token = published.shareUrl?.split("/").at(-1) ?? "";
    expect(parseAiConversationShareToken(token, SECRET)).toEqual({
      shareId: generatedShareId,
      revision: 1,
    });

    const privateAgain = await service.setVisibility(USER_ID, WORKSPACE_ID, CONVERSATION_ID, {
      visibility: "private",
    });
    expect(privateAgain.visibility).toBe("private");
    expect(privateAgain.shareUrl).toBeNull();
    expect(current.shareRevision).toBe(2);
  });

  it("returns only the head branch's text and image parts, never tools or metadata", async () => {
    const row = conversationRow({
      visibility: "public",
      shareId: SHARE_ID,
      shareRevision: 4,
    });
    const aiConversation = {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.shareRevision === 4 && where.visibility === "public" ? row : null,
      ),
    };
    const aiMessage = {
      findMany: vi.fn(async () => [
        messageRow(),
        messageRow({
          id: ASSISTANT_MESSAGE_ID,
          parentId: USER_MESSAGE_ID,
          role: "assistant",
          clientId: "local-assistant",
          content: [
            { type: "text", text: "第一天去清水寺。" },
            { type: "reasoning", text: "private chain of thought" },
            {
              type: "tool-call",
              toolName: "trips.create",
              args: { internal: true },
            },
          ],
        }),
      ]),
    };
    const service = makeService({ aiConversation, aiMessage });
    const token = createAiConversationShareToken(SHARE_ID, 4, SECRET);

    const payload = await service.readPublic(token);
    expect(payload.title).toBe("京都慢游");
    expect(payload.isReadOnly).toBe(true);
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0]?.content).toEqual([
      { type: "text", text: "帮我规划京都。" },
      {
        type: "image",
        image: "https://cdn.example.test/kyoto.webp",
        filename: "kyoto.webp",
      },
    ]);
    expect(payload.messages[1]?.content).toEqual([{ type: "text", text: "第一天去清水寺。" }]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("reasoning");
    expect(serialized).not.toContain("tool-call");
    expect(serialized).not.toContain("provider");
    expect(serialized).not.toContain("clientId");
    expect(serialized).not.toContain(CONVERSATION_ID);
    expect(serialized).not.toContain(WORKSPACE_ID);
    expect(serialized).not.toContain(USER_ID);
  });

  it("re-signs public images from the Workspace-scoped media row", async () => {
    const row = conversationRow({
      visibility: "public",
      shareId: SHARE_ID,
      shareRevision: 5,
    });
    const aiConversation = {
      findFirst: vi.fn(async () => row),
    };
    const aiMessage = {
      findMany: vi.fn(async () => [
        messageRow({
          content: [
            {
              type: "image",
              image: "https://expired.example.test/old.webp",
              filename: "kyoto.webp",
              providerMetadata: {
                roamlog: {
                  mediaId: "01942f30-1200-7000-8000-000000000010",
                  mimeType: "image/webp",
                  sizeBytes: 100,
                  name: "kyoto.webp",
                },
              },
            },
          ],
        }),
      ]),
    };
    const media = {
      findMany: vi.fn(async () => [
        {
          id: "01942f30-1200-7000-8000-000000000010",
          key: "workspace/kyoto.webp",
          bucket: "roamlog",
          status: "ready",
          variants: { large: { key: "workspace/kyoto-large.webp" } },
          motion: null,
        },
      ]),
    };
    const mediaUrls = {
      signMany: vi.fn(
        async () =>
          new Map([
            [
              "01942f30-1200-7000-8000-000000000010",
              {
                url: "https://fresh.example.test/kyoto-large.webp",
                thumbUrl: null,
                motionUrl: null,
                expiresAt: "2026-11-20T09:00:00.000Z",
              },
            ],
          ]),
      ),
    } as unknown as MediaUrlService;
    const service = makeService({ aiConversation, aiMessage, media }, mediaUrls);

    const payload = await service.readPublic(createAiConversationShareToken(SHARE_ID, 5, SECRET));
    expect(payload.messages[0]?.content).toEqual([
      {
        type: "image",
        image: "https://fresh.example.test/kyoto-large.webp",
        filename: "kyoto.webp",
      },
    ]);
    expect(media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          status: "ready",
          deletedAt: null,
        }),
      }),
    );
  });

  it("treats a stale revision or private conversation as the same 404", async () => {
    const aiConversation = { findFirst: vi.fn(async () => null) };
    const service = makeService({ aiConversation });
    const stale = createAiConversationShareToken(SHARE_ID, 1, SECRET);

    await expect(service.readPublic(stale)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.readPublic(
        createAiConversationShareToken(SHARE_ID, 4, "wrong-secret".padEnd(32, "x")),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
