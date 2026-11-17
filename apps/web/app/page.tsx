"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useMeQuery, useWorkspacesQuery } from "@/lib/query";

export default function HomePage() {
  const router = useRouter();
  const me = useMeQuery();
  const workspaces = useWorkspacesQuery();

  useEffect(() => {
    if (me.isLoading || workspaces.isLoading) return;

    const firstWorkspace = workspaces.data?.[0];
    if (!me.data || !firstWorkspace) {
      router.replace("/login");
      return;
    }

    router.replace(`/w/${firstWorkspace.slug}`);
  }, [me.data, me.isLoading, router, workspaces.data, workspaces.isLoading]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        Opening your workspace
      </p>
    </main>
  );
}
