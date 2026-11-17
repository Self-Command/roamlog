import type { Metadata } from "next";
import { JournalWorkspace } from "@/components/journal/journal-workspace";
import { DATA_MODE } from "@/lib/data-mode";

import { JournalLive } from "./journal-live";

export const metadata: Metadata = { title: "日志" };

export default async function JournalPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return DATA_MODE === "api" ? (
    <JournalLive workspaceSlug={workspaceSlug} />
  ) : (
    <JournalWorkspace workspaceSlug={workspaceSlug} />
  );
}
