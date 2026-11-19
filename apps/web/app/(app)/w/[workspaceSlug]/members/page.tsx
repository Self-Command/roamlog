import type { Metadata } from "next";

import { MembersLive } from "@/components/members/members-live";

export const metadata: Metadata = { title: "成员" };

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <MembersLive workspaceSlug={workspaceSlug} />;
}