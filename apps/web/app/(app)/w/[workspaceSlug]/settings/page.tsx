import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "设置" };

/**
 * `/w/<slug>/settings` is an index, not a page: it always lands on the first
 * section so the nav has an unambiguous active item.
 */
export default async function SettingsIndexPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(`/w/${workspaceSlug}/settings/profile`);
}