import Bowser from "bowser";

import type { Session } from "@roamlog/contracts";

/**
 * Appwrite Console account/sessions page shows one client row with browser,
 * OS, current-session badge and a per-row revoke action:
 * https://github.com/appwrite/console/blob/843f17e6e0ebe1f6c6ef01efa1ec96ae9bb2f85c/src/routes/(console)/account/sessions/+page.svelte#L82-L151
 *
 * Roamlog persists a stable HttpOnly device id on the session. Sessions created
 * before that column existed still use Bowser (MIT,
 * https://github.com/bowser-js/bowser) as a legacy UA-fingerprint fallback.
 */

export type DeviceKind = "desktop" | "mobile" | "tablet" | "tv" | "console" | "unknown";

export interface DeviceProfile {
  browserName: string;
  browserVersion: string;
  osName: string;
  osVersion: string;
  engineName: string;
  engineVersion: string;
  vendor: string;
  model: string;
  kind: DeviceKind;
  label: string;
  detail: string;
  fingerprint: string | null;
}

export interface SessionDeviceGroup {
  id: string;
  sessions: readonly Session[];
  primary: Session;
  sessionIds: readonly string[];
  isCurrent: boolean;
  sessionCount: number;
  loginAt: string;
  expiresAt: string;
  ip: string | null;
  profile: DeviceProfile;
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function versionLabel(name: string, version: string): string {
  return [name, version].filter(Boolean).join(" ") || "未知";
}

function deviceKind(type: string | undefined): DeviceKind {
  switch (type) {
    case "desktop":
    case "mobile":
    case "tablet":
    case "tv":
    case "console":
      return type;
    default:
      return "unknown";
  }
}

export function parseDeviceProfile(userAgent: string | null): DeviceProfile {
  if (!userAgent?.trim()) {
    return {
      browserName: "",
      browserVersion: "",
      osName: "",
      osVersion: "",
      engineName: "",
      engineVersion: "",
      vendor: "",
      model: "",
      kind: "unknown",
      label: "未知设备",
      detail: "没有可解析的 User-Agent",
      fingerprint: null,
    };
  }

  const parsed = Bowser.parse(userAgent);
  const browserName = clean(parsed.browser.name);
  const browserVersion = clean(parsed.browser.version);
  const osName = clean(parsed.os.name);
  const osVersion = clean(parsed.os.versionName) || clean(parsed.os.version);
  const engineName = clean(parsed.engine.name);
  const engineVersion = clean(parsed.engine.version);
  const vendor = clean(parsed.platform.vendor);
  const model = clean(parsed.platform.model);
  const kind = deviceKind(parsed.platform.type);

  const browserLabel = versionLabel(browserName, browserVersion);
  const osLabel = versionLabel(osName, osVersion);
  const label =
    browserName || osName ? [browserLabel, osLabel].filter(Boolean).join(" · ") : "未知设备";
  const deviceDetail = [vendor, model].filter(Boolean).join(" ");
  const detail = [
    kind === "unknown" ? "" : kind,
    deviceDetail,
    engineName ? versionLabel(engineName, engineVersion) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const fingerprintParts = [
    browserName.toLowerCase(),
    osName.toLowerCase(),
    kind,
    vendor.toLowerCase(),
    model.toLowerCase(),
  ].filter(Boolean);

  return {
    browserName,
    browserVersion,
    osName,
    osVersion,
    engineName,
    engineVersion,
    vendor,
    model,
    kind,
    label,
    detail: detail || "未检测到设备型号",
    fingerprint: fingerprintParts.length > 0 ? fingerprintParts.join("|") : null,
  };
}

/**
 * Group active sessions by detected device. Sessions without a usable UA stay
 * separate because merging them would incorrectly combine unrelated clients.
 */
export function groupSessionsByDevice(
  sessions: readonly Session[],
  currentSessionId: string | null,
): SessionDeviceGroup[] {
  const groups = new Map<
    string,
    { sessions: Session[]; profile: DeviceProfile; fallbackId: string }
  >();

  for (const session of sessions) {
    const profile = parseDeviceProfile(session.userAgent);
    const stableDeviceId = session.deviceId?.trim() ?? "";
    const key = stableDeviceId
      ? `device:${stableDeviceId}`
      : profile.fingerprint
        ? `legacy:${profile.fingerprint}`
        : `unknown:${session.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, {
        sessions: [session],
        profile,
        fallbackId: session.id,
      });
    }
  }

  return [...groups.entries()]
    .flatMap(([key, group]) => {
      const sorted = [...group.sessions].sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
          right.id.localeCompare(left.id),
      );
      const primary = sorted[0];
      if (!primary) {
        return [];
      }
      return [
        {
          id: key,
          sessions: sorted,
          primary,
          sessionIds: sorted.map((session) => session.id),
          isCurrent: sorted.some((session) => session.id === currentSessionId),
          sessionCount: sorted.length,
          loginAt: primary.createdAt,
          expiresAt: sorted.reduce(
            (latest, session) =>
              Date.parse(session.expiresAt) > Date.parse(latest) ? session.expiresAt : latest,
            primary.expiresAt,
          ),
          ip: primary.ip,
          profile: group.profile,
        } satisfies SessionDeviceGroup,
      ];
    })
    .sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) {
        return left.isCurrent ? -1 : 1;
      }
      return (
        Date.parse(right.loginAt) - Date.parse(left.loginAt) || right.id.localeCompare(left.id)
      );
    });
}
