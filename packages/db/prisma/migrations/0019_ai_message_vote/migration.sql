CREATE TABLE "AiMessageVote" (
    "messageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "isUpvoted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMessageVote_pkey" PRIMARY KEY ("messageId","userId")
);

CREATE INDEX "AiMessageVote_conversationId_userId_idx" ON "AiMessageVote"("conversationId", "userId");

CREATE INDEX "AiMessageVote_workspaceId_conversationId_idx" ON "AiMessageVote"("workspaceId", "conversationId");

ALTER TABLE "AiMessageVote" ADD CONSTRAINT "AiMessageVote_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AiMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiMessageVote" ADD CONSTRAINT "AiMessageVote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiMessageVote" ADD CONSTRAINT "AiMessageVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
