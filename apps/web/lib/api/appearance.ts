import {
  getMyAppearance,
  resetMyAppearance as resetMyAppearanceRequest,
  updateMyAppearance,
} from "@roamlog/api-client";
import {
  AppearanceCookieSchema,
  ResolvedAppearanceSchema,
  normalizeFontPairingId,
  normalizeSkinId,
  type AppearanceCookie,
  type AppearanceMode,
  type FontPairingId,
  type ResolvedAppearance,
  type SkinId,
  type UpdateAppearancePreference,
} from "@roamlog/contracts";

import { unwrap } from "./shared";

export const APPEARANCE_PATH = "/v1/me/appearance";
export const APPEARANCE_COOKIE_NAME = "roamlog_appearance";
export const APPEARANCE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export type AppearanceDraft = Pick<ResolvedAppearance, "mode" | "skin" | "fontPairing">;

export async function fetchAppearance(signal?: AbortSignal): Promise<ResolvedAppearance> {
  return unwrap(
    await getMyAppearance(signal ? { signal } : undefined),
    ResolvedAppearanceSchema,
    APPEARANCE_PATH,
  );
}

export async function saveAppearance(
  patch: UpdateAppearancePreference,
): Promise<ResolvedAppearance> {
  return unwrap(await updateMyAppearance(patch), ResolvedAppearanceSchema, APPEARANCE_PATH);
}

export async function resetAppearance(): Promise<ResolvedAppearance> {
  return unwrap(await resetMyAppearanceRequest(), ResolvedAppearanceSchema, APPEARANCE_PATH);
}

/**
 * Apply a resolved choice before the server round-trip. The API response also
 * sets the canonical cookie; this client-side copy is only the optimistic
 * first-paint cache and never contains a secret.
 */
export function applyAppearanceToDocument(appearance: AppearanceDraft): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = appearance.mode;
  root.dataset.mode = appearance.mode;
  root.dataset.skin = normalizeSkinId(appearance.skin);
  root.dataset.font = normalizeFontPairingId(appearance.fontPairing);
  root.style.colorScheme = appearance.mode === "system" ? "light dark" : appearance.mode;
}

function readAppearanceCookie(): AppearanceCookie | null {
  if (typeof document === "undefined") return null;
  const prefix = `${APPEARANCE_COOKIE_NAME}=`;
  const cookie = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!cookie) return null;

  try {
    const decoded = decodeURIComponent(cookie.slice(prefix.length));
    const parsed = AppearanceCookieSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Preserve uid/updatedAt from the previous server cookie while editing. */
export function writeAppearancePreviewCookie(appearance: AppearanceDraft): void {
  if (typeof document === "undefined") return;
  const previous = readAppearanceCookie();
  const next: AppearanceCookie = AppearanceCookieSchema.parse({
    v: 1,
    ...(appearance.mode ? { mode: appearance.mode } : {}),
    ...(appearance.skin ? { skin: normalizeSkinId(appearance.skin) } : {}),
    ...(appearance.fontPairing
      ? { fontPairing: normalizeFontPairingId(appearance.fontPairing) }
      : {}),
    ...(previous?.uid ? { uid: previous.uid } : {}),
    ...(previous?.updatedAt ? { updatedAt: previous.updatedAt } : {}),
  });
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${APPEARANCE_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(next))}; ` +
    `Path=/; Max-Age=${APPEARANCE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function clearAppearanceCookie(): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${APPEARANCE_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export function appearanceModeLabel(mode: AppearanceMode): string {
  switch (mode) {
    case "system":
      return "跟随系统";
    case "light":
      return "浅色";
    case "dark":
      return "深色";
  }
}

export function appearanceSelectionLabel(skin: SkinId, fontPairing: FontPairingId): string {
  return `${skin} · ${fontPairing}`;
}
