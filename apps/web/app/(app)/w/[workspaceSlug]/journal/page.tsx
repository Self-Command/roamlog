import type { Metadata } from "next";

import { JournalLive } from "./journal-live";

export const metadata: Metadata = { title: "日志" };

export default async function JournalPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <JournalLive workspaceSlug={workspaceSlug} />;
}