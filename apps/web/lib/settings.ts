import {
  PublicSettingsResponseSchema,
  type PublicSettingsResponse,
} from "@roamlog/contracts";
import { useQuery } from "@tanstack/react-query";
import { cache } from "react";
import type { Metadata } from "next";

/**
 * Runtime public settings (`GET /v1/public/settings`).
 *
 * The endpoint is the anonymous projection of every `isPublic && !isSecret`
 * registry entry. The web shell treats it as an enhancement, never as a
 * dependency: any failure renders the code defaults below and logs a warning,
 * so a settings outage can never turn a page into a 500.
 *
 * Two consumers exist:
 * - `getPublicSettings()` is the server path used by the root layout and the
 *   login page. It asks Next to revalidate the fetch every 30 seconds, which
 *   is what makes an admin change reach the web app without a rebuild.
 * - `usePublicSettings()` is the TanStack Query path for surfaces that must
 *   react immediately; it shares one cache entry (`PUBLIC_SETTINGS_QUERY_KEY`).
 */

export type PublicSettingsMap = PublicSettingsResponse["settings"];

export const PUBLIC_SETTINGS_PATH = "/v1/public/settings";
export const PUBLIC_SETTINGS_REVALIDATE_SECONDS = 30;
export const PUBLIC_SETTINGS_TIMEOUT_MS = 3_000;

/** Every public key today, mirrored from the API registry defaults. */
export const PUBLIC_SETTING_KEYS = [
  "site.title",
  "site.description",
  "general.defaultLanguage",
  "general.defaultTimeZone",
  "seo.titleTemplate",
  "seo.descriptionTemplate",
  "seo.ogImageUrl",
  "seo.robots",
  "theme.accent",
  "theme.defaultMode",
  "theme.loginTagline",
] as const;
export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number];

/** Used only when the runtime value is missing or blank. */
export const DEFAULT_SITE_TITLE = "Roamlog — 旅行档案";
export const DEFAULT_SITE_DESCRIPTION = "为旅行小队保存行程、日志、照片与共同记忆。";
export const DEFAULT_SITE_NAME = "Roamlog";
export const DEFAULT_TITLE_TEMPLATE = "%s · Roamlog";
export const DEFAULT_ROBOTS = "index,follow";
export const DEFAULT_LANGUAGE = "zh-CN";

export interface PublicSettingsFetchOptions {
  /** Defaults to `API_URL` (server) or `http://localhost:4000`. */
  apiUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetcher?: typeof fetch;
}

export function getApiBaseUrl(): string {
  const configured = process.env.API_URL?.trim();
  return (configured && configured.length > 0 ? configured : "http://localhost:4000").replace(
    /\/+$/u,
    "",
  );
}

function warnPublicSettings(message: string, cause?: unknown): void {
  // A warning, not an error: settings are optional, and this must stay out of
  // the rendered UI entirely.
  console.warn(`[roamlog] ${message}`, cause);
}

function parsePublicSettings(body: unknown): PublicSettingsMap | null {
  const parsed = PublicSettingsResponseSchema.safeParse(body);
  if (!parsed.success) {
    warnPublicSettings("public settings response did not match the contract", parsed.error.issues);
    return null;
  }
  return parsed.data.settings;
}

