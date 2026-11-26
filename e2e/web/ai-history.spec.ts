import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

import { OWNER_ACCOUNT, WEB_URL, WORKSPACE_SLUG, loginOnWeb } from "../support/accounts";

interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

const requireFromDb = createRequire(path.resolve("packages/db/package.json"));
const { Client } = requireFromDb("pg") as {
  Client: new (config: { connectionString: string }) => PgClient;
};

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.E2E_SMOKE_DATABASE_URL ??
  "postgresql://roamlog:roamlog@127.0.0.1:5432/roamlog?schema=public";

const CONVERSATIONS = [
  {
    id: "019a2000-0000-7000-8000-000000000001",
    title: "验收历史 A",
    userClientId: "history-a-user",
    assistantClientId: "history-a-assistant",
    userMessageId: "019a2000-0000-7000-8000-000000000011",
    assistantMessageId: "019a2000-0000-7000-8000-000000000012",
    question: "历史问题 A",
    answer: "历史回答 A",
  },
  {
    id: "019a2000-0000-7000-8000-000000000002",
    title: "验收历史 B",
    userClientId: "history-b-user",
    assistantClientId: "history-b-assistant",
    userMessageId: "019a2000-0000-7000-8000-000000000021",
    assistantMessageId: "019a2000-0000-7000-8000-000000000022",
    question: "历史问题 B",
    answer: "历史回答 B",
  },
] as const;

let client: PgClient;

test.beforeAll(async () => {
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const user = await client.query('select id from "User" where email = $1 limit 1', [
    OWNER_ACCOUNT.email,
  ]);
  const workspace = await client.query('select id from "Workspace" where slug = $1 limit 1', [
    WORKSPACE_SLUG,
  ]);
  const userId = user.rows[0]?.id;
  const workspaceId = workspace.rows[0]?.id;
  if (typeof userId !== "string" || typeof workspaceId !== "string") {
    throw new Error(`Missing AI history fixture user/workspace: ${OWNER_ACCOUNT.email}`);
  }

  await client.query('delete from "AiConversation" where id = any($1::uuid[])', [
    CONVERSATIONS.map((entry) => entry.id),
  ]);
  for (const conversation of CONVERSATIONS) {
    await client.query(
      `insert into "AiConversation"
        (id, "workspaceId", "userId", title, "titleSource", "lastMessageAt", "createdAt", "updatedAt")
       values ($1, $2, $3, $4, 'manual', now(), now(), now())`,
      [conversation.id, workspaceId, userId, conversation.title],
    );
    await client.query(
      `insert into "AiMessage"
        (id, "conversationId", "parentId", role, content, status, "clientId", "createdAt", "updatedAt")
       values ($1, $2, null, 'user'::"AiMessageRole", $3::jsonb, $4::jsonb, $5, now(), now())`,
      [
        conversation.userMessageId,
        conversation.id,
        JSON.stringify([{ type: "text", text: conversation.question }]),
        JSON.stringify({ type: "complete" }),
        conversation.userClientId,
      ],
    );
    await client.query(
      `insert into "AiMessage"
        (id, "conversationId", "parentId", role, content, status, "clientId", "createdAt", "updatedAt")
       values ($1, $2, $3, 'assistant'::"AiMessageRole", $4::jsonb, $5::jsonb, $6, now(), now())`,
      [
        conversation.assistantMessageId,
        conversation.id,
        conversation.userMessageId,
        JSON.stringify([{ type: "text", text: conversation.answer }]),
        JSON.stringify({ type: "complete" }),
        conversation.assistantClientId,
      ],
    );
  }
});

test.afterAll(async () => {
  if (!client) return;
  await client.query('delete from "AiConversation" where id = any($1::uuid[])', [
    CONVERSATIONS.map((entry) => entry.id),
  ]);
  await client.end();
});

async function openAi(page: import("@playwright/test").Page): Promise<void> {
  await loginOnWeb(page, OWNER_ACCOUNT);
  await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}/ai`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });
}

function thread(page: import("@playwright/test").Page, title: string) {
  return page.getByTestId("thread-list-item").filter({ hasText: title }).first();
}

test("conversation history survives reload, thread switching and re-login", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openAi(page);

  await expect(thread(page, CONVERSATIONS[0].title)).toBeVisible({ timeout: 30_000 });
  await expect(thread(page, CONVERSATIONS[1].title)).toBeVisible({ timeout: 30_000 });

  await thread(page, CONVERSATIONS[0].title).click();
  await expect(page.getByText(CONVERSATIONS[0].question, { exact: true })).toBeVisible();
  await expect(page.getByText(CONVERSATIONS[0].answer, { exact: true })).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(CONVERSATIONS[0].question, { exact: true })).toBeVisible();
  await expect(page.getByText(CONVERSATIONS[0].answer, { exact: true })).toBeVisible();

  await thread(page, CONVERSATIONS[1].title).click();
  await expect(page.getByText(CONVERSATIONS[1].question, { exact: true })).toBeVisible();
  await expect(page.getByText(CONVERSATIONS[1].answer, { exact: true })).toBeVisible();

  await thread(page, CONVERSATIONS[0].title).click();
  await expect(page.getByText(CONVERSATIONS[0].question, { exact: true })).toBeVisible();

  await page.context().clearCookies();
  await openAi(page);
  await expect(thread(page, CONVERSATIONS[0].title)).toBeVisible({ timeout: 30_000 });
  await expect(thread(page, CONVERSATIONS[1].title)).toBeVisible({ timeout: 30_000 });
});
