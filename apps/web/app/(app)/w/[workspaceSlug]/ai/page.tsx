import type { Metadata } from "next";

import { AiAssistant } from "@/components/ai/ai-assistant";

export const metadata: Metadata = { title: "AI 助手" };

export default async function AiPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <AiAssistant workspaceSlug={workspaceSlug} />;
}