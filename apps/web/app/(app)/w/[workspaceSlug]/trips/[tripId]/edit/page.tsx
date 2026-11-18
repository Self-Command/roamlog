import type { Metadata } from "next";

import { EditTripPage } from "@/components/trips/edit-trip-page";

export const metadata: Metadata = {
  title: "编辑旅行 · Roamlog",
};

export default async function EditTripRoutePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; tripId: string }>;
}) {
  const { workspaceSlug, tripId } = await params;
  return <EditTripPage workspaceSlug={workspaceSlug} tripId={tripId} />;
}
