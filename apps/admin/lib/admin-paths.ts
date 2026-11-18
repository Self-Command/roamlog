export const DEFAULT_ADMIN_LOGIN_PATH = "/login";
export const DEFAULT_ADMIN_HOME_PATH = "/admin";

export function getAdminLoginPath(): string {
  const configuredPath = process.env.NEXT_PUBLIC_ADMIN_LOGIN_PATH?.trim();
  if (!configuredPath) {
    return DEFAULT_ADMIN_LOGIN_PATH;
  }
  return configuredPath.startsWith("/") ? configuredPath : `/${configuredPath}`;
}

/**
 * Only same-origin absolute paths are valid post-login targets. Protocol-relative
 * URLs (`//evil.example`) and backslash variants are rejected to avoid open redirects.
 */
export function sanitizeAdminReturnTo(returnTo: string | null | undefined): string | null {
  if (!returnTo) {
    return null;
  }
  const value = returnTo.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  return value;
}

export function getAdminLoginPathWithReturnTo(returnTo?: string | null): string {
  const loginPath = getAdminLoginPath();
  const safeReturnTo = sanitizeAdminReturnTo(returnTo);
  if (!safeReturnTo) {
    return loginPath;
  }
  const separator = loginPath.includes("?") ? "&" : "?";
  return `${loginPath}${separator}returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function getAdminPostLoginPath(returnTo?: string | null): string {
  return sanitizeAdminReturnTo(returnTo) ?? DEFAULT_ADMIN_HOME_PATH;
}
