import type { Metadata } from "next";
import { JournalWorkspace } from "@/components/journal/journal-workspace";

export const metadata: Metadata = { title: "日志" };

export default async function JournalPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return <JournalWorkspace workspaceSlug={workspaceSlug} />;
}
