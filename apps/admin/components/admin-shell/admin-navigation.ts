import { getAdminLoginPathWithReturnTo } from "../../lib/admin-paths";

/**
 * Single navigation entry point for the admin console so tests can observe the
 * computed target (login path + returnTo) without driving jsdom navigation.
 */
export function redirectToAdminLogin(returnTo?: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  window.location.assign(getAdminLoginPathWithReturnTo(returnTo));
}
