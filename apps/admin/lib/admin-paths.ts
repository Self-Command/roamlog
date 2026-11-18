export const DEFAULT_ADMIN_LOGIN_PATH = "/login";

export function getAdminLoginPath(): string {
  const configuredPath = process.env.NEXT_PUBLIC_ADMIN_LOGIN_PATH?.trim();
  if (!configuredPath) {
    return DEFAULT_ADMIN_LOGIN_PATH;
  }
  return configuredPath.startsWith("/") ? configuredPath : `/${configuredPath}`;
}
