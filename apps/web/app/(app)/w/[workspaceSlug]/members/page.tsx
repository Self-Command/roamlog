import type { Metadata } from "next";
import dynamic from "next/dynamic";

import { MembersLive } from "@/components/members/members-live";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "成员" };

/** Fixture boundary: the mock members workspace is demo-only and lazily loaded. */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

const LegacyMembersWorkspace = isApiBuild
  ? undefined
  : dynamic(() =>
      import("@/components/members/members-workspace").then(
        (module) => module.MembersWorkspace,
      ),
    );

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  if (DATA_MODE === "api") {
    return <MembersLive workspaceSlug={workspaceSlug} />;
  }

  return LegacyMembersWorkspace ? <LegacyMembersWorkspace /> : null;
}