-- Port of vercel/chatbot `Chat.visibility` (a8989b52, lib/db/schema.ts:35)
-- plus Roamlog's opaque public-share identifier and revocation revision.
--
-- Additive: existing conversations stay private, keep revision 0 and have no
-- share id until the owner explicitly enables sharing.

CREATE TYPE "AiConversationVisibility" AS ENUM ('private', 'public');

ALTER TABLE "AiConversation"
    ADD COLUMN "visibility" "AiConversationVisibility" NOT NULL DEFAULT 'private',
    ADD COLUMN "shareId" UUID,
    ADD COLUMN "shareRevision" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "AiConversation_shareId_key" ON "AiConversation"("shareId");
