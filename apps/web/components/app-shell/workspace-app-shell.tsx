"use client";

import { Button, EmptyState, ErrorState, Skeleton, type ShellLinkProps } from "@roamlog/ui";
import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

import { useMeQuery, useTripsQuery, useWorkspacesQuery } from "@/lib/query";

import { AppShellView } from "./app-shell-view";

function NextAppLink({ href, ...props }: ShellLinkProps) {
  return <Link href={href} {...props} />;
}

function LoadingShell() {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="hidden w-60 shrink-0 border-r border-hairline bg-surface-deep p-4 lg:block">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-8 h-12 w-full" />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center border-b border-hairline px-6">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="ml-auto h-8 w-32" />
        </header>
        <div className="mx-auto w-full max-w-[1440px] space-y-6 p-6 lg:p-8">
          <Skeleton className="h-8 w-56" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-72 rounded-card" />
            <Skeleton className="h-72 rounded-card" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceAppShell({ children }: { children: ReactNode }) {
  const params = useParams<{ workspaceSlug: string }>();
  const pathname = usePathname();
  const workspaceSlug = params.workspaceSlug;
  const meQuery = useMeQuery();
  const workspacesQuery = useWorkspacesQuery();
  const workspace = workspacesQuery.data?.find((candidate) => candidate.slug === workspaceSlug);
  const tripsQuery = useTripsQuery(workspace?.id);

  if (meQuery.isLoading || workspacesQuery.isLoading) {
    return <LoadingShell />;
  }

  const firstError = meQuery.error ?? workspacesQuery.error;
  if (firstError && (!meQuery.data || !workspacesQuery.data)) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas px-6">
        <div className="absolute inset-x-0 top-0 h-px bg-hairline" />
        <div className="w-full max-w-lg">
          <p className="mb-6 font-serif text-2xl tracking-[-0.03em] text-ink">Roamlog</p>
          <ErrorState
            title="无法载入 Workspace"
            description={
              firstError instanceof Error
                ? firstError.message
                : "开发 mock 或 API 边界没有返回有效数据。"
            }
            retryAction={
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  void meQuery.refetch();
                  void workspacesQuery.refetch();
                }}
              >
                重新加载
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (!meQuery.data || !workspacesQuery.data) {
    return <LoadingShell />;
  }

  if (!workspace) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
        <div className="w-full max-w-lg">
          <p className="type-eyebrow">WORKSPACE NOT FOUND</p>
          <h1 className="mt-3 font-serif text-4xl tracking-[-0.035em] text-ink">
            找不到这个 Workspace
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            当前账号不是该 Workspace 的成员，或链接中的 slug 已失效。
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <NextAppLink href={`/w/${workspacesQuery.data[0]?.slug ?? "roamlog-crew"}`}>
                返回我的 Workspace
              </NextAppLink>
            </Button>
            <Button asChild variant="outline">
              <a href="/login">切换账号</a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (tripsQuery.error && !tripsQuery.data) {
    return (
      <AppShellView
        currentUser={meQuery.data}
        workspaces={workspacesQuery.data}
        currentWorkspace={workspace}
        trips={[]}
        pathname={pathname}
        linkComponent={NextAppLink}
      >
        <EmptyState
          icon={undefined}
          title="旅行数据暂不可用"
          description="Workspace 已载入，但旅行列表没有返回。检查 MSW 或 API 目录后重试。"
          action={
            <Button type="button" variant="outline" onClick={() => void tripsQuery.refetch()}>
              重新加载
            </Button>
          }
        />
      </AppShellView>
    );
  }

  return (
    <AppShellView
      currentUser={meQuery.data}
      workspaces={workspacesQuery.data}
      currentWorkspace={workspace}
      trips={tripsQuery.data?.items ?? []}
      pathname={pathname}
      linkComponent={NextAppLink}
    >
      {children}
    </AppShellView>
  );
}
