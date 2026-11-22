import type { Metadata } from "next";

import { PublicSharePage } from "@/components/share/public-share-page";
import { loadPublicShareScreen } from "@/components/share/public-trip-server";

export const metadata: Metadata = {
  title: "共享旅行",
  robots: { index: false, follow: false },
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const initialScreen = await loadPublicShareScreen(token);
  return <PublicSharePage token={token} initialScreen={initialScreen} />;
}
