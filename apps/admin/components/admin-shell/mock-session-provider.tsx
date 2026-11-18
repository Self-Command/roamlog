"use client";

import { useGetMe } from "@roamlog/api-client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getAdminDataMode } from "../../lib/admin-data-mode";
import { platformRoleOf } from "../../lib/admin-data-source";
import { getAdminLoginPath, getAdminLoginPathWithReturnTo } from "../../lib/admin-paths";
import {
  DEFAULT_ADMIN_SESSION,
  isAdminConsoleRole,
  type AdminConsoleRole,
  type AdminSession,
} from "../../lib/fixtures";
import { redirectToAdminLogin } from "./admin-navigation";
import { signOutAdminSession } from "./admin-session-client";

const ROLE_STORAGE_KEY = "roamlog.admin.role-preview.v1";

interface MockSessionContextValue {
  session: AdminSession;
  setRole: (role: AdminConsoleRole) => void;
  isRoleLocked: boolean;
  signOut: () => Promise<void>;
}

const MockSessionContext = createContext<MockSessionContextValue | null>(null);

export function MockSessionProvider({
  initialSession = DEFAULT_ADMIN_SESSION,
  children,
}: {
  initialSession?: AdminSession;
  children: React.ReactNode;
}) {
  if (getAdminDataMode() === "api") {
    return <ApiSessionProvider initialSession={initialSession}>{children}</ApiSessionProvider>;
  }
  return (
    <FixtureSessionProvider initialSession={initialSession}>{children}</FixtureSessionProvider>
  );
}

function FixtureSessionProvider({
  initialSession,
  children,
}: {
  initialSession: AdminSession;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState(initialSession);

  useEffect(() => {
    const storedRole = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (storedRole && isAdminConsoleRole(storedRole)) {
      setSession((current) => ({ ...current, role: storedRole }));
    }
  }, []);

  const signOut = useCallback(async () => {
    // Fixture mode has no server session: drop the local preview role and leave.
    window.localStorage.removeItem(ROLE_STORAGE_KEY);
    setSession(initialSession);
    redirectToAdminLogin();
  }, [initialSession]);

  const value = useMemo<MockSessionContextValue>(
    () => ({
      session,
      isRoleLocked: false,
      setRole: (role) => {
        setSession((current) => ({ ...current, role }));
        window.localStorage.setItem(ROLE_STORAGE_KEY, role);
      },
      signOut,
    }),
    [session, signOut],
  );

  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>;
}

function ApiSessionProvider({
  initialSession,
  children,
}: {
  initialSession: AdminSession;
  children: React.ReactNode;
}) {
  const me = useGetMe({ query: { retry: false } });
  const user = me.data?.status === 200 ? me.data.data : null;
  const role = user ? platformRoleOf(user.platformRole) : null;
  const unauthenticated = me.data?.status === 401;
  const [returnTo, setReturnTo] = useState<string | null>(null);

  /**
   * `AdminSession` still carries `twoFactorEnabled` / `environment` fields from
   * the fixture type, but neither has a real source here: `/v1/me` returns
   * `UserSchema` without a 2FA flag, and there is no Admin 2FA-status endpoint.
   * Both fields are therefore never rendered or overwritten with guessed values.
   */
  const session = useMemo<AdminSession | null>(
    () =>
      user && role && role !== "user"
        ? {
            ...initialSession,
            id: user.id,
            name: user.name,
            email: user.email,
            role,
          }
        : null,
    [initialSession, role, user],
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

  const value = useMemo<MockSessionContextValue | null>(
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
          Verifying platform session
        </p>
      </div>
    );
  }

  if (unauthenticated) {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-hairline-strong bg-surface-1 p-6">
          <p className="type-eyebrow">ADMIN SESSION</p>
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
          <p className="type-eyebrow text-accent-red">SESSION ERROR</p>
          <h1 className="mt-2 font-serif text-2xl text-ink">无法校验后台会话</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            后台 API 暂时不可用，未确认会话状态，因此不会跳转登录。
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
          <p className="type-eyebrow text-accent-red">SESSION ERROR</p>
          <h1 className="mt-2 font-serif text-2xl text-ink">后台会话校验失败</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            {me.data ? `HTTP ${me.data.status} · ` : ""}请重新登录或检查 API。
          </p>
        </div>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-accent-red/25 bg-surface-1 p-6">
          <p className="type-eyebrow text-accent-red">PLATFORM ACCESS DENIED</p>
          <h1 className="mt-2 font-serif text-2xl text-ink">当前账户没有后台权限</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            平台角色以后端 session 为准；前端不会自行提升权限。
          </p>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-accent-red/25 bg-surface-1 p-6">
          <p className="type-eyebrow text-accent-red">SESSION ERROR</p>
          <h1 className="mt-2 font-serif text-2xl text-ink">无法读取账户信息</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            `/v1/me` 未返回可用的管理员账户。
          </p>
        </div>
      </div>
    );
  }

  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>;
}

export function useAdminSession(): MockSessionContextValue {
  const value = useContext(MockSessionContext);
  if (!value) {
    throw new Error("useAdminSession must be used inside MockSessionProvider.");
  }
  return value;
}
