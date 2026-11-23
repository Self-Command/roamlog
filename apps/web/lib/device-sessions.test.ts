import { describe, expect, it } from "vitest";

import type { Session } from "@roamlog/contracts";

import { groupSessionsByDevice, parseDeviceProfile } from "./device-sessions";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

function session(overrides: Partial<Session> & Pick<Session, "id">): Session {
  const { id, ...rest } = overrides;
  return {
    id,
    userId: "01a00000-0000-7000-8000-000000000001",
    expiresAt: "2026-12-01T00:00:00.000Z",
    createdAt: "2026-11-23T00:00:00.000Z",
    ip: "203.0.113.10",
    userAgent: CHROME_WINDOWS,
    deviceId: null,
    ...rest,
  };
}

describe("device sessions", () => {
  it("extracts browser, OS, engine and device kind from a desktop UA", () => {
    const profile = parseDeviceProfile(CHROME_WINDOWS);

    expect(profile.browserName).toBe("Chrome");
    expect(profile.osName).toMatch(/Windows/);
    expect(profile.engineName).toBe("Blink");
    expect(profile.kind).toBe("desktop");
    expect(profile.label).toContain("Chrome");
    expect(profile.fingerprint).toContain("chrome|windows|desktop");
  });

  it("keeps mobile devices distinct from desktop sessions", () => {
    const profile = parseDeviceProfile(SAFARI_IPHONE);

    expect(profile.browserName).toMatch(/Safari/i);
    expect(profile.osName).toBe("iOS");
    expect(profile.kind).toBe("mobile");
  });

  it("shows repeated logins on the same detected device once", () => {
    const grouped = groupSessionsByDevice(
      [
        session({
          id: "01a00000-0000-7000-8000-000000000011",
          createdAt: "2026-11-22T09:00:00.000Z",
        }),
        session({
          id: "01a00000-0000-7000-8000-000000000012",
          createdAt: "2026-11-23T09:00:00.000Z",
          expiresAt: "2026-12-05T09:00:00.000Z",
        }),
        session({
          id: "01a00000-0000-7000-8000-000000000013",
          userAgent: SAFARI_IPHONE,
          ip: "198.51.100.24",
        }),
      ],
      "01a00000-0000-7000-8000-000000000012",
    );

    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.isCurrent).toBe(true);
    expect(grouped[0]?.sessionCount).toBe(2);
    expect(grouped[0]?.sessionIds).toEqual([
      "01a00000-0000-7000-8000-000000000012",
      "01a00000-0000-7000-8000-000000000011",
    ]);
    expect(grouped[0]?.loginAt).toBe("2026-11-23T09:00:00.000Z");
    expect(grouped[0]?.expiresAt).toBe("2026-12-05T09:00:00.000Z");
    expect(grouped[1]?.profile.kind).toBe("mobile");
  });

  it("does not merge sessions whose UA cannot be identified", () => {
    const grouped = groupSessionsByDevice(
      [
        session({
          id: "01a00000-0000-7000-8000-000000000021",
          userAgent: null,
        }),
        session({
          id: "01a00000-0000-7000-8000-000000000022",
          userAgent: null,
        }),
      ],
      null,
    );

    expect(grouped).toHaveLength(2);
    expect(grouped.every((device) => device.profile.label === "未知设备")).toBe(true);
  });

  it("groups sessions with the same stable device id even across UA updates", () => {
    const deviceId = "01a00000-0000-7000-8000-0000000000d1";
    const grouped = groupSessionsByDevice(
      [
        session({
          id: "01a00000-0000-7000-8000-000000000031",
          deviceId,
          userAgent: CHROME_WINDOWS,
        }),
        session({
          id: "01a00000-0000-7000-8000-000000000032",
          deviceId,
          userAgent: SAFARI_IPHONE,
          createdAt: "2026-11-24T00:00:00.000Z",
        }),
      ],
      null,
    );

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.id).toBe(`device:${deviceId}`);
    expect(grouped[0]?.sessionCount).toBe(2);
  });

  it("keeps identical browsers separate when their stable device ids differ", () => {
    const grouped = groupSessionsByDevice(
      [
        session({
          id: "01a00000-0000-7000-8000-000000000041",
          deviceId: "01a00000-0000-7000-8000-0000000000d2",
        }),
        session({
          id: "01a00000-0000-7000-8000-000000000042",
          deviceId: "01a00000-0000-7000-8000-0000000000d3",
        }),
      ],
      null,
    );

    expect(grouped).toHaveLength(2);
    expect(grouped.every((device) => device.id.startsWith("device:"))).toBe(true);
  });
});
