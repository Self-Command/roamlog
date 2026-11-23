import type { Metadata } from "next";

import { AiAssistant } from "@/components/ai/ai-assistant";

export const metadata: Metadata = { title: "AI 助手" };

export default async function AiPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ conversation?: string | string[] }>;
}) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const conversation = Array.isArray(query.conversation)
    ? query.conversation[0]
    : query.conversation;
  const initialConversationId = conversation?.trim() || undefined;

  return (
    <AiAssistant
      workspaceSlug={workspaceSlug}
      {...(initialConversationId ? { initialConversationId } : {})}
    />
  );
}
