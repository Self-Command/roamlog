import type { Metadata } from "next";

import { PublicSharePage } from "@/components/share/public-share-page";

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
  return <PublicSharePage token={token} />;
}
