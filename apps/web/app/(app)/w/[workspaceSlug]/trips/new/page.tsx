import type { Metadata } from "next";

import { NewTripPage } from "@/components/trips/new-trip-page";

export const metadata: Metadata = {
  title: "新建旅行",
};

export default async function NewTripRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return <NewTripPage workspaceSlug={workspaceSlug} />;
}
