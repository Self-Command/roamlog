"use client";

import { AlertTriangle, LocateFixed, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";

import { Button, EmptyState } from "@roamlog/ui";

import type { AdminResource } from "../../lib/admin-data-source";
import { getAdminLoginPath } from "../../lib/admin-paths";
import { AdminClientOnly } from "./admin-client-only";

function AdminPreparingView() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="rounded-card border border-hairline-strong bg-surface-1 px-4 py-3">
        <p className="type-eyebrow">后台 / 准备视图</p>
        <p className="mt-1 text-[12px] text-muted">正在准备后台视图。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-card border border-hairline bg-surface-1"
          />
        ))}
      </div>
    </div>
  );
}

function AdminDataLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="flex items-center justify-between rounded-card border border-hairline-strong bg-surface-1 px-4 py-3">
        <div>
          <p className="type-eyebrow">加载中</p>
          <p className="mt-1 text-[12px] text-muted">正在读取后台数据。</p>
        </div>
        <RefreshCw aria-hidden="true" className="size-4 animate-spin text-muted" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-card border border-hairline bg-surface-1"
          />
        ))}
      </div>
    </div>
  );
}

export function AdminDataBoundary<T>({
  resource,
  children,
}: {
  resource: AdminResource<T>;
  children: (data: T) => React.ReactNode;
}) {
  return (
    <AdminClientOnly fallback={<AdminPreparingView />}>
      <AdminDataContent resource={resource}>{children}</AdminDataContent>
    </AdminClientOnly>
  );
}

function AdminDataContent<T>({
  resource,
  children,
}: {
  resource: AdminResource<T>;
  children: (data: T) => React.ReactNode;
}) {
  if (resource.isLoading && !resource.data && !resource.error) {
    return <AdminDataLoading />;
  }

  if (resource.error) {
    const twoFactorRequired = resource.error.code === "ADMIN_2FA_REQUIRED";
    const accessDenied = resource.error.code === "ADMIN_ACCESS_DENIED";
    return (
      <section
        role="alert"
        className="mx-auto max-w-2xl rounded-card border border-accent-red/25 bg-surface-1 p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-pill border border-accent-red/25 bg-accent-red/10 text-accent-red">
            {twoFactorRequired || accessDenied ? (
              <ShieldAlert aria-hidden="true" className="size-4" />
            ) : (
              <WifiOff aria-hidden="true" className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="type-eyebrow text-accent-red">
              {twoFactorRequired
                ? "需要两步验证"
                : accessDenied
                  ? "没有后台权限"
                  : "加载失败"}
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em] text-ink">
              {twoFactorRequired
                ? "先完成两步验证"
                : accessDenied
                  ? "当前账户没有后台权限"
                  : "加载失败，请稍后重试"}
            </h2>
            <p className="mt-2 text-[12px] leading-6 text-muted">
              {twoFactorRequired
                ? "为保证后台安全，请先完成两步验证。完成后才能继续管理操作。"
                : "后台数据暂时无法读取，请稍后重试；如果持续失败，请联系平台管理员。"}
            </p>
            <details className="mt-3 font-mono text-[9px] text-stone">
              <summary className="cursor-pointer select-none">技术详情</summary>
              <p className="mt-1 break-all">
                {resource.error.code} · HTTP {resource.error.status || "网络错误"} ·{" "}
                {resource.error.detail}
              </p>
            </details>
            <div className="mt-5 flex flex-wrap gap-2">
              {twoFactorRequired ? (
                <Button
                  variant="primary"
                  onClick={() => window.location.assign("/admin/2fa/enroll")}
                >
                  <ShieldAlert aria-hidden="true" />
                  绑定验证器
                </Button>
              ) : accessDenied ? (
                <Button
                  variant="outline"
                  onClick={() => window.location.assign(getAdminLoginPath())}
                >
                  更换账户
                </Button>
              ) : null}
              <Button variant="ghost" onClick={resource.refetch}>
                <RefreshCw aria-hidden="true" />
                重试
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!resource.data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="没有可显示的数据"
        description="暂时没有可显示的数据。请重新加载，或调整筛选条件后再试。"
        className="rounded-card border border-hairline-strong bg-surface-1"
      />
    );
  }

  return (
    <div className="space-y-4">
      {resource.degraded.length > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-control border border-accent-yellow/25 bg-accent-yellow/5 px-3 py-2 text-[11px] text-accent-yellow"
        >
          <LocateFixed aria-hidden="true" className="size-3.5" />
          部分服务暂时不可用：{resource.degraded.join(" · ")}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={resource.refetch}>
            重新检查
          </Button>
        </div>
      ) : null}
      {children(resource.data)}
    </div>
  );
}
