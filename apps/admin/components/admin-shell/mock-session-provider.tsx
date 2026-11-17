"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

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
}

const MockSessionContext = createContext<MockSessionContextValue | null>(null);

export function MockSessionProvider({
  initialSession = DEFAULT_ADMIN_SESSION,
  children,
}: {
  initialSession?: AdminSession;
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
      setRole: (role) => {
        setSession((current) => ({ ...current, role }));
        window.localStorage.setItem(ROLE_STORAGE_KEY, role);
      },
    }),
    [session],
  );

  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>;
}

export function useAdminSession(): MockSessionContextValue {
  const value = useContext(MockSessionContext);
  if (!value) {
    throw new Error("useAdminSession must be used inside MockSessionProvider.");
  }
  return value;
}
