-- AI conversation persistence (0015).
--
-- Ported from vercel/chatbot `lib/db/schema.ts` (commit
-- a8989b522fa3672a2ae52f053105e40993b36ca1): `Chat` (L28-L40),
-- `Message_v2` (L42-L53) and `Stream` (L120-L136), adapted to Prisma 7 and the
-- Roamlog schema conventions.
--
-- Additive by design:
--   * three brand-new enum types;
--   * three brand-new tables (`AiConversation`, `AiMessage`, `AiStream`);
--   * their indexes and foreign keys.
-- No existing column is retyped, no row is deleted or rewritten, and no
-- existing table is altered: this migration only creates new objects.
--
-- `AiMessage.content` is JSONB (assistant-ui `ThreadMessageLike` content, text
-- and tool parts together); stream event buffering stays in Redis and
-- `AiStream` only tracks lifecycle metadata.

-- CreateEnum
CREATE TYPE "AiConversationStatus" AS ENUM ('regular', 'archived');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "AiStreamStatus" AS ENUM ('active', 'completed', 'aborted', 'failed');

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(120),
    "titleSource" VARCHAR(16) NOT NULL DEFAULT 'placeholder',
    "status" "AiConversationStatus" NOT NULL DEFAULT 'regular',
    "lastMessageAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "parentId" UUID,
    "role" "AiMessageRole" NOT NULL,
    "content" JSONB NOT NULL,
    "status" JSONB,
    "clientId" VARCHAR(64),
    "runId" VARCHAR(32),
    "modelContext" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiStream" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID,
    "status" "AiStreamStatus" NOT NULL DEFAULT 'active',
    "lastEventId" INTEGER NOT NULL DEFAULT 0,
    "errorCode" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AiStream_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiConversation_workspaceId_userId_status_lastMessageAt_idx" ON "AiConversation"("workspaceId", "userId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AiConversation_workspaceId_lastMessageAt_idx" ON "AiConversation"("workspaceId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AiConversation_userId_lastMessageAt_idx" ON "AiConversation"("userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_parentId_idx" ON "AiMessage"("conversationId", "parentId");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_role_createdAt_idx" ON "AiMessage"("conversationId", "role", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiMessage_conversationId_clientId_key" ON "AiMessage"("conversationId", "clientId");

-- CreateIndex
CREATE INDEX "AiStream_conversationId_createdAt_idx" ON "AiStream"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiStream_status_createdAt_idx" ON "AiStream"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiStream" ADD CONSTRAINT "AiStream_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiStream" ADD CONSTRAINT "AiStream_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
