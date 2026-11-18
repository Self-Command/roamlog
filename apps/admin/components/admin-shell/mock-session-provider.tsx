"use client";

import { useGetMe } from "@roamlog/api-client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { getAdminDataMode } from "../../lib/admin-data-mode";
import { platformRoleOf } from "../../lib/admin-data-source";
import { getAdminLoginPath } from "../../lib/admin-paths";
import {
  DEFAULT_ADMIN_SESSION,
  isAdminConsoleRole,
  type AdminConsoleRole,
  type AdminSession,
} from "../../lib/fixtures";

const ROLE_STORAGE_KEY = "roamlog.admin.role-preview.v1";

interface MockSessionContextValue {
  session: AdminSession;
  setRole: (role: AdminConsoleRole) => void;
  isRoleLocked: boolean;
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

  const value = useMemo<MockSessionContextValue>(
    () => ({
      session,
      isRoleLocked: false,
      setRole: (role) => {
        setSession((current) => ({ ...current, role }));
        window.localStorage.setItem(ROLE_STORAGE_KEY, role);
      },
    }),
    [session],
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

  const session = useMemo<AdminSession | null>(
    () =>
      user && role && role !== "user"
        ? {
            ...initialSession,
            id: user.id,
            name: user.name,
            email: user.email,
            role,
            twoFactorEnabled: false,
            environment: "local",
          }
        : null,
    [initialSession, role, user],
  );

  const value = useMemo<MockSessionContextValue | null>(
    () =>
      session
        ? {
            session,
            isRoleLocked: true,
            setRole: () => undefined,
          }
        : null,
    [session],
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

  if (!me.data || me.data.status === 401) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-hairline-strong bg-surface-1 p-6">
          <p className="type-eyebrow">ADMIN SESSION</p>
          <h1 className="mt-2 font-serif text-2xl text-ink">需要重新登录</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            当前没有有效的 Better Auth session，或 API 暂时不可用。
          </p>
          <button
            type="button"
            className="mt-5 rounded-control bg-ink px-3 py-2 text-xs font-medium text-black"
            onClick={() => window.location.assign(getAdminLoginPath())}
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  if (me.data.status >= 400) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-card border border-accent-red/25 bg-surface-1 p-6">
          <p className="type-eyebrow text-accent-red">SESSION ERROR</p>
          <h1 className="mt-2 font-serif text-2xl text-ink">后台会话校验失败</h1>
          <p className="mt-2 text-[12px] leading-6 text-muted">
            HTTP {me.data.status} · 请重新登录或检查 API。
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

  return value ? (
    <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>
  ) : null;
}

export function useAdminSession(): MockSessionContextValue {
  const value = useContext(MockSessionContext);
  if (!value) {
    throw new Error("useAdminSession must be used inside MockSessionProvider.");
  }
  return value;
}
