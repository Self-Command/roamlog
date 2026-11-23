import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiMessageVoteService } from "../ai-message-vote.service.js";

const USER_ID = "01942f30-1200-7000-8000-000000000001";
const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000002";
const CONVERSATION_ID = "01942f30-1200-7000-8000-000000000003";
const MESSAGE_ID = "01942f30-1200-7000-8000-000000000004";

function makePrisma() {
  return {
    client: {
      aiConversation: {
        findFirst: vi.fn(),
      },
      aiMessage: {
        findFirst: vi.fn(),
      },
      aiMessageVote: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
    },
  };
}

describe("AiMessageVoteService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AiMessageVoteService;

  beforeEach(() => {
    prisma = makePrisma();
    prisma.client.aiConversation.findFirst.mockResolvedValue({ id: CONVERSATION_ID });
    service = new AiMessageVoteService(prisma as never);
  });

  it("lists the current user's votes using assistant-ui message ids", async () => {
    prisma.client.aiMessageVote.findMany.mockResolvedValue([
      {
        isUpvoted: true,
        message: { id: MESSAGE_ID, clientId: "client-message" },
      },
    ]);

    await expect(
      service.list(USER_ID, WORKSPACE_ID, CONVERSATION_ID),
    ).resolves.toEqual([{ messageId: "client-message", isUpvoted: true }]);
  });

  it("upserts one vote for the current message and user", async () => {
    prisma.client.aiMessage.findFirst.mockResolvedValue({
      id: MESSAGE_ID,
      clientId: "client-message",
    });
    prisma.client.aiMessageVote.upsert.mockResolvedValue({});

    await expect(
      service.set(USER_ID, WORKSPACE_ID, CONVERSATION_ID, "client-message", {
        type: "down",
      }),
    ).resolves.toEqual({ messageId: "client-message", isUpvoted: false });

    expect(prisma.client.aiMessageVote.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          messageId_userId: { messageId: MESSAGE_ID, userId: USER_ID },
        },
        update: { isUpvoted: false },
      }),
    );
  });

  it("rejects a conversation that does not belong to the user", async () => {
    prisma.client.aiConversation.findFirst.mockResolvedValue(null);

    await expect(
      service.list(USER_ID, WORKSPACE_ID, CONVERSATION_ID),
    ).rejects.toMatchObject({ response: { code: "AI_CONVERSATION_NOT_FOUND" } });
    expect(prisma.client.aiMessageVote.findMany).not.toHaveBeenCalled();
  });
});
