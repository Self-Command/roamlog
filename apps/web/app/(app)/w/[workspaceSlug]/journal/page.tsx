import type { Metadata } from "next";
import dynamic from "next/dynamic";

import { DATA_MODE } from "@/lib/data-mode";

import { JournalLive } from "./journal-live";

export const metadata: Metadata = { title: "日志" };

/** Fixture boundary: the mock journal workspace is demo-only and lazily loaded. */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

const LegacyJournalWorkspace = isApiBuild
  ? undefined
  : dynamic(() =>
      import("@/components/journal/journal-workspace").then(
        (module) => module.JournalWorkspace,
      ),
    );

export default async function JournalPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  if (DATA_MODE === "api") {
    return <JournalLive workspaceSlug={workspaceSlug} />;
  }

  return LegacyJournalWorkspace ? (
    <LegacyJournalWorkspace workspaceSlug={workspaceSlug} />
  ) : null;
}