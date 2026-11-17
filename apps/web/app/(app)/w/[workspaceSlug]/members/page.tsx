import type { Metadata } from "next";
import { MembersWorkspace } from "@/components/members/members-workspace";
import { MembersLive } from "@/components/members/members-live";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "成员" };

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return DATA_MODE === "api" ? (
    <MembersLive workspaceSlug={workspaceSlug} />
  ) : (
    <MembersWorkspace />
  );
}
