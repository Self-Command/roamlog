import {
  AppearanceCookieSchema,
  AppearanceDefaultsSchema,
  ResolvedAppearanceSchema,
  SKIN_CATALOG,
  type AppearanceCookie,
  type AppearanceDefaults,
  type AppearanceMode,
  type AppearanceSource,
  type FontPairingId,
  type ResolvedAppearance,
  type SkinId,
} from "@roamlog/contracts";
import { headers } from "next/headers";
import { cache } from "react";

import {
  getApiBaseUrl,
  getPublicSettings,
  resolveDefaultSkin,
  resolveThemeFont,
  resolveThemeMode,
  type PublicSettingsMap,
} from "./settings";

export const APPEARANCE_COOKIE = "roamlog_appearance";
export const APPEARANCE_TIMEOUT_MS = 3_000;

const FALLBACK_DEFAULTS: AppearanceDefaults = {
  mode: "system",
  skin: "editorial-noir",
  fontPairing: "editorial-classic",
};

export interface AppearanceSourceChoice {
  mode?: AppearanceMode | null;
  skin?: SkinId | null;
  fontPairing?: FontPairingId | null;
  updatedAt?: string | null;
  source?: AppearanceSource;
  canOverride?: boolean;
  defaults?: AppearanceDefaults;
}

export interface ResolveAppearanceInput {
  db?: AppearanceSourceChoice | null;
  cookie?: AppearanceCookie | null;
  platform: AppearanceDefaults;
  canOverride?: boolean;
  userId?: string | null;
}

export interface RequestAppearanceOptions {
  fetcher?: typeof fetch;
  apiUrl?: string;
  timeoutMs?: number;
}

export function platformAppearanceDefaults(settings: PublicSettingsMap): AppearanceDefaults {
  return {
    mode: resolveThemeMode(settings["theme.defaultMode"]),
    skin: resolveDefaultSkin({
      storedSkin: settings["theme.defaultSkin"],
      legacyAccent: settings["theme.accent"],
    }),
    fontPairing: resolveThemeFont(settings["theme.defaultFont"]),
  };
}

function allowUserOverride(settings: PublicSettingsMap): boolean {
  const value = settings["theme.allowUserOverride"];
  return value !== false && value !== "false";
}

function parseCookie(cookie: AppearanceCookie | null | undefined): AppearanceCookie | null {
  if (!cookie) {
    return null;
  }
  const parsed = AppearanceCookieSchema.safeParse(cookie);
  return parsed.success ? parsed.data : null;
}

export function resolveAppearanceForRequest(input: ResolveAppearanceInput): ResolvedAppearance {
  const parsedPlatform = AppearanceDefaultsSchema.safeParse(input.platform);
  const platform = parsedPlatform.success ? parsedPlatform.data : FALLBACK_DEFAULTS;
  const canOverride = input.canOverride ?? input.db?.canOverride ?? true;

  if (!canOverride) {
    return {
      ...platform,
      source: "platform",
      canOverride: false,
      updatedAt: null,
      defaults: platform,
    };
  }

  const cookie = parseCookie(input.cookie);
  const cookieMatchesUser =
    cookie === null || !cookie.uid || !input.userId || cookie.uid === input.userId;
  const db = input.db ?? null;
  const usableCookie = db === null && cookieMatchesUser ? cookie : null;
  const sourceChoice = db ?? usableCookie;
  const fields = {
    mode: sourceChoice?.mode ?? platform.mode,
    skin: sourceChoice?.skin ?? platform.skin,
    fontPairing: sourceChoice?.fontPairing ?? platform.fontPairing,
  };
  const hasOverride = Boolean(
    sourceChoice &&
    ((sourceChoice.mode !== null && sourceChoice.mode !== undefined) ||
      (sourceChoice.skin !== null && sourceChoice.skin !== undefined) ||
      (sourceChoice.fontPairing !== null && sourceChoice.fontPairing !== undefined)),
  );
  const source: AppearanceSource = hasOverride ? (db ? "user" : "cookie") : "platform";

  return {
    ...fields,
    source,
    canOverride,
    updatedAt:
      source === "user"
        ? (input.db?.updatedAt ?? null)
        : source === "cookie"
          ? (usableCookie?.updatedAt ?? null)
          : null,
    defaults: platform,
  };
}

export function parseAppearanceCookie(raw: string | null | undefined): AppearanceCookie | null {
  if (!raw) {
    return null;
  }
  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) {
      candidates.push(decoded);
    }
  } catch {
    // A malformed percent sequence is treated as an invalid cookie below.
  }

  for (const candidate of candidates) {
    try {
      const parsed = AppearanceCookieSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Try the URI-decoded form, then fall through to null.
    }
  }
  return null;
}

export function encodeAppearanceCookie(value: AppearanceCookie): string {
  const parsed = AppearanceCookieSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid appearance cookie");
  }
  return encodeURIComponent(JSON.stringify(parsed.data));
}

export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }
  const prefix = `${name}=`;
  const match = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

export function resolveLegacyAccentSkin(accent: unknown): SkinId {
  return resolveDefaultSkin({ legacyAccent: accent });
}

export function themeColorsForSkin(skin: SkinId): { light: string; dark: string } {
  const entry = SKIN_CATALOG.find((candidate) => candidate.id === skin);
  return entry
    ? { light: entry.lightPreview.canvas, dark: entry.darkPreview.canvas }
    : { light: "#F6F4EF", dark: "#000000" };
}

function hasSessionCookie(cookieHeader: string): boolean {
  return /(?:^|;\s*)(?:__Secure-)?roamlog\.session_token=/u.test(cookieHeader);
}

async function requestCookieHeader(): Promise<string> {
  try {
    return (await headers()).get("cookie") ?? "";
  } catch {
    // `headers()` is unavailable in a plain unit-test render and outside a
    // request. The code defaults are the safe first-paint fallback there.
    return "";
  }
}

async function fetchUserAppearance(
  cookieHeader: string,
  options: RequestAppearanceOptions,
): Promise<ResolvedAppearance | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? APPEARANCE_TIMEOUT_MS);
  try {
    const response = await (options.fetcher ?? fetch)(
      `${(options.apiUrl ?? getApiBaseUrl()).replace(/\/+$/u, "")}/v1/me/appearance`,
      {
        headers: {
          accept: "application/json",
          cookie: cookieHeader,
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return null;
    }
    const parsed = ResolvedAppearanceSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveAppearanceFromRequest(
  settings: PublicSettingsMap,
  cookieHeader = "",
  options: RequestAppearanceOptions = {},
): Promise<ResolvedAppearance> {
  const platform = platformAppearanceDefaults(settings);
  const cookie = parseAppearanceCookie(readCookieValue(cookieHeader, APPEARANCE_COOKIE));
  const canOverride = allowUserOverride(settings);
  const userAppearance =
    canOverride && hasSessionCookie(cookieHeader)
      ? await fetchUserAppearance(cookieHeader, options)
      : null;

  return resolveAppearanceForRequest({
    db: userAppearance,
    cookie,
    platform,
    canOverride,
  });
}

const getCachedResolvedAppearance = cache(async (): Promise<ResolvedAppearance> => {
  const settings = await getPublicSettings();
  return resolveAppearanceFromRequest(settings, await requestCookieHeader());
});

export function getResolvedAppearance(): Promise<ResolvedAppearance> {
  return getCachedResolvedAppearance();
}
