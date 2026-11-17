import type { Metadata } from "next";

import { TripsLibrary } from "@/components/trips/trips-library";

export const metadata: Metadata = {
  title: "旅行库",
};

export default async function TripsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return <TripsLibrary workspaceSlug={workspaceSlug} />;
}
