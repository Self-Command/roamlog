import { getMyAppearance, updateMyAppearance } from "@roamlog/api-client";
import {
  AppearanceCookieSchema,
  DEFAULT_FONT_PAIRING_ID,
  DEFAULT_SKIN_ID,
  ResolvedAppearanceSchema,
  normalizeFontPairingId,
  normalizeSkinId,
  type AppearanceCookie,
  type AppearanceMode,
  type ResolvedAppearance,
  type UpdateAppearancePreference,
} from "@roamlog/contracts";

export const ADMIN_APPEARANCE_COOKIE = "roamlog_appearance";
export const ADMIN_APPEARANCE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export interface AdminAppearanceDraft {
  mode: AppearanceMode;
  skin: ResolvedAppearance["skin"];
  fontPairing: ResolvedAppearance["fontPairing"];
}

export const ADMIN_FALLBACK_APPEARANCE: AdminAppearanceDraft = {
  mode: "system",
  skin: DEFAULT_SKIN_ID,
  fontPairing: DEFAULT_FONT_PAIRING_ID,
};

export function parseAdminAppearanceCookie(raw: string | null | undefined): AppearanceCookie | null {
  if (!raw) return null;
  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) candidates.push(decoded);
  } catch {
    // Treat malformed percent sequences as an invalid cookie.
  }

  for (const candidate of candidates) {
    try {
      const parsed = AppearanceCookieSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) {
        return {
          ...parsed.data,
          skin: parsed.data.skin ? normalizeSkinId(parsed.data.skin) : undefined,
          fontPairing: parsed.data.fontPairing
            ? normalizeFontPairingId(parsed.data.fontPairing)
            : undefined,
        };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function adminAppearanceFromCookie(raw: string | null | undefined): AdminAppearanceDraft {
  const cookie = parseAdminAppearanceCookie(raw);
  return {
    mode: cookie?.mode ?? ADMIN_FALLBACK_APPEARANCE.mode,
    skin: normalizeSkinId(cookie?.skin ?? ADMIN_FALLBACK_APPEARANCE.skin),
    fontPairing: normalizeFontPairingId(
      cookie?.fontPairing ?? ADMIN_FALLBACK_APPEARANCE.fontPairing,
    ),
  };
}

export function adminAppearanceFromDocument(): AdminAppearanceDraft {
  if (typeof document === "undefined") return { ...ADMIN_FALLBACK_APPEARANCE };
  const root = document.documentElement;
  const mode = root.dataset.mode;
  return {
    mode:
      mode === "light" || mode === "dark" || mode === "system"
        ? mode
        : ADMIN_FALLBACK_APPEARANCE.mode,
    skin: normalizeSkinId(root.dataset.skin),
    fontPairing: normalizeFontPairingId(root.dataset.font),
  };
}

export function applyAdminAppearanceToDocument(appearance: AdminAppearanceDraft): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = appearance.mode;
  root.dataset.mode = appearance.mode;
  root.dataset.skin = normalizeSkinId(appearance.skin);
  root.dataset.font = normalizeFontPairingId(appearance.fontPairing);
  root.style.colorScheme = appearance.mode === "system" ? "light dark" : appearance.mode;
}

function readDocumentCookie(): AppearanceCookie | null {
  if (typeof document === "undefined") return null;
  const prefix = `${ADMIN_APPEARANCE_COOKIE}=`;
  const entry = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return entry ? parseAdminAppearanceCookie(entry.slice(prefix.length)) : null;
}

export function writeAdminAppearancePreviewCookie(appearance: AdminAppearanceDraft): void {
  if (typeof document === "undefined") return;
  const previous = readDocumentCookie();
  const next = AppearanceCookieSchema.parse({
    v: 1,
    mode: appearance.mode,
    skin: normalizeSkinId(appearance.skin),
    fontPairing: normalizeFontPairingId(appearance.fontPairing),
    ...(previous?.uid ? { uid: previous.uid } : {}),
    ...(previous?.updatedAt ? { updatedAt: previous.updatedAt } : {}),
  });
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${ADMIN_APPEARANCE_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; ` +
    `Path=/; Max-Age=${ADMIN_APPEARANCE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function parseResolved(value: unknown): ResolvedAppearance {
  const parsed = ResolvedAppearanceSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("外观接口返回了无法识别的数据。");
  }
  return parsed.data;
}

export async function fetchAdminAppearance(signal?: AbortSignal): Promise<ResolvedAppearance> {
  const response = await getMyAppearance(signal ? { signal } : undefined);
  if (response.status === 401) {
    throw new Error("登录状态已过期，请重新登录后再切换外观。");
  }
  if (response.status !== 200) {
    throw new Error(`外观设置加载失败（HTTP ${response.status}）。`);
  }
  return parseResolved(response.data);
}

export async function saveAdminAppearance(
  patch: UpdateAppearancePreference,
): Promise<ResolvedAppearance> {
  const response = await updateMyAppearance(patch);
  if (response.status === 401) {
    throw new Error("登录状态已过期，外观未同步到账号。");
  }
  if (response.status !== 200) {
    throw new Error(`外观保存失败（HTTP ${response.status}）。`);
  }
  return parseResolved(response.data);
}
