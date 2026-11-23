CREATE TYPE "AiArtifactKind" AS ENUM ('text', 'code', 'sheet', 'image');

CREATE TABLE "AiArtifact" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "conversationId" UUID,
    "title" VARCHAR(160) NOT NULL,
    "kind" "AiArtifactKind" NOT NULL,
    "content" TEXT NOT NULL,
    "mediaId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AiArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiArtifactVersion" (
    "id" UUID NOT NULL,
    "artifactId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiArtifactVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiArtifactSuggestion" (
    "id" UUID NOT NULL,
    "artifactId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "suggestedText" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiArtifactSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiArtifact_workspaceId_userId_updatedAt_idx"
    ON "AiArtifact"("workspaceId", "userId", "updatedAt");

CREATE INDEX "AiArtifact_conversationId_updatedAt_idx"
    ON "AiArtifact"("conversationId", "updatedAt");

CREATE UNIQUE INDEX "AiArtifactVersion_artifactId_version_key"
    ON "AiArtifactVersion"("artifactId", "version");

CREATE INDEX "AiArtifactVersion_artifactId_createdAt_idx"
    ON "AiArtifactVersion"("artifactId", "createdAt");

CREATE INDEX "AiArtifactSuggestion_artifactId_isResolved_createdAt_idx"
    ON "AiArtifactSuggestion"("artifactId", "isResolved", "createdAt");

ALTER TABLE "AiArtifact"
    ADD CONSTRAINT "AiArtifact_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiArtifact"
    ADD CONSTRAINT "AiArtifact_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiArtifact"
    ADD CONSTRAINT "AiArtifact_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiArtifactVersion"
    ADD CONSTRAINT "AiArtifactVersion_artifactId_fkey"
    FOREIGN KEY ("artifactId") REFERENCES "AiArtifact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiArtifactVersion"
    ADD CONSTRAINT "AiArtifactVersion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiArtifactSuggestion"
    ADD CONSTRAINT "AiArtifactSuggestion_artifactId_fkey"
    FOREIGN KEY ("artifactId") REFERENCES "AiArtifact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