async function requestPublicSettings({
  apiUrl = getApiBaseUrl(),
  timeoutMs = PUBLIC_SETTINGS_TIMEOUT_MS,
  fetcher = fetch,
}: PublicSettingsFetchOptions = {}): Promise<PublicSettingsMap> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(`${apiUrl}${PUBLIC_SETTINGS_PATH}`, {
      headers: { accept: "application/json" },
      next: { revalidate: PUBLIC_SETTINGS_REVALIDATE_SECONDS },
      signal: controller.signal,
    } as RequestInit & { next: { revalidate: number } });

    if (!response.ok) {
      warnPublicSettings(
        `public settings request failed with HTTP ${String(response.status)}; using code defaults`,
      );
      return {};
    }

    return parsePublicSettings(await response.json()) ?? {};
  } catch (cause) {
    warnPublicSettings("public settings request failed; using code defaults", cause);
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Per-request memoization for the no-argument call the layout makes from both
 * `generateMetadata()` and the layout body (Next also dedupes the fetch).
 */
const getCachedPublicSettings = cache((): Promise<PublicSettingsMap> => requestPublicSettings());

/**
 * Server-only read of the public settings.
 *
 * Returns `{}` on timeout, transport error, non-2xx, or contract mismatch; it
 * never throws. Callers therefore always render code defaults instead of an
 * error page.
 */
export function getPublicSettings(
  options?: PublicSettingsFetchOptions,
): Promise<PublicSettingsMap> {
  return options ? requestPublicSettings(options) : getCachedPublicSettings();
}

export const PUBLIC_SETTINGS_QUERY_KEY = ["v1", "public-settings"] as const;

/**
 * Client read for surfaces that need the settings without waiting for a
 * server round-trip. One shared cache entry, revalidated every 30 seconds.
 * Failures resolve to `{}` instead of rejecting, so no error surface appears.
 */
export function usePublicSettings(options?: { fetcher?: typeof fetch }) {
  const fetcher = options?.fetcher;

  return useQuery({
    queryKey: PUBLIC_SETTINGS_QUERY_KEY,
    staleTime: PUBLIC_SETTINGS_REVALIDATE_SECONDS * 1_000,
    queryFn: async ({ signal }): Promise<PublicSettingsMap> => {
      try {
        const response = await (fetcher ?? fetch)(PUBLIC_SETTINGS_PATH, {
          headers: { accept: "application/json" },
          signal,
        });
        if (!response.ok) {
          warnPublicSettings(
            `public settings request failed with HTTP ${String(response.status)}; using code defaults`,
          );
          return {};
        }
        return parsePublicSettings(await response.json()) ?? {};
      } catch (cause) {
        warnPublicSettings("public settings request failed; using code defaults", cause);
        return {};
      }
    },
  });
}

function readStringValue(settings: PublicSettingsMap, key: string): string | undefined {
  const value = settings[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** A non-empty public value, or `undefined` when unset/blank/not a string. */
export function readPublicString(
  settings: PublicSettingsMap,
  key: PublicSettingKey,
): string | undefined {
  return readStringValue(settings, key);
}

/**
 * `%s` -> page title. A template without `%s` is a complete title already, so
 * it is rendered verbatim (this mirrors Next's own title-template behavior).
 */
export function applyTitleTemplate(template: string, title: string): string {
  return template.includes("%s") ? template.replace(/%s/g, title) : template;
}

/**
 * Site-level metadata defaults. Nested pages keep their own `metadata` /
 * `generateMetadata`; Next merges those over this root object, so `title` and
 * `description` here are defaults plus the shared title template. A nested
 * page's `robots` (for example the `/share` noindex) also wins over the site
 * value below because Next replaces the field wholesale.
 */
export function buildSiteMetadata(settings: PublicSettingsMap): Metadata {
  const configuredTitle = readPublicString(settings, "site.title");
  const siteTitle = configuredTitle ?? DEFAULT_SITE_TITLE;
  const siteDescription = readPublicString(settings, "site.description") ?? DEFAULT_SITE_DESCRIPTION;

  // `seo.*` is part of the public projection. Blank or missing values fall back
  // to the code defaults, never to an empty tag or an error.
  const configuredTitleTemplate = readStringValue(settings, "seo.titleTemplate");
  const titleTemplate =
    configuredTitleTemplate ??
    (configuredTitle ? `%s · ${configuredTitle}` : DEFAULT_TITLE_TEMPLATE);
  const descriptionTemplate =
    readStringValue(settings, "seo.descriptionTemplate") ?? siteDescription;
  const openGraphImage = readStringValue(settings, "seo.ogImageUrl");
  const robots = readStringValue(settings, "seo.robots") ?? DEFAULT_ROBOTS;
  const openGraphTitle = configuredTitleTemplate
    ? applyTitleTemplate(configuredTitleTemplate, configuredTitle ?? DEFAULT_SITE_NAME)
    : siteTitle;

  return {
    title: {
      default: siteTitle,
      template: titleTemplate,
    },
    description: siteDescription,
    openGraph: {
      type: "website",
      title: openGraphTitle,
      description: descriptionTemplate,
      ...(openGraphImage ? { images: [{ url: openGraphImage }] } : {}),
    },
    robots,
  };
}

/**
 * Only the modes the runtime renders. `light` was removed from the contract
 * because `@roamlog/ui` ships dark tokens only; keeping it here would keep the
 * fake setting alive on stale caches.
 */
export type ThemeMode = "dark" | "system";
export type ThemeAccent = "white" | "amber" | "blue" | "emerald" | "rose";

export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_THEME_ACCENT: ThemeAccent = "white";

/**
 * Registry accent -> design token values from `@roamlog/ui` tokens.css.
 * `white` is the brand default and deliberately keeps today's orange
 * atmospheric glow; the other accents swap in the matching token family.
 */
export const THEME_ACCENT_TOKENS: Record<
  ThemeAccent,
  { primary: string; soft: string; glow: string }
> = {
  white: { primary: "#fcfdff", soft: "rgba(252, 253, 255, 0.16)", glow: "rgba(255, 89, 0, 0.18)" },
  amber: { primary: "#ff801f", soft: "rgba(255, 128, 31, 0.16)", glow: "rgba(255, 89, 0, 0.18)" },
  blue: { primary: "#3b9eff", soft: "rgba(59, 158, 255, 0.16)", glow: "rgba(0, 117, 255, 0.18)" },
  emerald: {
    primary: "#11ff99",
    soft: "rgba(17, 255, 153, 0.14)",
    glow: "rgba(17, 255, 153, 0.14)",
  },
  rose: { primary: "#ff2047", soft: "rgba(255, 32, 71, 0.16)", glow: "rgba(255, 32, 71, 0.16)" },
};

export function resolveThemeMode(value: unknown): ThemeMode {
  if (value === "dark" || value === "system") {
    return value;
  }
  // A cached historical `"light"` value (the API normalizes stored rows) falls
  // back to `system`: there is no light palette, so it must not reintroduce one.
  return DEFAULT_THEME_MODE;
}

export function resolveThemeAccent(value: unknown): ThemeAccent {
  return value === "white" ||
    value === "amber" ||
    value === "blue" ||
    value === "emerald" ||
    value === "rose"
    ? value
    : DEFAULT_THEME_ACCENT;
}

export interface ThemePresentation {
  /** Configured mode, always `dark` or `system` (never `light`). */
  mode: ThemeMode;
  accent: ThemeAccent;
  /**
   * Server-rendered `data-theme`. Only `dark` and `system` are emitted. There
   * is no light palette yet, so the `:root` dark tokens apply either way:
   * `system` means "follow the OS when a light palette exists", which today
   * renders exactly like dark.
   */
  dataTheme: ThemeMode;
  /** `<meta name="color-scheme">` / CSS `color-scheme` value. */
  colorScheme: "dark" | "light dark";
  /** Inline custom properties written on `<html>` during SSR (no flash). */
  style: Record<string, string>;
}

export function resolveThemePresentation(settings: PublicSettingsMap): ThemePresentation {
  const mode = resolveThemeMode(settings["theme.defaultMode"]);
  const accent = resolveThemeAccent(settings["theme.accent"]);
  const tokens = THEME_ACCENT_TOKENS[accent];
  const colorScheme = mode === "system" ? "light dark" : "dark";

  return {
    mode,
    accent,
    dataTheme: mode,
    colorScheme,
    style: {
      "--accent-primary": tokens.primary,
      "--accent-primary-soft": tokens.soft,
      "--accent-primary-glow": tokens.glow,
      colorScheme,
    },
  };
}
