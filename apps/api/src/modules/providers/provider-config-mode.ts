export const PROVIDER_CONFIG_MODE_ENV = "PROVIDER_CONFIG_MODE";

export const PROVIDER_CONFIG_MODES = ["legacy", "shadow", "v2"] as const;
export type ProviderConfigMode = (typeof PROVIDER_CONFIG_MODES)[number];

export const DEFAULT_PROVIDER_CONFIG_MODE: ProviderConfigMode = "legacy";

/**
 * Parse the provider cutover mode at the process boundary.
 *
 * Missing means `legacy` for development/test, while production additionally
 * requires an explicit value in `validateEnvironment`. Unknown values are a boot
 * error so a typo can never silently select the wrong runtime.
 */
export function normalizeProviderConfigMode(value: string | undefined): ProviderConfigMode {
  const normalized = (value ?? DEFAULT_PROVIDER_CONFIG_MODE).trim().toLowerCase();
  if ((PROVIDER_CONFIG_MODES as readonly string[]).includes(normalized)) {
    return normalized as ProviderConfigMode;
  }
  throw new Error(
    `${PROVIDER_CONFIG_MODE_ENV} must be one of ${PROVIDER_CONFIG_MODES.join(", ")}; the invalid value was not echoed.`,
  );
}

/** Pure resolver used by the runtime and by preflight/tests. */
export function resolveProviderConfigMode(
  env: NodeJS.ProcessEnv = process.env,
): ProviderConfigMode {
  return normalizeProviderConfigMode(env[PROVIDER_CONFIG_MODE_ENV]);
}
