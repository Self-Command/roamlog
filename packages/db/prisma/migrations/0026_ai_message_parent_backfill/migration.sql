-- Repair assistant rows written before stream finalization linked the branch
-- parent. The API now writes `parentId` when it finalizes an assistant turn;
-- this backfills historical rows so a reloaded conversation follows the same
-- branch instead of starting at an orphaned assistant message.
--
-- Only assistant rows without a parent are touched. A row with no preceding
-- user message keeps `parentId = NULL`, because it is a legitimate root.

UPDATE "AiMessage" AS child
SET "parentId" = (
    SELECT parent."id"
    FROM "AiMessage" AS parent
    WHERE parent."conversationId" = child."conversationId"
      AND parent."role" = 'user'::"AiMessageRole"
      AND (
          parent."createdAt" < child."createdAt"
          OR (
              parent."createdAt" = child."createdAt"
              AND parent."id" < child."id"
          )
      )
    ORDER BY parent."createdAt" DESC, parent."id" DESC
    LIMIT 1
)
WHERE child."role" = 'assistant'::"AiMessageRole"
  AND child."parentId" IS NULL
  AND EXISTS (
      SELECT 1
      FROM "AiMessage" AS parent
      WHERE parent."conversationId" = child."conversationId"
        AND parent."role" = 'user'::"AiMessageRole"
        AND (
            parent."createdAt" < child."createdAt"
            OR (
                parent."createdAt" = child."createdAt"
                AND parent."id" < child."id"
            )
        )
  );
