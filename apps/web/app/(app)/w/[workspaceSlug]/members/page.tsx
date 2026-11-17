import type { Metadata } from "next";
import { MembersWorkspace } from "@/components/members/members-workspace";

export const metadata: Metadata = { title: "成员" };

export default async function MembersPage() {
  return <MembersWorkspace />;
}
