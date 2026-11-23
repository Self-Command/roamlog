import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  SetAiMessageVoteRequestSchema,
  UuidV7Schema,
  type AiMessageVote,
  type SetAiMessageVoteRequest,
} from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Persisted assistant-message feedback.
 *
 * Ported from vercel/chatbot
 * `lib/db/queries.ts:269-307` and `app/(chat)/api/vote/route.ts:44-91`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0).
 *
 * Adaptation layer: Roamlog scopes votes by workspace, conversation and user;
 * assistant-ui message ids may be client ids, so the service resolves either
 * the persisted UUID or the client id before writing the vote.
 */
@Injectable()
export class AiMessageVoteService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<readonly AiMessageVote[]> {
    await this.requireConversation(userId, workspaceId, conversationId);
    const rows = await this.prisma.client.aiMessageVote.findMany({
      where: { userId, workspaceId, conversationId },
      select: {
        isUpvoted: true,
        message: { select: { id: true, clientId: true } },
      },
    });
    return rows.map((row) => ({
      messageId: row.message.clientId ?? row.message.id,
      isUpvoted: row.isUpvoted,
    }));
  }

  async set(
    userId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
    rawInput: unknown,
  ): Promise<AiMessageVote> {
    await this.requireConversation(userId, workspaceId, conversationId);
    const input = parseVote(rawInput);
    const message = await this.findMessage(conversationId, messageId);
    if (!message) {
      throw new NotFoundException({
        code: "AI_MESSAGE_NOT_FOUND",
        message: "The assistant message was not found.",
      });
    }

    await this.prisma.client.aiMessageVote.upsert({
      where: { messageId_userId: { messageId: message.id, userId } },
      create: {
        messageId: message.id,
        userId,
        workspaceId,
        conversationId,
        isUpvoted: input.type === "up",
      },
      update: { isUpvoted: input.type === "up" },
    });

    return {
      messageId: message.clientId ?? message.id,
      isUpvoted: input.type === "up",
    };
  }

  private async requireConversation(
    userId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.prisma.client.aiConversation.findFirst({
      where: { id: conversationId, workspaceId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!conversation) {
      throw new NotFoundException({
        code: "AI_CONVERSATION_NOT_FOUND",
        message: "The AI conversation was not found.",
      });
    }
  }

  private async findMessage(conversationId: string, messageId: string) {
    const where = UuidV7Schema.safeParse(messageId).success
      ? { conversationId, OR: [{ id: messageId }, { clientId: messageId }] }
      : { conversationId, clientId: messageId };
    return this.prisma.client.aiMessage.findFirst({
      where,
      select: { id: true, clientId: true },
    });
  }
}

function parseVote(rawInput: unknown): SetAiMessageVoteRequest {
  const parsed = SetAiMessageVoteRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "INVALID_AI_VOTE",
      message: "Vote type must be either up or down.",
    });
  }
  return parsed.data;
}
