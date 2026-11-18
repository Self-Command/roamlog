/**
 * The Admin Shell must never invent a deployment environment. The badge is
 * derived only from build/runtime configuration:
 *
 * - `NEXT_PUBLIC_APP_ENV` is the explicit deployment identity (staging,
 *   production, development). It is inlined at build time by Next.js.
 * - `NODE_ENV` is the Next.js build mode fallback.
 *
 * When neither source yields a known environment, the badge is not rendered at
 * all. In particular there is deliberately no "local" fallback: the old shell
 * hard-coded `LOCAL` even when the API reported `production`.
 */
function knownEnvironmentLabel(value: string): string | null {
  switch (value) {
    case "production":
      return "PRODUCTION";
    case "staging":
      return "STAGING";
    case "development":
      return "DEVELOPMENT";
    default:
      return null;
  }
}

export function resolveAdminEnvironment(
  appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | null {
  const configured = appEnv?.trim().toLowerCase();
  if (configured) {
    return knownEnvironmentLabel(configured) ?? configured.toUpperCase();
  }
  if (nodeEnv === "production") {
    return knownEnvironmentLabel("production");
  }
  if (nodeEnv === "development") {
    return knownEnvironmentLabel("development");
  }
  return null;
}
