"use client";

import { useGetMe } from "@roamlog/api-client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { platformRoleOf } from "../../lib/admin-data-source";
import { getAdminLoginPath, getAdminLoginPathWithReturnTo } from "../../lib/admin-paths";
import type { AdminConsoleRole, AdminSession } from "../../lib/admin-types";
import { redirectToAdminLogin } from "./admin-navigation";
import { signOutAdminSession } from "./admin-session-client";

interface AdminSessionContextValue {
  session: AdminSession;
  setRole: (role: AdminConsoleRole) => void;
  isRoleLocked: boolean;
  signOut: () => Promise<void>;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

/**
 * The console has exactly one identity source: `/v1/me`. The platform role,
 * name, email and id are never pre-filled from a local template, and there is
 * no local role preview that could disagree with the backend.
 */
export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const me = useGetMe({ query: { retry: false } });
  const user = me.data?.status === 200 ? me.data.data : null;
  const role = user ? platformRoleOf(user.platformRole) : null;
  const unauthenticated = me.data?.status === 401;
  const [returnTo, setReturnTo] = useState<string | null>(null);

  /**
   * `AdminSession` deliberately carries no 2FA or environment fields: `/v1/me`
   * returns `UserSchema` without a 2FA flag, and the deployment environment is
   * resolved from explicit configuration instead of a session claim.
   */
  const session = useMemo<AdminSession | null>(
    () =>
      user && role && role !== "user"
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            role,
          }
        : null,
    [role, user],
  );

  const signOut = useCallback(async () => {
    await signOutAdminSession();
    // A full navigation to the login page drops the client cache; the API has
    // already cleared the httpOnly Better Auth session cookie.
    redirectToAdminLogin();
  }, []);

  useEffect(() => {
    if (!unauthenticated) {
      return;
    }
    const current = `${window.location.pathname}${window.location.search}`;
    // The shell is only mounted on protected routes, but never loop onto the
    // configured login path if that guard is ever reused elsewhere.
    if (current.startsWith(getAdminLoginPath())) {
      return;
    }
    setReturnTo(current);
    redirectToAdminLogin(current);
  }, [unauthenticated]);

  const value = useMemo<AdminSessionContextValue | null>(
    () =>
      session
        ? {
            session,
            isRoleLocked: true,
            setRole: () => undefined,
            signOut,
          }
        : null,
    [session, signOut],
  );

  if (me.isLoading) {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center bg-canvas">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          正在验证平台会话
        </p>
      </div>
    );
  }

  if (unauthenticated) {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-hairline-strong bg-surface-1 p-6">
          <p className="type-eyebrow">管理员会话</p>
          <h1 className="mt-2 font-serif text-2xl text-ink">会话已过期</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            正在跳转到登录页，登录后会回到当前路径。
          </p>
          <a
            href={getAdminLoginPathWithReturnTo(returnTo)}
            className="mt-5 inline-flex rounded-control bg-ink px-3 py-2 text-xs font-medium text-black"
          >
            继续前往登录
          </a>
        </div>
      </div>
    );
  }

  if (me.isError && !me.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-accent-red/25 bg-surface-1 p-6">
          <p className="type-eyebrow text-accent-red">会话错误</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink">暂时无法确认登录状态</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            后台服务暂时没有响应，暂时无法确认登录状态。请重试。
          </p>
          <button
            type="button"
            className="mt-5 rounded-control border border-hairline-strong px-3 py-2 text-xs font-medium text-ink"
            onClick={() => void me.refetch()}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!me.data || me.data.status >= 400) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-accent-red/25 bg-surface-1 p-6">
          <p className="type-eyebrow text-accent-red">会话错误</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink">登录状态校验失败</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            登录状态校验失败，请重新登录。如果持续失败，请联系平台管理员。
          </p>
        </div>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-accent-red/25 bg-surface-1 p-6">
          <p className="type-eyebrow text-accent-red">平台访问被拒绝</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink">当前账户没有后台权限</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            当前账号没有后台管理权限。请联系平台超级管理员。
          </p>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-accent-red/25 bg-surface-1 p-6">
          <p className="type-eyebrow text-accent-red">会话错误</p>
          <h1 className="mt-2 font-serif text-2xl text-ink">无法读取账户信息</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            未取到可用的管理员账户。
          </p>
        </div>
      </div>
    );
  }

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionContextValue {
  const value = useContext(AdminSessionContext);
  if (!value) {
    throw new Error("useAdminSession must be used inside AdminSessionProvider.");
  }
  return value;
}
